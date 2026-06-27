import { FastifyRequest, FastifyReply } from 'fastify';
import * as sallaService from '../services/salla';
import {
    getStoreByDomain,
    getStoreByMerchantId,
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
    if (event === 'order.shipment.created' || (isStatusUpdate && slug === 'shipped')) {
        return orderShippedEvent('salla', storeId, { customerPhone: phone, customerName, orderId, orderNumber, trackingNumber });
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
