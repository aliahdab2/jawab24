import { FastifyRequest, FastifyReply } from 'fastify';
import * as zidService from '../services/zid';
import {
    resolveStoreByDomainOrMerchant,
    deactivateStore,
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
import { createEcommerceControllers } from './ecommerceControllers';

// OAuth flow (authRedirect + authCallback) is shared via createEcommerceControllers
// — see the adapter wiring at the bottom of this file.

// --- Webhook (single endpoint — dispatches by event type in body) ---

function verifyZidWebhookHmac(request: FastifyRequest, reply: FastifyReply): boolean {
    const signature = request.headers['x-zid-signature'] as string;
    const rawBody = request.rawBody;
    if (!rawBody) {
        reply.status(401).send({ error: 'Missing raw body for HMAC verification' });
        return false;
    }
    const body = rawBody.toString('utf8');
    if (!signature || !zidService.verifyWebhookHmac(body, signature)) {
        reply.status(401).send({ error: 'Invalid HMAC' });
        return false;
    }
    return true;
}

export async function webhookHandler(request: FastifyRequest, reply: FastifyReply) {
    if (!verifyZidWebhookHmac(request, reply)) return;

    const { event, store_id } = request.body as { event?: string; store_id?: string };

    if (!store_id) {
        return reply.status(200).send({ ok: true });
    }

    // Zid may send a numeric merchant ID or a domain string.
    // Try domain lookup first; fall back to platformData.merchantId.
    const resolveStore = () => resolveStoreByDomainOrMerchant('zid', store_id);

    if (event === 'app.uninstalled') {
        const store = await resolveStore();
        if (store) await deactivateStore('zid', store.storeDomain);
        return reply.status(200).send({ ok: true });
    }

    // product_update, NOT full_sync: store info doesn't change when a product does
    // (see the Salla controller's product.* branch for the full rationale).
    if (zidService.isProductEvent(event || '')) {
        const store = await resolveStore();
        if (store) {
            enqueueSyncJob(store.id, 'zid', 'product_update').catch(err => {
                request.log.error({ err }, 'Failed to enqueue Zid product sync');
            });
        }
    }

    if (event && zidService.isOrderEvent(event)) {
        const store = await resolveStore();
        if (store) {
            const orderEvent = buildZidOrderEvent(store.id, event, request.body);
            if (orderEvent) dispatchOrderNotification(orderEvent, request.log);
        }
    }

    return reply.status(200).send({ ok: true });
}

interface ZidOrderData {
    id?: string;
    number?: string;
    customer?: { name?: string; mobile?: string };
    tracking_number?: string;
}

function buildZidOrderEvent(storeId: string, event: string, body: unknown): OrderEvent | null {
    const { data } = body as { data?: ZidOrderData };
    if (!data) return null;

    const phone = data.customer?.mobile;
    if (!phone) return null;

    const orderId = data.id ?? '';
    const orderNumber = data.number ?? orderId;
    const trackingNumber = data.tracking_number;
    const customerName = data.customer?.name;

    if (event === 'order.created') {
        return orderConfirmedEvent('zid', storeId, { customerPhone: phone, customerName, orderId, orderNumber });
    } else if (event === 'order.shipped') {
        return orderShippedEvent('zid', storeId, { customerPhone: phone, customerName, orderId, orderNumber, trackingNumber });
    } else if (event === 'order.delivered') {
        return orderDeliveredEvent('zid', storeId, { customerPhone: phone, customerName, orderId, orderNumber });
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
    fetchStoreInfo: zidService.fetchStoreInfo,
    registerWebhooks: (accessToken: string) => zidService.registerWebhooks(accessToken),
    scopes: config.zid.scopes,
    pendingCookieName: 'pendingZidId',
    pendingCookieOptions: PENDING_ZID_COOKIE_OPTIONS,
});
