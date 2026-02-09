import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import * as shopifyService from '../services/shopify';
import { authService } from '../services/auth';
import { SHOPIFY_SYNC_QUEUE_NAME } from '@jawab24/shared';
import { config } from '../config';
import {
    PENDING_SHOPIFY_COOKIE_OPTIONS,
    SHOPIFY_NONCE_COOKIE_OPTIONS,
} from '../services/cookies';

// --- Helpers ---

/**
 * Try to get userId from JWT cookie or Bearer header.
 * Returns userId if valid, null if not authenticated.
 * Does NOT throw on missing/expired token.
 */
function tryGetUserId(request: FastifyRequest): string | null {
    try {
        let token: string | undefined;

        // Check Bearer header first (mobile)
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }
        // Check HttpOnly cookie (web)
        else if (request.cookies.token) {
            const unsigned = request.unsignCookie(request.cookies.token);
            if (unsigned.valid && unsigned.value) {
                token = unsigned.value;
            } else {
                return null;
            }
        }

        if (!token) return null;

        const payload = authService.verifyToken(token);
        return payload?.userId || null;
    } catch {
        return null;
    }
}

/**
 * Enqueue a Shopify sync job via BullMQ
 */
async function enqueueSync(storeId: string): Promise<void> {
    const { Queue } = await import('bullmq');
    const { redis } = await import('../lib/redis');
    const syncQueue = new Queue(SHOPIFY_SYNC_QUEUE_NAME, { connection: redis as any });
    await syncQueue.add('full_sync', { shopifyStoreId: storeId, jobType: 'full_sync' });
    await syncQueue.close();
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

export async function authCallback(request: FastifyRequest, reply: FastifyReply) {
    const { shop, code, state } = request.query as {
        shop?: string; code?: string; state?: string;
    };

    // Validate nonce from signed cookie matches state param
    const nonceCookie = request.cookies.shopifyNonce;
    let storedNonce: string | null = null;
    if (nonceCookie) {
        const unsigned = request.unsignCookie(nonceCookie);
        if (unsigned.valid && unsigned.value) {
            storedNonce = unsigned.value;
        }
    }

    if (!shop || !code || !state || state !== storedNonce) {
        return reply.status(400).send({ error: 'Invalid OAuth callback: state mismatch' });
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
            const store = await shopifyService.createStore(userId, shop, accessToken);

            // Register webhooks (non-blocking)
            shopifyService.registerWebhooks(shop, accessToken).catch(err => {
                request.log.error({ err }, 'Failed to register Shopify webhooks');
            });

            // Enqueue full sync (non-blocking)
            enqueueSync(store.id).catch(err => {
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
                nonce: state,
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
    const hmac = request.headers['x-shopify-hmac-sha256'] as string;
    const body = (request as any).rawBody || JSON.stringify(request.body);

    if (!hmac || !shopifyService.verifyWebhookHmac(body, hmac)) {
        return reply.status(401).send({ error: 'Invalid HMAC' });
    }

    const { myshopify_domain } = request.body as { myshopify_domain?: string };
    if (myshopify_domain) {
        await shopifyService.deactivateStore(myshopify_domain);
    }

    return reply.status(200).send({ ok: true });
}

export async function webhookProductsUpdate(request: FastifyRequest, reply: FastifyReply) {
    const hmac = request.headers['x-shopify-hmac-sha256'] as string;
    const body = (request as any).rawBody || JSON.stringify(request.body);

    if (!hmac || !shopifyService.verifyWebhookHmac(body, hmac)) {
        return reply.status(401).send({ error: 'Invalid HMAC' });
    }

    const shopDomain = request.headers['x-shopify-shop-domain'] as string;
    if (shopDomain) {
        const store = await shopifyService.getStoreByDomain(shopDomain);
        if (store) {
            enqueueSync(store.id).catch(err => {
                request.log.error({ err }, 'Failed to enqueue product sync');
            });
        }
    }

    return reply.status(200).send({ ok: true });
}

// --- GDPR Mandatory Endpoints ---

export async function gdprCustomerDataRequest(_request: FastifyRequest, reply: FastifyReply) {
    return reply.status(200).send({ ok: true });
}

export async function gdprCustomerRedact(_request: FastifyRequest, reply: FastifyReply) {
    return reply.status(200).send({ ok: true });
}

export async function gdprShopRedact(request: FastifyRequest, reply: FastifyReply) {
    const { shop_domain } = request.body as { shop_domain?: string };
    if (shop_domain) {
        await shopifyService.deactivateStore(shop_domain);
    }
    return reply.status(200).send({ ok: true });
}

// --- Protected API (Jawab24 JWT required) ---

export async function getStore(request: FastifyRequest, reply: FastifyReply) {
    const userId = (request as any).userId;
    const store = await shopifyService.getStoreByUserId(userId);
    if (!store) {
        return reply.status(404).send({ error: 'No Shopify store connected' });
    }
    return reply.send(shopifyService.mapToShopifyStore(store));
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
    const userId = (request as any).userId;
    const store = await shopifyService.getStoreByUserId(userId);
    if (!store) {
        return reply.status(404).send({ error: 'No Shopify store connected' });
    }
    await shopifyService.disconnectStore(store.id);
    return reply.send({ ok: true });
}

export async function syncStore(request: FastifyRequest, reply: FastifyReply) {
    const userId = (request as any).userId;
    const store = await shopifyService.getStoreByUserId(userId);
    if (!store) {
        return reply.status(404).send({ error: 'No Shopify store connected' });
    }

    const result = await shopifyService.fullSync(store.id);
    return reply.send(result);
}

export async function getStoreProducts(request: FastifyRequest, reply: FastifyReply) {
    const userId = (request as any).userId;
    const store = await shopifyService.getStoreByUserId(userId);
    if (!store) {
        return reply.status(404).send({ error: 'No Shopify store connected' });
    }

    const products = await shopifyService.getProducts(store.id);
    return reply.send({ products, total: products.length });
}

export async function linkPage(request: FastifyRequest, reply: FastifyReply) {
    const userId = (request as any).userId;
    const { pageId } = request.body as { pageId?: string };

    if (!pageId) {
        return reply.status(400).send({ error: 'pageId is required' });
    }

    const store = await shopifyService.getStoreByUserId(userId);
    if (!store) {
        return reply.status(404).send({ error: 'No Shopify store connected' });
    }

    try {
        await shopifyService.linkStoreToPage(store.id, pageId, userId);
        return reply.send({ ok: true });
    } catch (error: any) {
        if (error.message?.includes('does not belong to user')) {
            return reply.status(403).send({ error: 'Page does not belong to user' });
        }
        throw error;
    }
}
