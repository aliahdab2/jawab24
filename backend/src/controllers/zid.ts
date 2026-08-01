import { FastifyRequest, FastifyReply } from 'fastify';
import * as zidService from '../services/zid';
import {
    resolveStoreByDomainOrMerchant,
    deactivateStore,
    getStoreById,
} from '../services/ecommerce';
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
        if (store) await deactivateStore('zid', store.storeDomain);
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
});
