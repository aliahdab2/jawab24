import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import * as sallaService from '../services/salla';
import {
    getStoreByDomain,
    createStore,
    deactivateStore,
    createPendingInstall,
} from '../services/ecommerce';
import { dispatchOrderNotification } from '../services/orderNotificationScheduler';
import type { OrderEvent } from '../services/orderNotificationScheduler';
import { workspaceService } from '../services/workspace';
import { enqueueSyncJob } from '../lib/ecommerceSyncQueue';
import { config } from '../config';
import {
    PENDING_SALLA_COOKIE_OPTIONS,
    SALLA_NONCE_COOKIE_OPTIONS,
} from '../services/cookies';
import { tryGetUserId } from '../utils/authHelpers';
import { createEcommerceControllers } from './ecommerceControllers';

// --- OAuth Flow (PUBLIC — no JWT required) ---

export async function authRedirect(_request: FastifyRequest, reply: FastifyReply) {
    // Salla doesn't need a shop domain — merchant authenticates directly
    const nonce = crypto.randomBytes(16).toString('hex');

    reply.setCookie('sallaNonce', nonce, SALLA_NONCE_COOKIE_OPTIONS);

    const authUrl = sallaService.buildAuthUrl(nonce);
    return reply.redirect(authUrl);
}

export async function authCallback(request: FastifyRequest, reply: FastifyReply) {
    const { code, state } = request.query as {
        code?: string; state?: string;
    };

    // Validate nonce from signed cookie matches state param
    const nonceCookie = request.cookies.sallaNonce;
    let storedNonce: string | null = null;
    if (nonceCookie) {
        const unsigned = request.unsignCookie(nonceCookie);
        if (unsigned.valid && unsigned.value) {
            storedNonce = unsigned.value;
        }
    }

    if (!code || !state || state !== storedNonce) {
        return reply.status(400).send({ error: 'Invalid OAuth callback: state mismatch' });
    }

    // Clear the nonce cookie
    reply.clearCookie('sallaNonce', { path: '/' });

    const frontendUrl = config.frontendUrl;

    try {
        // Exchange code for tokens
        const tokens = await sallaService.exchangeCodeForToken(code);

        // Fetch store info to get domain (used as unique identifier)
        const storeInfo = await sallaService.fetchStoreInfo(tokens.accessToken);

        // Check if user is already logged in
        const userId = tryGetUserId(request);

        if (userId) {
            // --- LOGGED IN: Create store directly ---
            const workspaces = await workspaceService.getUserWorkspaces(userId);
            const workspaceId = workspaces[0]?.id || null;

            const store = await createStore({
                userId,
                platform: 'salla',
                storeDomain: storeInfo.storeDomain,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
                shopInfo: {
                    shopName: storeInfo.storeName,
                    shopEmail: storeInfo.storeEmail,
                    shopCurrency: storeInfo.storeCurrency,
                },
                platformData: { merchantId: storeInfo.merchantId },
                workspaceId,
            });

            // Register webhooks (non-blocking)
            sallaService.registerWebhooks(tokens.accessToken).catch(err => {
                request.log.error({ err }, 'Failed to register Salla webhooks');
            });

            // Enqueue full sync (non-blocking)
            enqueueSyncJob(store.id, 'salla').catch(err => {
                request.log.error({ err }, 'Failed to enqueue Salla sync');
            });

            return reply.redirect(`${frontendUrl}/salla/onboarding`);
        } else {
            // --- NOT LOGGED IN: Create pending install ---
            const existingStore = await getStoreByDomain('salla', storeInfo.storeDomain);
            if (existingStore && existingStore.isActive) {
                return reply.redirect(`${frontendUrl}/login?salla_error=already_connected`);
            }

            const pendingId = await createPendingInstall('salla', {
                storeDomain: storeInfo.storeDomain,
                accessToken: tokens.accessToken,
                scopes: config.salla.scopes,
                nonce: state,
            });

            reply.setCookie('pendingSallaId', pendingId, PENDING_SALLA_COOKIE_OPTIONS);

            return reply.redirect(`${frontendUrl}/login?salla_pending=true`);
        }
    } catch (error) {
        request.log.error({ error }, 'Salla auth callback failed');
        return reply.redirect(`${frontendUrl}/login?salla_error=auth_failed`);
    }
}

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
    status?: { name?: string };
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
    } else if (event === 'order.shipping.update' || (event === 'order.updated' && data.status?.name === 'in_transit')) {
        return { platform: 'salla', storeId, type: 'order_shipped', customerPhone: phone, customerName, orderId, orderNumber, trackingNumber };
    } else if (event === 'order.completed') {
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
});
