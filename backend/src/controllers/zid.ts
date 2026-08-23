import crypto from 'crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import * as zidService from '../services/zid';
import {
    resolveStoreByDomainOrMerchant,
    deactivateStore,
    getStoreById,
    setEmbeddedTokenHash,
} from '../services/ecommerce';
import { authService } from '../services/auth';
import { workspaceService } from '../services/workspace';
import {
    exchangeEmbeddedCredential,
    hashEmbeddedToken,
} from '../services/embeddedSession';
import { captureError } from '../utils/sentryHelpers';
import {
    dispatchOrderNotification,
    orderConfirmedEvent,
    orderShippedEvent,
    orderDeliveredEvent,
} from '../services/orderNotificationScheduler';
import type { OrderEvent } from '../services/orderNotificationScheduler';
import { enqueueSyncJob } from '../lib/ecommerceSyncQueue';
import { cancelZidSubscriptionLocal, syncZidBilling } from '../services/zidBilling';
import { config } from '../config';
import {
    PENDING_ZID_COOKIE_OPTIONS,
    ZID_NONCE_COOKIE_OPTIONS,
} from '../services/cookies';
import { createEcommerceControllers, type OAuthTokenResponse } from './ecommerceControllers';

// OAuth flow (authRedirect + authCallback) is shared via createEcommerceControllers
// — see the adapter wiring at the bottom of this file.

/** Build the dual-header credential pair from the shared OAuth token response. */
function credsFromTokens(tokens: OAuthTokenResponse): zidService.ZidCredentials {
    if (!tokens.authorizationToken) {
        // exchangeCodeForToken fails fast when Zid omits the field, so reaching here
        // means a non-Zid token response was routed to the Zid adapter — a bug.
        throw new Error('Zid adapter received a token response without an Authorization token');
    }
    return { managerToken: tokens.accessToken, authorizationToken: tokens.authorizationToken };
}

// --- Embedded Apps: direct merchant access from the Zid dashboard ---
//
// Zid's review standard is "direct merchant access (no sign-in prompt)": after an
// App Market install the merchant must reach a working app without a login wall,
// and must be able to re-open it from the Zid dashboard the same way. The
// mechanism (docs.zid.sa/embedded-apps) is a UUID we generate, register with Zid,
// and receive back as `?token=` when Zid frames our Application URL.
//
// Threat model and the session rules that follow from it live with the exchange
// itself, in services/embeddedSession.ts. This file owns only the Zid half:
// minting the UUID, registering it with Zid, and revoking it.

/**
 * Zid's post-install destination: the app opened INSIDE the merchant dashboard.
 * `store_id`/`language_code` may be any valid value — Zid's Hermes resolves the
 * real store and language from the merchant's dashboard session.
 */
function zidDashboardEmbeddedUrl(merchantId: string | undefined, log: FastifyRequest['log']): string {
    const hasMerchantId = Boolean(merchantId && merchantId.trim());
    if (!hasMerchantId) {
        // Zid resolves the real store from the dashboard session, so a filler
        // segment works today. Log it anyway: if Zid ever validates the segment
        // this becomes a 404 on the merchant's ONLY way into the app, and a
        // silent fallback is how the last Zid failure took eight days to name.
        log.warn('Zid store profile carried no merchantId — using a filler store segment in the dashboard URL');
    }
    const storeSegment = hasMerchantId ? encodeURIComponent(merchantId as string) : '1';
    return `https://dashboard.zid.sa/ar-sa/stores/${storeSegment}/apps/${encodeURIComponent(config.zid.appId)}/embedded`;
}

/**
 * Mint + register the embedded-app token for a freshly installed store, and
 * persist its hash. Returns false when Zid rejects the registration (the store
 * is still installed and usable in the browser — only the in-dashboard entry is
 * unavailable, so callers fall back to a browser session rather than sending the
 * merchant to an iframe that cannot authenticate them).
 */
async function provisionEmbeddedToken(
    storeId: string,
    tokens: { accessToken: string; authorizationToken?: string },
    log: FastifyRequest['log'],
): Promise<boolean> {
    if (!tokens.authorizationToken) {
        // credsFromTokens throws on this and exchangeCodeForToken fails fast, so
        // reaching here means a non-Zid token response was routed to the Zid
        // adapter. Same degraded outcome as a rejected registration — and the
        // same visibility, because a silent `return false` here looked identical
        // to a healthy install while costing the merchant their dashboard entry.
        captureError(
            new Error('Zid embedded-token registration skipped: no Authorization token'),
            'Zid embedded-token registration skipped',
            { tags: { service: 'zid', action: 'register-embedded-token' }, extra: { storeId } },
        );
        log.error({ storeId }, 'Zid embedded-token registration skipped — token response carried no Authorization token');
        return false;
    }
    const embeddedToken = crypto.randomUUID();
    try {
        await zidService.registerEmbeddedToken(
            { managerToken: tokens.accessToken, authorizationToken: tokens.authorizationToken },
            embeddedToken,
        );
        await setEmbeddedTokenHash(storeId, hashEmbeddedToken(embeddedToken));
        return true;
    } catch (error) {
        // Never fail the install for this — but it MUST be visible: without it
        // the merchant has no in-dashboard entry, which is the exact defect Zid
        // rejected the app for.
        captureError(error, 'Zid embedded-token registration failed', {
            tags: { service: 'zid', action: 'register-embedded-token' },
            extra: { storeId },
        });
        log.error({ err: error, storeId }, 'Zid embedded-token registration failed');
        return false;
    }
}

/**
 * Revoke a store's embedded-app token — at Zid (best-effort) and locally
 * (always). Called on uninstall and on merchant-initiated disconnect.
 */
export async function revokeEmbeddedToken(
    storeId: string,
    log: FastifyRequest['log'],
    reason: 'uninstall' | 'disconnect' = 'uninstall',
): Promise<void> {
    try {
        const creds = await zidService.resolveZidCredentials(storeId);
        if (creds) await zidService.deleteEmbeddedToken(creds);
    } catch (error) {
        // On UNINSTALL this is expected — Zid invalidates our OAuth tokens as
        // part of the uninstall, so the DELETE has nothing to authenticate with.
        // On DISCONNECT the tokens are still live, so a failure means a usable
        // credential survives at Zid's side and is worth a Sentry event.
        if (reason === 'disconnect') {
            captureError(error, 'Zid embedded-token revocation failed on merchant disconnect', {
                tags: { service: 'zid', action: 'revoke-embedded-token' },
                extra: { storeId },
            });
        }
        log.warn({ err: error, storeId, reason }, 'Zid embedded-token revocation at Zid failed — clearing local hash anyway');
    }
    try {
        await setEmbeddedTokenHash(storeId, null);
    } catch (error) {
        // THIS one matters: a surviving hash keeps the session path open.
        captureError(error, 'Failed to clear Zid embedded token hash', {
            tags: { service: 'zid', action: 'clear-embedded-token' },
            extra: { storeId },
        });
    }
}

/**
 * POST /zid/embedded/session — trade the iframe's UUID for a real session.
 *
 * PUBLIC by necessity: the request comes from our page running inside Zid's
 * dashboard iframe, a cross-site context where our SameSite=strict auth cookies
 * are not sent. The UUID is the credential, and it is exactly what Zid puts in
 * the iframe URL by design. The exchange itself — including the scoping that
 * keeps this session inside the store's workspace — is in
 * services/embeddedSession.ts, shared with whatever platform adopts it next.
 *
 * Every refusal answers with the SAME opaque 401. A public endpoint must not
 * tell an unknown caller whether a credential is unknown, revoked or expired;
 * the reason is in the logs instead.
 */
export async function embeddedSession(request: FastifyRequest, reply: FastifyReply) {
    const { embeddedToken } = (request.body ?? {}) as { embeddedToken?: string };

    const result = await exchangeEmbeddedCredential('zid', embeddedToken, request.log);

    if (!result.ok) {
        return reply.status(401).send({
            error: { message: 'Embedded session could not be established', code: 'EMBEDDED_SESSION_INVALID' },
        });
    }

    // `accessToken`, not `token`: the request body's credential is also a
    // "token", and naming both the same is how they get wired backwards.
    return reply.send({
        accessToken: result.session.accessToken,
        workspaceId: result.session.workspaceId,
    });
}

// --- Webhook (single endpoint — Basic-auth verified, dispatches by event) ---

/**
 * Zid authenticates webhook deliveries with HTTP Basic auth (the username/password
 * pair set at subscription time) — there is NO signature header. Fail closed.
 */
function verifyZidWebhookAuth(request: FastifyRequest, reply: FastifyReply): boolean {
    const header = request.headers.authorization;
    if (!zidService.verifyWebhookBasicAuth(header)) {
        // Rejections must be visible: a wrong/rotated ZID_WEBHOOK_SECRET or an
        // unexpected scheme casing would otherwise drop every delivery silently.
        // Log the scheme word only — never the credential material.
        request.log.warn(
            { scheme: header ? header.split(' ')[0] : 'none' },
            'Zid webhook rejected: Basic auth verification failed',
        );
        reply.status(401).send({ error: 'Invalid webhook credentials' });
        return false;
    }
    return true;
}

/**
 * Zid app-lifecycle event delivered when a merchant uninstalls from the App Market.
 * Configured in the Partner Dashboard (not via /v1/managers/webhooks) — Zid also
 * invalidates our tokens at that moment.
 */
const ZID_UNINSTALL_EVENT = 'app.market.application.uninstall';

/**
 * App Market SUBSCRIPTION lifecycle events. These are pure TRIGGERS: the
 * handler never reads a plan, price, or status out of the delivery — it calls
 * `syncZidBilling`, which asks Zid's own subscription endpoint and reconciles
 * from that answer. So an envelope we have not captured (nothing on this rail
 * has been round-tripped — EC3 blocks installing a Rejected app) cannot put
 * wrong billing state into the database, and a delivery that never arrives is
 * healed by the 6h reconciler instead of being lost (§H-9).
 *
 * Matched by PREFIX rather than an exact list for the same reason: Zid's exact
 * event names are unconfirmed, and a subscription event we fail to recognise
 * would silently skip the verify. A spurious verify is cheap; a missed one
 * strands a paying merchant.
 */
const ZID_SUBSCRIPTION_EVENT_PREFIX = 'app.market.subscription';

interface ZidWebhookBody {
    event?: string;
    store_id?: string | number;
    store_uuid?: string;
    data?: Record<string, unknown>;
    order?: Record<string, unknown>;
    [key: string]: unknown;
}

export async function webhookHandler(request: FastifyRequest, reply: FastifyReply) {
    if (!verifyZidWebhookAuth(request, reply)) return;

    const body = (request.body ?? {}) as ZidWebhookBody;
    const query = (request.query ?? {}) as { e?: string; sid?: string };

    // The delivery envelope is unconfirmed [provisional], so each subscription's
    // target_url carries the event (`e`) and our store UUID (`sid`) — resolve from
    // the query string first, then fall back to body fields.
    const event = query.e || body.event || '';

    const resolveStore = async () => {
        if (query.sid) {
            const store = await getStoreById(query.sid);
            if (store && store.platform === 'zid' && store.isActive) return store;
        }
        const externalId = body.store_id ?? body.store_uuid ?? (body.data?.store_id as string | number | undefined);
        if (externalId === undefined || externalId === null) return null;
        // Zid may send a numeric store id or a domain string — domain lookup first,
        // then the platformData.merchantId fallback (shared with Salla).
        return resolveStoreByDomainOrMerchant('zid', String(externalId));
    };

    if (event === ZID_UNINSTALL_EVENT) {
        const store = await resolveStore();
        if (store) {
            // Revoke the in-dashboard entry BEFORE deactivating: deactivateStore
            // blanks the OAuth tokens, after which the Zid DELETE cannot be
            // authenticated. Best-effort at Zid's side (it invalidates our tokens
            // at uninstall anyway), but clearing OUR hash is what actually closes
            // the session path, so it happens either way.
            await revokeEmbeddedToken(store.id, request.log);
            // Cancel the billing mirror BEFORE deactivating too, for a different
            // reason: no paid local subscription may outlive the app (§H-6). It
            // is keyed on zid_store_id rather than the store row, so the order
            // is defensive rather than required.
            await cancelZidSubscriptionLocal(store.id, 'zid_app_uninstalled', request.log);
            await deactivateStore('zid', store.storeDomain);
        }
        return reply.status(200).send({ ok: true });
    }

    if (event.startsWith(ZID_SUBSCRIPTION_EVENT_PREFIX)) {
        const store = await resolveStore();
        if (store) {
            // Fire-and-forget: Zid's redelivery policy is uncaptured, so the ack
            // must not wait on a Merchant API round-trip. A failure here is not
            // lost — the 6h reconciler sweeps the same store.
            syncZidBilling(store.id, request.log).catch(err => {
                request.log.error({ err, storeId: store.id }, 'Zid billing sync failed for a subscription webhook');
            });
        }
        return reply.status(200).send({ ok: true });
    }

    // product_update, NOT full_sync: store info doesn't change when a product does
    // (see the Salla controller's product.* branch for the full rationale).
    if (zidService.isProductEvent(event)) {
        const store = await resolveStore();
        if (store) {
            enqueueSyncJob(store.id, 'zid', 'product_update').catch(err => {
                request.log.error({ err }, 'Failed to enqueue Zid product sync');
            });
        }
        return reply.status(200).send({ ok: true });
    }

    if (zidService.isOrderEvent(event)) {
        const store = await resolveStore();
        if (store) {
            const orderEvent = buildZidOrderEvent(store.id, event, body);
            if (orderEvent) dispatchOrderNotification(orderEvent, request.log);
        }
    }

    return reply.status(200).send({ ok: true });
}

/** [provisional] Order payload fields pending live captures — read tolerantly. */
interface ZidOrderPayload {
    id?: string | number;
    /** The number shown to the merchant and the customer; equals `id` in every observed payload. */
    invoice_number?: string | number;
    /**
     * NOT an order number — a storefront URL slug (`order_url`
     * `https://<store>.zid.store/o/<code>/inv`). Never quote it to a customer.
     */
    code?: string | number;
    order_status?: { name?: string; code?: string };
    status?: string | { name?: string; code?: string };
    customer?: { name?: string; mobile?: string | number };
    /**
     * Zid's real shipping shape (captured 2026-08-23 from a live order): the carrier
     * data hangs off `shipping.method`, and `tracking` carries `number`, `status` and
     * a customer-facing `url`. All null when the merchant self-delivers
     * (`method.code === 'custom'`, «مندوب المتجر») — there is no carrier to track.
     */
    shipping?: {
        method?: {
            tracking?: { number?: string | null; status?: string | null; url?: string | null };
            waybill_tracking_id?: string | null;
        };
        /** [provisional] flat fallback — never observed live, kept for tolerance. */
        tracking_number?: string;
    };
    /** [provisional] flat fallback — never observed live, kept for tolerance. */
    tracking_number?: string;
}

/**
 * Map a Zid order webhook to a notification event.
 * - order.create        → order confirmed
 * - order.status.update → shipped (status code `indelivery`) / delivered; other
 *   status codes (new/preparing/ready/canceled) intentionally send nothing.
 * No shipped-without-tracking grace here (Salla's SHIPPED_NO_TRACKING_GRACE_MS):
 * Zid has no separate shipment event to upgrade the row later, so waiting would
 * only delay the SMS.
 */
function buildZidOrderEvent(storeId: string, event: string, body: ZidWebhookBody): OrderEvent | null {
    // Envelope unconfirmed — the order may arrive under data, order, or at the root.
    const data = (body.data ?? body.order ?? body) as ZidOrderPayload;

    const phone = zidService.normalizeZidPhone(data.customer?.mobile);
    if (!phone) return null;

    const orderId = data.id !== undefined && data.id !== null ? String(data.id) : '';
    // The customer-facing number is `invoice_number` (= `id`); `code` is the invoice
    // URL slug and means nothing to the customer. Verified 2026-08-23 against a live
    // order.status.update: id/invoice_number 72524870 — the number both the Zid admin
    // and the storefront invoice page display — while code was "mdXMlMYYBt".
    const orderNumber = data.invoice_number !== undefined && data.invoice_number !== null
        ? String(data.invoice_number)
        : orderId;
    const customerName = data.customer?.name;

    if (event === 'order.create') {
        return orderConfirmedEvent('zid', storeId, { customerPhone: phone, customerName, orderId, orderNumber });
    }

    if (event === 'order.status.update') {
        const statusCode = (
            data.order_status?.code
            ?? (typeof data.status === 'object' ? data.status?.code : data.status)
            ?? ''
        ).toLowerCase();

        if (statusCode === 'indelivery') {
            // `shipping.method.tracking.number` is Zid's real location; the flat
            // fields below were guesses that no live payload has ever carried.
            const trackingNumber = data.shipping?.method?.tracking?.number
                || data.shipping?.method?.waybill_tracking_id
                || data.tracking_number
                || data.shipping?.tracking_number
                || undefined;
            return orderShippedEvent('zid', storeId, { customerPhone: phone, customerName, orderId, orderNumber, trackingNumber });
        }
        if (statusCode === 'delivered') {
            return orderDeliveredEvent('zid', storeId, { customerPhone: phone, customerName, orderId, orderNumber });
        }
        return null;
    }

    return null;
}

// --- Protected API (Jawab24 JWT required) ---

export const {
    authRedirect,
    authCallback,
    getStore,
    connectStore,
    disconnectStoreHandler,
    syncStore,
    getStoreProducts,
    linkPage,
    unlinkPage,
} = createEcommerceControllers('zid', {
    fullSync: zidService.fullSync,
    buildAuthUrl: zidService.buildAuthUrl,
    nonceCookieName: 'zidNonce',
    nonceCookieOptions: ZID_NONCE_COOKIE_OPTIONS,
    exchangeCodeForToken: zidService.exchangeCodeForToken,
    fetchStoreInfo: (tokens) => zidService.fetchStoreInfo(credsFromTokens(tokens)),
    registerWebhooks: (tokens, storeId) => zidService.registerWebhooks(credsFromTokens(tokens), storeId),
    scopes: config.zid.scopes,
    pendingCookieName: 'pendingZidId',
    pendingCookieOptions: PENDING_ZID_COOKIE_OPTIONS,

    // An App Market install arrives with no Jawab24 session. Zid requires the
    // merchant to reach a working app with no sign-in prompt, so we create the
    // account from the store profile Zid itself returned. Returning null (email
    // missing, or already held by an account — an account-takeover vector, see
    // provisionEcommerceMerchantUser) falls back to the claim-after-login flow.
    provisionMerchant: async (storeInfo) => {
        if (!storeInfo.storeEmail) return null;
        const user = await authService.provisionEcommerceMerchantUser(
            storeInfo.storeEmail,
            storeInfo.storeName,
            'zid',
        );
        return user ? { userId: user.id } : null;
    },

    // A merchant reinstalling from the App Market has no browser session either.
    // The code exchange proves Zid sent us here for THIS store, so reactivate it
    // for its existing owner (fresh tokens, fresh embedded token) instead of
    // bouncing them to a login page saying it is already connected.
    reinstallPolicy: 'reactivate-for-owner',

    onDisconnect: (storeId, log) => revokeEmbeddedToken(storeId, log, 'disconnect'),

    postInstall: async (store, tokens, storeInfo, platformInitiated, log) => {
        const registered = await provisionEmbeddedToken(store.id, tokens, log);

        if (!platformInitiated) {
            // Merchant started from inside Jawab24 and still has their session.
            return null;
        }
        if (registered) {
            // Documented Zid flow: hand the merchant back to their dashboard,
            // which frames our app and authenticates it with the token above.
            return zidDashboardEmbeddedUrl(storeInfo.merchantId, log);
        }
        // No in-dashboard entry available — put them in the app in the browser
        // with a real session rather than a login wall or a dead iframe.
        //
        // SCOPED, for the same reason the iframe's session is (D-066/D-067): what
        // this branch has proved is the STORE, never the person. The store email
        // Zid handed us is attacker-settable, and `reinstallPolicy:
        // 'reactivate-for-owner'` means the owner may be a PRE-EXISTING Jawab24
        // account with other workspaces and possibly admin. An unscoped code here
        // redeems for a full, admin-capable session plus a 60-day refresh cookie —
        // the exact escalation the handoff bridge was just fixed to refuse, at the
        // sibling seam.
        const store_ = await getStoreById(store.id);
        if (!store_) return null;
        // `?? resolveDefaultWorkspaceId` covers legacy rows installed before stores
        // carried a workspace — same fallback as embeddedSession.ts. With neither
        // we hand out NOTHING rather than an unscoped session; the merchant meets
        // the login page, which is worse product but not an escalation. The install
        // guarantees a workspace, so this is a guard, not an expected path.
        const workspaceId = store_.workspaceId
            ?? await workspaceService.resolveDefaultWorkspaceId(store_.userId);
        if (!workspaceId) {
            log.error({ storeId: store.id, userId: store_.userId },
                'Zid post-install handoff skipped: no workspace to scope the session to');
            return null;
        }
        const code = await authService.mintBrowserHandoffCode(store_.userId, {
            embeddedPlatform: 'zid',
            workspaceId,
        });
        return `${config.frontendUrl}/auth/sync?code=${encodeURIComponent(code)}&redirect=${encodeURIComponent('/zid/onboarding')}`;
    },
});
