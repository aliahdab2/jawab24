import crypto from 'crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import * as zidService from '../services/zid';
import {
    resolveStoreByDomainOrMerchant,
    deactivateStore,
    getStoreById,
    setEmbeddedTokenHash,
    getStoreByEmbeddedTokenHash,
} from '../services/ecommerce';
import { authService } from '../services/auth';
import { workspaceService } from '../services/workspace';
import { captureError } from '../utils/sentryHelpers';
import {
    dispatchOrderNotification,
    orderConfirmedEvent,
    orderShippedEvent,
    orderDeliveredEvent,
} from '../services/orderNotificationScheduler';
import type { OrderEvent } from '../services/orderNotificationScheduler';
import { enqueueSyncJob } from '../lib/ecommerceSyncQueue';
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
// Threat model: that UUID IS a merchant credential — anyone holding it can open a
// session for the store. So we (a) store only its SHA-256, (b) mint a NEW one on
// every (re)install so a leaked value dies at the next install, (c) revoke it at
// Zid and clear the hash on uninstall, and (d) trade it only for the SAME
// short-lived access token a normal login issues, never a long-lived one.

/** SHA-256 hex of an embedded-app UUID — only the digest is ever persisted. */
export function hashEmbeddedToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Zid's post-install destination: the app opened INSIDE the merchant dashboard.
 * `store_id`/`language_code` may be any valid value — Zid's Hermes resolves the
 * real store and language from the merchant's dashboard session.
 */
function zidDashboardEmbeddedUrl(merchantId: string | undefined): string {
    const storeSegment = merchantId && merchantId.trim() ? encodeURIComponent(merchantId) : '1';
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
    if (!tokens.authorizationToken) return false;
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
export async function revokeEmbeddedToken(storeId: string, log: FastifyRequest['log']): Promise<void> {
    try {
        const creds = await zidService.resolveZidCredentials(storeId);
        if (creds) await zidService.deleteEmbeddedToken(creds);
    } catch (error) {
        // Expected when Zid has already invalidated the tokens at uninstall —
        // log at debug-free level without Sentry noise, then clear ours anyway.
        log.warn({ err: error, storeId }, 'Zid embedded-token revocation at Zid failed — clearing local hash anyway');
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
 * the iframe URL by design. Returns the same short-lived access token a normal
 * login issues; the page re-calls this endpoint when that token expires, so no
 * long-lived bearer token is ever created.
 */
export async function embeddedSession(request: FastifyRequest, reply: FastifyReply) {
    const { token } = (request.body ?? {}) as { token?: string };
    if (!token || typeof token !== 'string') {
        return reply.status(400).send({ error: 'Missing embedded token' });
    }

    const store = await getStoreByEmbeddedTokenHash('zid', hashEmbeddedToken(token));
    if (!store) {
        // Unknown, rotated, or revoked (uninstalled) token.
        return reply.status(401).send({ error: 'Invalid embedded token' });
    }

    const user = await authService.getUserById(store.userId);
    if (!user) {
        // Owner deleted while the store row survived — nothing to open a session as.
        return reply.status(401).send({ error: 'Invalid embedded token' });
    }

    const accessToken = authService.generateToken(user);
    const defaultWorkspaceId = store.workspaceId
        ?? await workspaceService.resolveDefaultWorkspaceId(user.id);

    return reply.send({
        token: accessToken,
        defaultWorkspaceId,
        storeId: store.id,
        storeName: store.storeName,
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
            await deactivateStore('zid', store.storeDomain);
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
    code?: string | number;
    order_status?: { name?: string; code?: string };
    status?: string | { name?: string; code?: string };
    customer?: { name?: string; mobile?: string | number };
    tracking_number?: string;
    shipping?: { tracking_number?: string };
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
    const orderNumber = data.code !== undefined && data.code !== null ? String(data.code) : orderId;
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
            const trackingNumber = data.tracking_number || data.shipping?.tracking_number;
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

    onDisconnect: revokeEmbeddedToken,

    postInstall: async (store, tokens, storeInfo, platformInitiated, log) => {
        const registered = await provisionEmbeddedToken(store.id, tokens, log);

        if (!platformInitiated) {
            // Merchant started from inside Jawab24 and still has their session.
            return null;
        }
        if (registered) {
            // Documented Zid flow: hand the merchant back to their dashboard,
            // which frames our app and authenticates it with the token above.
            return zidDashboardEmbeddedUrl(storeInfo.merchantId);
        }
        // No in-dashboard entry available — put them in the app in the browser
        // with a real session rather than a login wall or a dead iframe.
        const store_ = await getStoreById(store.id);
        if (!store_) return null;
        const code = await authService.mintBrowserHandoffCode(store_.userId);
        return `${config.frontendUrl}/auth/sync?code=${encodeURIComponent(code)}&redirect=${encodeURIComponent('/zid/onboarding')}`;
    },
});
