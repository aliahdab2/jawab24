import crypto from 'crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import * as zidService from '../services/zid';
import {
    getStoreByDomain,
    getStoreByMerchantId,
    createStore,
    deactivateStore,
    createPendingInstall,
    registerWebhooksWithPersist,
} from '../services/ecommerce';
import { dispatchOrderNotification } from '../services/orderNotificationScheduler';
import type { OrderEvent } from '../services/orderNotificationScheduler';
import { workspaceService } from '../services/workspace';
import { enqueueSyncJob } from '../lib/ecommerceSyncQueue';
import { config } from '../config';
import {
    PENDING_ZID_COOKIE_OPTIONS,
    ZID_NONCE_COOKIE_OPTIONS,
} from '../services/cookies';
import { tryGetUserId } from '../utils/authHelpers';
import { createEcommerceControllers } from './ecommerceControllers';

// --- OAuth Flow (PUBLIC — no JWT required) ---

export async function authRedirect(_request: FastifyRequest, reply: FastifyReply) {
    const nonce = crypto.randomBytes(16).toString('hex');

    reply.setCookie('zidNonce', nonce, ZID_NONCE_COOKIE_OPTIONS);

    const authUrl = zidService.buildAuthUrl(nonce);
    return reply.redirect(authUrl);
}

export async function authCallback(request: FastifyRequest, reply: FastifyReply) {
    const { code, state } = request.query as {
        code?: string; state?: string;
    };

    const nonceCookie = request.cookies.zidNonce;
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

    reply.clearCookie('zidNonce', { path: '/' });

    const frontendUrl = config.frontendUrl;

    try {
        const tokens = await zidService.exchangeCodeForToken(code);
        const storeInfo = await zidService.fetchStoreInfo(tokens.accessToken);

        const userId = tryGetUserId(request);

        if (userId) {
            // --- LOGGED IN: Create store directly ---
            const workspaces = await workspaceService.getUserWorkspaces(userId);
            const workspaceId = workspaces[0]?.id || null;

            const store = await createStore({
                userId,
                platform: 'zid',
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

            // Register webhooks with persist-on-throw + retry queue. Mirrors
            // the Shopify install path. Install must NOT fail because of webhook
            // hiccups — the helper persists a "failed: all" marker and enqueues
            // a retry so the integrations card surfaces a Re-register CTA.
            await registerWebhooksWithPersist(
                store.id,
                'zid',
                () => zidService.registerWebhooks(tokens.accessToken),
            );

            // Enqueue full sync (non-blocking)
            enqueueSyncJob(store.id, 'zid').catch(err => {
                request.log.error({ err }, 'Failed to enqueue Zid sync');
            });

            return reply.redirect(`${frontendUrl}/zid/onboarding`);
        } else {
            // --- NOT LOGGED IN: Create pending install ---
            const existingStore = await getStoreByDomain('zid', storeInfo.storeDomain);
            if (existingStore && existingStore.isActive) {
                return reply.redirect(`${frontendUrl}/login?zid_error=already_connected`);
            }

            const pendingId = await createPendingInstall('zid', {
                storeDomain: storeInfo.storeDomain,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
                scopes: config.zid.scopes,
                nonce: state,
            });

            reply.setCookie('pendingZidId', pendingId, PENDING_ZID_COOKIE_OPTIONS);

            return reply.redirect(`${frontendUrl}/login?zid_pending=true`);
        }
    } catch (error) {
        request.log.error({ error }, 'Zid auth callback failed');
        return reply.redirect(`${frontendUrl}/login?zid_error=auth_failed`);
    }
}

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
    const resolveStore = async () => {
        const byDomain = await getStoreByDomain('zid', store_id);
        if (byDomain) return byDomain;
        return getStoreByMerchantId('zid', store_id);
    };

    if (event === 'app.uninstalled') {
        const store = await resolveStore();
        if (store) await deactivateStore('zid', store.storeDomain);
        return reply.status(200).send({ ok: true });
    }

    if (zidService.isProductEvent(event || '')) {
        const store = await resolveStore();
        if (store) {
            enqueueSyncJob(store.id, 'zid').catch(err => {
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
        return { platform: 'zid', storeId, type: 'order_confirmed', customerPhone: phone, customerName, orderId, orderNumber };
    } else if (event === 'order.shipped') {
        return { platform: 'zid', storeId, type: 'order_shipped', customerPhone: phone, customerName, orderId, orderNumber, trackingNumber };
    } else if (event === 'order.delivered') {
        return {
            platform: 'zid', storeId, type: 'order_delivered',
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
} = createEcommerceControllers('zid', {
    fullSync: zidService.fullSync,
    buildAuthUrl: zidService.buildAuthUrl,
    nonceCookieName: 'zidNonce',
    nonceCookieOptions: ZID_NONCE_COOKIE_OPTIONS,
});
