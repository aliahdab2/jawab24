import { FastifyRequest, FastifyReply } from 'fastify';
import * as sallaService from '../services/salla';
import {
    getStoreByDomain,
    deactivateStore,
} from '../services/ecommerce';
import { dispatchOrderNotification } from '../services/orderNotificationScheduler';
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

    if (event === 'app.uninstalled') {
        await deactivateStore('salla', String(merchant));
        return reply.status(200).send({ ok: true });
    }

    // All product.* events trigger a sync
    if (sallaService.isProductEvent(event || '')) {
        const store = await getStoreByDomain('salla', String(merchant));
        if (store) {
            enqueueSyncJob(store.id, 'salla').catch(err => {
                request.log.error({ err }, 'Failed to enqueue Salla product sync');
            });
        }
    }

    // Order lifecycle and abandoned cart — schedule customer notifications
    if (event && sallaService.isOrderEvent(event)) {
        const store = await getStoreByDomain('salla', String(merchant));
        if (store) {
            const orderEvent = buildSallaOrderEvent(store.id, event, request.body);
            if (orderEvent) dispatchOrderNotification(orderEvent, request.log);
        }
    }

    return reply.status(200).send({ ok: true });
}

interface SallaOrderData {
    id?: number;
    reference?: string;
    customer?: { first_name?: string; mobile?: string };
    total?: { amount?: number; currency?: string };
    // Branch on `slug` (stable English id) — `name` is localized Arabic.
    // Verified against a live order.created payload (data.status.slug, flat under data).
    status?: { slug?: string; name?: string };
    shipments?: Array<{ tracking_number?: string }>;
}

function buildSallaOrderEvent(storeId: string, event: string, body: unknown): OrderEvent | null {
    const { data } = body as { data?: SallaOrderData };
    if (!data) return null;

    if (event === 'abandoned.cart') {
        const phone = data.customer?.mobile;
        if (!phone) return null;
        const cartTotal = data.total ? `${data.total.amount} ${data.total.currency ?? ''}`.trim() : undefined;
        return {
            platform: 'salla', storeId, type: 'abandoned_cart',
            customerPhone: phone, customerName: data.customer?.first_name,
            orderId: String(data.id ?? ''), orderNumber: String(data.id ?? ''),
            cartTotal,
        };
    }

    const phone = data.customer?.mobile;
    if (!phone) return null;

    const orderId = String(data.id ?? '');
    const orderNumber = data.reference ?? orderId;
    const trackingNumber = data.shipments?.[0]?.tracking_number;
    const customerName = data.customer?.first_name;

    if (event === 'order.created') {
        return { platform: 'salla', storeId, type: 'order_confirmed', customerPhone: phone, customerName, orderId, orderNumber };
    } else if (event === 'order.shipment.created' || (event === 'order.status.updated' && data.status?.slug === 'shipped')) {
        return { platform: 'salla', storeId, type: 'order_shipped', customerPhone: phone, customerName, orderId, orderNumber, trackingNumber };
    } else if (event === 'order.status.updated' && (data.status?.slug === 'completed' || data.status?.slug === 'delivered')) {
        return {
            platform: 'salla', storeId, type: 'order_delivered',
            customerPhone: phone, customerName, orderId, orderNumber,
            also: [{ type: 'review_request', variables: { review_url: '' } }],
        };
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
