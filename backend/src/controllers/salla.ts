import { FastifyRequest, FastifyReply, FastifyBaseLogger } from 'fastify';
import * as sallaService from '../services/salla';
import {
    getStoreByDomain,
    getStoreByMerchantId,
    deactivateStore,
    updateStoreTokens,
    createPendingInstall,
    claimPendingInstall,
    claimPendingInstallByMerchantId,
    listPendingInstalls,
    saveWebhookStatus,
    EASY_MODE_PENDING_TTL_MS,
} from '../services/ecommerce';
import { tryGetUserId } from '../utils/authHelpers';
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
    PENDING_SALLA_COOKIE_OPTIONS,
    SALLA_NONCE_COOKIE_OPTIONS,
} from '../services/cookies';
import { createEcommerceControllers } from './ecommerceControllers';

// OAuth flow (authRedirect + authCallback) is shared via createEcommerceControllers
// — see the adapter wiring at the bottom of this file.

// --- Webhook (single endpoint — dispatches by event type in body) ---

function verifySallaWebhookHmac(request: FastifyRequest, reply: FastifyReply): boolean {
    const signature = request.headers['x-salla-signature'] as string;
    const rawBody = request.rawBody;
    if (!rawBody) {
        reply.status(401).send({ error: 'Missing raw body for HMAC verification' });
        return false;
    }
    const body = rawBody.toString('utf8');
    if (!signature || !sallaService.verifyWebhookHmac(body, signature)) {
        reply.status(401).send({ error: 'Invalid HMAC' });
        return false;
    }
    return true;
}

/**
 * Single webhook handler for all Salla events.
 * Dispatches to the correct action based on the `event` field in the body.
 */
export async function webhookHandler(request: FastifyRequest, reply: FastifyReply) {
    if (!verifySallaWebhookHmac(request, reply)) return;

    const { event, merchant } = request.body as { event?: string; merchant?: number };

    if (!merchant) {
        return reply.status(200).send({ ok: true });
    }

    // Easy Mode (the only mode allowed for PUBLISHED Salla apps): the OAuth callback is
    // never hit — Salla pushes the access/refresh tokens here, server-to-server, on
    // install and RE-fires the same event to deliver refreshed tokens.
    if (event === 'app.store.authorize') {
        await handleStoreAuthorize(merchant, request.body, request.log);
        return reply.status(200).send({ ok: true });
    }

    // Salla webhooks identify the store by its numeric `merchant` id, which is
    // persisted in platformData.merchantId — NOT in the storeDomain column (that
    // holds the real domain). Try domain first for safety, then fall back to the
    // merchantId lookup. Without the fallback, getStoreByDomain(String(merchant))
    // never matches and EVERY Salla webhook silently no-ops in production —
    // including app.uninstalled, so tokens/processing would survive an uninstall.
    // Mirrors the Zid controller's resolveStore().
    const resolveStore = async () => {
        const byDomain = await getStoreByDomain('salla', String(merchant));
        if (byDomain) return byDomain;
        return getStoreByMerchantId('salla', String(merchant));
    };

    if (event === 'app.uninstalled') {
        const store = await resolveStore();
        if (store) await deactivateStore('salla', store.storeDomain);
        return reply.status(200).send({ ok: true });
    }

    // All product.* events trigger a sync
    if (sallaService.isProductEvent(event || '')) {
        const store = await resolveStore();
        if (store) {
            enqueueSyncJob(store.id, 'salla').catch(err => {
                request.log.error({ err }, 'Failed to enqueue Salla product sync');
            });
        }
    }

    // Order lifecycle and abandoned cart — schedule customer notifications
    if (event && sallaService.isOrderEvent(event)) {
        const store = await resolveStore();
        if (store) {
            const orderEvent = buildSallaOrderEvent(store.id, event, request.body);
            if (orderEvent) dispatchOrderNotification(orderEvent, request.log);
        }
    }

    return reply.status(200).send({ ok: true });
}

// --- Easy Mode: app.store.authorize token receipt ---

// Verified payload (docs.salla.dev): { event:'app.store.authorize', merchant:<int>,
//   data:{ access_token, refresh_token, expires:<UNIX SECONDS>, scope, token_type } }.
interface SallaAuthorizeData {
    access_token?: string;
    refresh_token?: string;
    expires?: number; // unix timestamp in SECONDS, NOT a duration
    scope?: string;
}

/**
 * Handle Salla Easy Mode `app.store.authorize` (HMAC already verified by the caller).
 *
 *  • Re-fire for an already-connected store (Salla re-sends the event to deliver a
 *    refreshed token) → update the store's tokens in place. Idempotent.
 *  • Fresh install (no store yet) → stage a merchant-id-keyed PENDING install. The
 *    merchant claims it after logging into Jawab24 (see claimStoreHandler). Webhooks
 *    are registered at claim time (mirrors the cookie flow) — there's no linked page
 *    to notify until then anyway.
 */
export async function handleStoreAuthorize(
    merchant: number,
    body: unknown,
    log: FastifyBaseLogger,
): Promise<void> {
    const { data } = body as { data?: SallaAuthorizeData };
    const accessToken = data?.access_token;
    if (!accessToken) {
        log.error({ merchant }, 'Salla app.store.authorize missing access_token — ignoring');
        return;
    }
    const refreshToken = data?.refresh_token;
    const tokenExpiresAt = typeof data?.expires === 'number' ? new Date(data.expires * 1000) : undefined;
    const merchantId = String(merchant);

    const existing = await getStoreByMerchantId('salla', merchantId);
    if (existing) {
        await updateStoreTokens(existing.id, { accessToken, refreshToken, tokenExpiresAt });
        return;
    }

    // Fresh install: resolve the domain/name from the pushed token, then stage the claim.
    const storeInfo = await sallaService.fetchStoreInfo(accessToken);
    await createPendingInstall('salla', {
        storeDomain: storeInfo.storeDomain,
        storeName: storeInfo.storeName,
        merchantId,
        accessToken,
        refreshToken,
        tokenExpiresAt,
        scopes: config.salla.scopes,
        nonce: '', // no OAuth nonce — Easy Mode never hits the callback; claim keys off merchantId
        ttlMs: EASY_MODE_PENDING_TTL_MS,
    });
}

// --- Easy Mode: post-install claim (no browser cookie) ---

const registerSallaWebhooks = (_storeDomain: string, accessToken: string) =>
    sallaService.registerWebhooks(accessToken);

/**
 * GET /salla/store/pending?merchantId=<id> — list the Easy-Mode pending install(s) for a
 * merchant so the post-install landing page can show "connect your store '<name>'".
 *
 * SECURITY: `merchantId` is REQUIRED — we never return an unscoped list of every
 * merchant's pending install. Returns non-secret summary fields only (no tokens).
 */
export async function listPendingHandler(request: FastifyRequest, reply: FastifyReply) {
    // Dormant until the ownership binding is hardened (see config.salla.easyModeClaimEnabled).
    if (!config.salla.easyModeClaimEnabled) return reply.status(404).send({ error: 'Not found' });
    const userId = tryGetUserId(request);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { merchantId } = request.query as { merchantId?: string };
    if (!merchantId) return reply.status(400).send({ error: 'merchantId is required' });

    const pending = await listPendingInstalls('salla', merchantId);
    return reply.send({ pending });
}

/**
 * POST /salla/store/claim { pendingId } | { merchantId } — claim a staged Easy-Mode
 * install for the logged-in user. Registers webhooks inline (claim time).
 *
 * SECURITY — DORMANT (flag off → 404) until the ownership binding is built. A raw
 * client-supplied `merchantId` is NOT proof of ownership: on its own this path would let
 * any logged-in user claim another merchant's store + token. The binding is deferred
 * pending ONE unconfirmed Salla behaviour — can a published Easy-Mode app initiate the
 * OAuth authorize redirect for identity? — which bifurcates the design (OAuth-round-trip
 * proof vs. owner-email match). See DECISIONS.md D-012 for the two branches + the exact
 * question to Salla. NOTE: `finalizeClaim`'s owner-conflict guard only blocks re-claiming
 * an already-ACTIVE store; it does NOT prove the claimer owns THIS pending row.
 */
export async function claimStoreHandler(request: FastifyRequest, reply: FastifyReply) {
    // Dormant until the ownership binding is hardened (see config.salla.easyModeClaimEnabled).
    if (!config.salla.easyModeClaimEnabled) return reply.status(404).send({ error: 'Not found' });
    const userId = tryGetUserId(request);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { pendingId, merchantId } = request.body as { pendingId?: string; merchantId?: string };
    if (!pendingId && !merchantId) {
        return reply.status(400).send({ error: 'pendingId or merchantId is required' });
    }

    try {
        const store = pendingId
            ? await claimPendingInstall(pendingId, userId, 'salla', registerSallaWebhooks, saveWebhookStatus)
            : await claimPendingInstallByMerchantId(merchantId as string, userId, 'salla', registerSallaWebhooks, saveWebhookStatus);

        if (!store) return reply.status(404).send({ error: 'No claimable Salla install found' });
        return reply.send({ sallaOnboarding: true, ecommerceStoreId: store.id });
    } catch (err) {
        if (err instanceof Error && err.message.includes('already connected')) {
            return reply.status(409).send({ error: err.message });
        }
        request.log.error({ err }, 'Failed to claim Salla install');
        return reply.status(500).send({ error: 'Failed to claim Salla install' });
    }
}

// Salla delivers TWO different order payload shapes (verified against live dev-store
// webhooks, 2026-06-07 — see SALLA_LAUNCH_VALIDATION.md §S4):
//   • order.created / order.updated — order fields are FLAT under `data`; `data.status`
//     is an object (`data.status.slug`); the customer's mobile is a bare local number
//     (`data.customer.mobile`) plus a separate `data.customer.mobile_code` (e.g. "+971").
//   • order.status.updated — the order is NESTED under `data.order`; `data.status` is a
//     localized Arabic STRING (not an object); the stable status slug lives at
//     `data.customized.slug`; the customer mobile is already in full international form.
// Always branch on the English `slug`, never the localized `name`.
interface SallaCustomer {
    first_name?: string;
    name?: string;
    mobile?: string | number;
    mobile_code?: string;
}

interface SallaOrderCore {
    id?: number;
    reference_id?: number;
    customer?: SallaCustomer;
    shipments?: Array<{ tracking_number?: string }>;
    amounts?: { sub_total?: { amount?: number; currency?: string } };
    currency?: string;
}

interface SallaWebhookData extends SallaOrderCore {
    status?: { slug?: string };           // present on order.created / order.updated
    customized?: { slug?: string };        // status slug on order.status.updated
    order?: SallaOrderCore;                // nested order on order.status.updated
    total?: { amount?: number; currency?: string }; // best-effort for abandoned.cart
}

// order.shipment.created — `data` IS the shipment (NOT an order). The customer lives
// under `ship_to` (with `phone` already a single consolidated international string — no
// mobile_code split), and the tracking number is a top-level field. Ref: docs.salla.dev
// "Shipments Webhook Events Model".
interface SallaShipmentData {
    id?: number;
    order_id?: number;
    order_reference_id?: number;
    tracking_number?: string;
    tracking_link?: string;
    courier_name?: string;
    status?: string;
    ship_to?: { name?: string; phone?: string };
}

// order.status.updated (slug 'shipped') carries no tracking number. Hold the shipped SMS
// briefly so a following order.shipment.created can upgrade the row in place with tracking,
// while still guaranteeing a single SMS for merchants whose flow never fires shipment.created.
const SHIPPED_NO_TRACKING_GRACE_MS = 5 * 60 * 1000;

/** Build a full international phone from Salla's split `mobile` + `mobile_code`.
 *  Delegates to the shared `composeSallaPhone` (single source of truth — also used
 *  by the order/shipment agent tools in services/salla.ts). */
function normalizeSallaPhone(customer?: SallaCustomer): string | undefined {
    return sallaService.composeSallaPhone(customer?.mobile, customer?.mobile_code);
}

function sallaCustomerName(customer?: SallaCustomer): string | undefined {
    return customer?.first_name ?? customer?.name;
}

function formatSallaTotal(data: SallaWebhookData): string | undefined {
    const sub = data.amounts?.sub_total;
    if (typeof sub?.amount === 'number') return `${sub.amount} ${sub.currency ?? data.currency ?? ''}`.trim();
    if (typeof data.total?.amount === 'number') return `${data.total.amount} ${data.total.currency ?? ''}`.trim();
    return undefined;
}

function buildSallaOrderEvent(storeId: string, event: string, body: unknown): OrderEvent | null {
    const { data } = body as { data?: SallaWebhookData };
    if (!data) return null;

    if (event === 'abandoned.cart') {
        const phone = normalizeSallaPhone(data.customer);
        if (!phone) return null;
        return {
            platform: 'salla', storeId, type: 'abandoned_cart',
            customerPhone: phone, customerName: sallaCustomerName(data.customer),
            orderId: String(data.id ?? ''), orderNumber: String(data.id ?? ''),
            cartTotal: formatSallaTotal(data),
        };
    }

    // order.shipment.created has a shipment-shaped payload (not an order): customer under
    // `ship_to`, tracking at the top level. Handle it before the order/slug resolution
    // below, which would otherwise read the (absent) `data.customer` and drop the event.
    if (event === 'order.shipment.created') {
        const shipment = (body as { data?: SallaShipmentData }).data;
        const phone = shipment?.ship_to?.phone?.trim();
        if (!shipment || !phone) return null;
        const orderId = String(shipment.order_id ?? '');
        const rawTracking = shipment.tracking_number?.trim();
        const trackingNumber = rawTracking && rawTracking !== '0' ? rawTracking : undefined;
        return orderShippedEvent('salla', storeId, {
            customerPhone: phone,
            customerName: shipment.ship_to?.name,
            orderId,
            orderNumber: String(shipment.order_reference_id ?? shipment.order_id ?? ''),
            trackingNumber,
            // Shares the dedup key salla:order_shipped:<order_id> with the status path;
            // if a tracking-less status-update row is already pending, upgrade it in place.
            upgradePendingOnDuplicate: true,
        });
    }

    // Resolve the order + slug from whichever shape this event uses.
    const isStatusUpdate = event === 'order.status.updated';
    const order: SallaOrderCore = isStatusUpdate ? (data.order ?? {}) : data;
    const slug = isStatusUpdate ? data.customized?.slug : data.status?.slug;

    const phone = normalizeSallaPhone(order.customer);
    if (!phone) return null;

    const orderId = String(order.id ?? '');
    const orderNumber = typeof order.reference_id === 'number' ? String(order.reference_id) : orderId;
    const customerName = sallaCustomerName(order.customer);
    const trackingNumber = order.shipments?.[0]?.tracking_number;

    if (event === 'order.created') {
        return orderConfirmedEvent('salla', storeId, { customerPhone: phone, customerName, orderId, orderNumber });
    }
    // `order.updated` fires alongside `order.status.updated` on every status change —
    // notifications are driven solely off `order.status.updated` to avoid double-sending.
    if (isStatusUpdate && slug === 'shipped') {
        // The status-update payload never carries tracking. Hold the SMS briefly
        // (SHIPPED_NO_TRACKING_GRACE_MS) so a following order.shipment.created can upgrade
        // this row with the tracking number; if none arrives, it still sends after the grace.
        return orderShippedEvent('salla', storeId, {
            customerPhone: phone, customerName, orderId, orderNumber, trackingNumber,
            minDelayMs: SHIPPED_NO_TRACKING_GRACE_MS,
        });
    }
    if (isStatusUpdate && (slug === 'completed' || slug === 'delivered')) {
        return orderDeliveredEvent('salla', storeId, { customerPhone: phone, customerName, orderId, orderNumber });
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
} = createEcommerceControllers('salla', {
    fullSync: sallaService.fullSync,
    buildAuthUrl: sallaService.buildAuthUrl,
    nonceCookieName: 'sallaNonce',
    nonceCookieOptions: SALLA_NONCE_COOKIE_OPTIONS,
    exchangeCodeForToken: sallaService.exchangeCodeForToken,
    fetchStoreInfo: sallaService.fetchStoreInfo,
    registerWebhooks: (accessToken: string) => sallaService.registerWebhooks(accessToken),
    scopes: config.salla.scopes,
    pendingCookieName: 'pendingSallaId',
    pendingCookieOptions: PENDING_SALLA_COOKIE_OPTIONS,
});
