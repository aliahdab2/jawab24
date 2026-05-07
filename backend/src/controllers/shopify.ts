import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import * as shopifyService from '../services/shopify';
import { workspaceService } from '../services/workspace';
import type { WorkspaceRequest } from '../middleware/workspace';
import { enqueueSyncJob } from '../lib/ecommerceSyncQueue';
import { upsertSingleProduct, deleteSingleProduct, registerWebhooksWithPersist } from '../services/ecommerce';
import { config } from '../config';
import { dispatchOrderNotification } from '../services/orderNotificationScheduler';
import type { OrderEvent } from '../services/orderNotificationScheduler';
import {
    PENDING_SHOPIFY_COOKIE_OPTIONS,
    SHOPIFY_NONCE_COOKIE_OPTIONS,
} from '../services/cookies';
import { tryGetUserId } from '../utils/authHelpers';
import { captureError } from '../utils/sentryHelpers';

/**
 * Tag a Shopify webhook crash for Sentry routing. Shopify retries 5xx
 * webhooks 19 times over 48h then silently gives up — without explicit
 * tags, a handler crash is undetectable from production noise.
 */
function reportWebhookFailure(
    request: FastifyRequest,
    webhookName: string,
    error: unknown,
) {
    captureError(error, `Shopify webhook handler failed: ${webhookName}`, {
        tags: {
            service: 'shopify',
            webhook: webhookName,
        },
        extra: {
            shopDomain: request.headers['x-shopify-shop-domain'],
            topic: request.headers['x-shopify-topic'],
            webhookId: request.headers['x-shopify-webhook-id'],
        },
    });
}

// --- OAuth Flow (PUBLIC — no JWT required) ---

export async function authRedirect(request: FastifyRequest, reply: FastifyReply) {
    const { shop } = request.query as { shop?: string };

    if (!shop || !/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
        return reply.status(400).send({ error: 'Invalid shop domain' });
    }

    // Generate cryptographic nonce for CSRF protection
    const nonce = crypto.randomBytes(16).toString('hex');

    // Set signed nonce cookie (sameSite: lax for cross-site Shopify redirect)
    reply.setCookie('shopifyNonce', nonce, SHOPIFY_NONCE_COOKIE_OPTIONS);

    const authUrl = shopifyService.buildAuthUrl(shop, nonce);
    return reply.redirect(authUrl);
}

/**
 * Verify Shopify OAuth callback query-string HMAC.
 * Shopify signs all query params (except `hmac` itself) with the app secret.
 * Used when Shopify initiates the install (no state/nonce available).
 */
function verifyCallbackHmac(query: Record<string, string>): boolean {
    const { hmac, ...params } = query;
    if (!hmac) return false;

    // Sort params alphabetically and build query string
    const message = Object.keys(params)
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('&');

    const digest = crypto
        .createHmac('sha256', config.shopify.apiSecret)
        .update(message)
        .digest('hex');

    // Timing-safe comparison
    const digestBuf = Buffer.from(digest);
    const hmacBuf = Buffer.from(hmac);
    if (digestBuf.length !== hmacBuf.length) return false;
    return crypto.timingSafeEqual(digestBuf, hmacBuf);
}

export async function authCallback(request: FastifyRequest, reply: FastifyReply) {
    const query = request.query as Record<string, string>;
    const { shop, code, state } = query;

    if (!shop || !code) {
        return reply.status(400).send({ error: 'Invalid OAuth callback: missing shop or code' });
    }

    // Two validation paths:
    // 1. User-initiated (from Jawab24 settings): validate state/nonce cookie
    // 2. Shopify-initiated (from Partners/App Store): validate HMAC query signature
    const nonceCookie = request.cookies.shopifyNonce;
    let storedNonce: string | null = null;
    if (nonceCookie) {
        const unsigned = request.unsignCookie(nonceCookie);
        if (unsigned.valid && unsigned.value) {
            storedNonce = unsigned.value;
        }
    }

    if (state && storedNonce) {
        // User-initiated flow: validate nonce
        if (state !== storedNonce) {
            return reply.status(400).send({ error: 'Invalid OAuth callback: state mismatch' });
        }
    } else {
        // Shopify-initiated flow: validate HMAC signature
        if (!verifyCallbackHmac(query)) {
            return reply.status(400).send({ error: 'Invalid OAuth callback: HMAC verification failed' });
        }
    }

    // Clear the nonce cookie
    reply.clearCookie('shopifyNonce', { path: '/' });

    const frontendUrl = config.frontendUrl;

    try {
        // Exchange code for access token
        const accessToken = await shopifyService.exchangeCodeForToken(shop, code);

        // Check if user is already logged in
        const userId = tryGetUserId(request);

        if (userId) {
            // --- LOGGED IN: Create store directly ---
            const workspaces = await workspaceService.getUserWorkspaces(userId);
            const workspaceId = workspaces[0]?.id || null;
            const store = await shopifyService.createStore(userId, shop, accessToken, undefined, workspaceId);

            // Register webhooks with persist-on-throw + retry queue (was
            // fire-and-forget; A-1.9). On any failure the helper persists a
            // marker and enqueues a retry so the merchant doesn't silently
            // miss webhooks.
            await registerWebhooksWithPersist(
                store.id,
                'shopify',
                () => shopifyService.registerWebhooks(shop, accessToken),
            );

            // Enqueue full sync (non-blocking)
            enqueueSyncJob(store.id).catch(err => {
                request.log.error({ err }, 'Failed to enqueue Shopify sync');
            });

            return reply.redirect(`${frontendUrl}/shopify/onboarding`);
        } else {
            // --- NOT LOGGED IN: Create pending install ---

            // Check if shop is already actively linked to a user
            const existingStore = await shopifyService.getStoreByDomain(shop);
            if (existingStore && existingStore.isActive) {
                return reply.redirect(`${frontendUrl}/login?shopify_error=already_connected`);
            }

            const pendingId = await shopifyService.createPendingInstall({
                shopDomain: shop,
                accessToken,
                scopes: config.shopify.scopes,
                nonce: state || crypto.randomBytes(16).toString('hex'),
            });

            // Set pending install cookie (sameSite: lax, 30min TTL)
            reply.setCookie('pendingShopifyId', pendingId, PENDING_SHOPIFY_COOKIE_OPTIONS);

            return reply.redirect(`${frontendUrl}/login?shopify_pending=true`);
        }
    } catch (error) {
        request.log.error({ error }, 'Shopify auth callback failed');
        return reply.redirect(`${frontendUrl}/login?shopify_error=auth_failed`);
    }
}

// --- Webhooks (Shopify calls these — HMAC verified) ---

export async function webhookUninstall(request: FastifyRequest, reply: FastifyReply) {
    try {
        if (!verifyShopifyWebhookHmac(request, reply)) return;

        const { myshopify_domain } = request.body as { myshopify_domain?: string };
        if (myshopify_domain) {
            await shopifyService.deactivateStore(myshopify_domain);
        }

        return reply.status(200).send({ ok: true });
    } catch (error) {
        reportWebhookFailure(request, 'app-uninstalled', error);
        throw error;
    }
}

export async function webhookProductsUpdate(request: FastifyRequest, reply: FastifyReply) {
    try {
        if (!verifyShopifyWebhookHmac(request, reply)) return;

        const shopDomain = request.headers['x-shopify-shop-domain'] as string;
        const topic = request.headers['x-shopify-topic'] as string;

        if (!shopDomain) {
            return reply.status(200).send({ ok: true });
        }

        const store = await shopifyService.getStoreByDomain(shopDomain);
        if (!store) {
            return reply.status(200).send({ ok: true });
        }

        // Per-row upsert — bug B-3.1. Editing one product no longer rotates
        // every other product's internal id. The 6h scheduled full-sync still
        // catches missed webhooks (now idempotent thanks to onConflictDoUpdate).
        const payload = request.body as { id?: number | string };
        if (!payload || payload.id === undefined || payload.id === null) {
            request.log.warn({ topic, shopDomain }, 'Shopify product webhook missing id');
            return reply.status(200).send({ ok: true });
        }

        if (topic === 'products/delete') {
            await deleteSingleProduct(store.id, String(payload.id));
        } else {
            // products/create + products/update
            const normalized = shopifyService.mapShopifyWebhookProduct(payload as never);
            // Stamp the store's currency since the REST webhook doesn't include it.
            normalized.currency = store.storeCurrency || normalized.currency;
            await upsertSingleProduct(store.id, normalized);
        }

        return reply.status(200).send({ ok: true });
    } catch (error) {
        reportWebhookFailure(request, 'products-update', error);
        throw error;
    }
}

export async function webhookOrders(request: FastifyRequest, reply: FastifyReply) {
    try {
        if (!verifyShopifyWebhookHmac(request, reply)) return;

        const shopDomain = request.headers['x-shopify-shop-domain'] as string;
        const topic = request.headers['x-shopify-topic'] as string;

        if (shopDomain) {
            const store = await shopifyService.getStoreByDomain(shopDomain);
            if (store) {
                const orderEvent = buildShopifyOrderEvent(store.id, topic, request.body);
                if (orderEvent) dispatchOrderNotification(orderEvent, request.log);
            }
        }

        return reply.status(200).send({ ok: true });
    } catch (error) {
        reportWebhookFailure(request, 'orders', error);
        throw error;
    }
}

interface ShopifyOrderBody {
    id?: number;
    order_number?: number;
    customer?: { phone?: string; first_name?: string };
    fulfillment_status?: string | null;
    fulfillments?: Array<{ tracking_number?: string }>;
}

function buildShopifyOrderEvent(storeId: string, topic: string, body: unknown): OrderEvent | null {
    const order = body as ShopifyOrderBody;
    const phone = order.customer?.phone;
    if (!phone) return null;

    const orderId = String(order.id ?? '');
    const orderNumber = String(order.order_number ?? order.id ?? '');
    const trackingNumber = order.fulfillments?.[0]?.tracking_number;
    const customerName = order.customer?.first_name;

    if (topic === 'orders/create') {
        return { platform: 'shopify', storeId, type: 'order_confirmed', customerPhone: phone, customerName, orderId, orderNumber };
    } else if (topic === 'orders/fulfilled') {
        return { platform: 'shopify', storeId, type: 'order_shipped', customerPhone: phone, customerName, orderId, orderNumber, trackingNumber };
    } else if (topic === 'orders/updated' && order.fulfillment_status === 'delivered') {
        return {
            platform: 'shopify', storeId, type: 'order_delivered',
            customerPhone: phone, customerName, orderId, orderNumber,
            also: [{ type: 'review_request', variables: { review_url: '' } }],
        };
    }
    return null;
}

// --- GDPR Mandatory Endpoints (HMAC-verified) ---
// Jawab24 only stores Shopify product catalog data, NOT customer PII.
// customerDataRequest and customerRedact acknowledge the webhook but have
// no customer data to export or delete. shopRedact fully removes store data.

function verifyShopifyWebhookHmac(request: FastifyRequest, reply: FastifyReply): boolean {
    const hmac = request.headers['x-shopify-hmac-sha256'] as string;
    const rawBody = request.rawBody;
    if (!rawBody) {
        reply.status(401).send({ error: 'Missing raw body for HMAC verification' });
        return false;
    }
    const body = rawBody.toString('utf8');
    if (!hmac || !shopifyService.verifyWebhookHmac(body, hmac)) {
        reply.status(401).send({ error: 'Invalid HMAC' });
        return false;
    }
    return true;
}

export async function gdprCustomerDataRequest(request: FastifyRequest, reply: FastifyReply) {
    try {
        if (!verifyShopifyWebhookHmac(request, reply)) return;
        return reply.status(200).send({ ok: true });
    } catch (error) {
        reportWebhookFailure(request, 'gdpr-customers-data-request', error);
        throw error;
    }
}

export async function gdprCustomerRedact(request: FastifyRequest, reply: FastifyReply) {
    try {
        if (!verifyShopifyWebhookHmac(request, reply)) return;
        return reply.status(200).send({ ok: true });
    } catch (error) {
        reportWebhookFailure(request, 'gdpr-customers-redact', error);
        throw error;
    }
}

export async function gdprShopRedact(request: FastifyRequest, reply: FastifyReply) {
    try {
        if (!verifyShopifyWebhookHmac(request, reply)) return;

        const { shop_domain } = request.body as { shop_domain?: string };
        if (shop_domain) {
            await shopifyService.deactivateStore(shop_domain);
        }
        return reply.status(200).send({ ok: true });
    } catch (error) {
        reportWebhookFailure(request, 'gdpr-shop-redact', error);
        throw error;
    }
}

// --- Protected API (Jawab24 JWT required) ---

export async function getStore(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    // Return inactive stores too so the frontend can show a Reconnect card
    const store = await shopifyService.getStoreByWorkspaceAny(req.workspaceId);
    if (!store) {
        return reply.send(null);
    }
    return reply.send(shopifyService.mapToEcommerceStore(store));
}

export async function connectStore(request: FastifyRequest, reply: FastifyReply) {
    const { shopDomain } = request.body as { shopDomain?: string };
    if (!shopDomain || !/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shopDomain)) {
        return reply.status(400).send({ error: 'Invalid shop domain. Use format: store-name.myshopify.com' });
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    reply.setCookie('shopifyNonce', nonce, SHOPIFY_NONCE_COOKIE_OPTIONS);

    const authUrl = shopifyService.buildAuthUrl(shopDomain, nonce);
    return reply.send({ authUrl });
}

export async function disconnectStoreHandler(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    const store = await shopifyService.getStoreByWorkspace(req.workspaceId);
    if (!store) {
        return reply.status(404).send({ error: 'No Shopify store connected' });
    }
    await shopifyService.disconnectStore(store.id);
    return reply.send({ ok: true });
}

export async function syncStore(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    const store = await shopifyService.getStoreByWorkspace(req.workspaceId);
    if (!store) {
        return reply.status(404).send({ error: 'No Shopify store connected' });
    }

    const result = await shopifyService.fullSync(store.id);
    return reply.send(result);
}

export async function getStoreProducts(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    const store = await shopifyService.getStoreByWorkspace(req.workspaceId);
    if (!store) {
        return reply.status(404).send({ error: 'No Shopify store connected' });
    }

    const products = await shopifyService.getProducts(store.id);
    return reply.send({ products, total: products.length });
}

export async function linkPage(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    const { pageId } = request.body as { pageId?: string };

    if (!pageId) {
        return reply.status(400).send({ error: 'pageId is required' });
    }

    const store = await shopifyService.getStoreByWorkspace(req.workspaceId);
    if (!store) {
        return reply.status(404).send({ error: 'No Shopify store connected' });
    }

    try {
        await shopifyService.linkStoreToPage(store.id, pageId, req.workspaceId);
        return reply.send({ ok: true });
    } catch (error) {
        if (error instanceof Error && error.message?.includes('does not belong to workspace')) {
            return reply.status(403).send({ error: 'Page does not belong to workspace' });
        }
        throw error;
    }
}

export async function unlinkPage(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    const { pageId } = request.body as { pageId?: string };

    if (!pageId) {
        return reply.status(400).send({ error: 'pageId is required' });
    }

    try {
        await shopifyService.unlinkStoreFromPage(pageId, req.workspaceId);
        return reply.send({ ok: true });
    } catch (error) {
        if (error instanceof Error && error.message?.includes('does not belong to workspace')) {
            return reply.status(403).send({ error: 'Page does not belong to workspace' });
        }
        throw error;
    }
}
