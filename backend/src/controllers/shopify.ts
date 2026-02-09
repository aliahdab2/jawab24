import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import * as shopifyService from '../services/shopify';
import { SHOPIFY_SYNC_QUEUE_NAME } from '@jawab24/shared';

// --- OAuth Flow ---

export async function authRedirect(request: FastifyRequest, reply: FastifyReply) {
    const { shop } = request.query as { shop?: string };

    if (!shop || !/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
        return reply.status(400).send({ error: 'Invalid shop domain' });
    }

    // Generate state for CSRF protection
    const state = crypto.randomBytes(16).toString('hex');
    // Store state in session/cookie (simplified — in production use signed cookie)
    reply.setCookie('shopify_state', state, { path: '/', httpOnly: true, secure: true, maxAge: 600 });

    const authUrl = shopifyService.buildAuthUrl(shop, state);
    return reply.redirect(authUrl);
}

export async function authCallback(request: FastifyRequest, reply: FastifyReply) {
    const { shop, code, state } = request.query as { shop?: string; code?: string; state?: string };
    const storedState = (request.cookies as Record<string, string>)?.shopify_state;

    if (!shop || !code || !state || state !== storedState) {
        return reply.status(400).send({ error: 'Invalid OAuth callback' });
    }

    try {
        // Exchange code for token
        const accessToken = await shopifyService.exchangeCodeForToken(shop, code);

        // Get the authenticated user (from JWT — requires user to be logged in to Jawab24)
        const userId = (request as any).userId;
        if (!userId) {
            return reply.status(401).send({ error: 'Must be logged in to Jawab24 to connect Shopify' });
        }

        // Create/update store
        const store = await shopifyService.createStore(userId, shop, accessToken);

        // Enqueue full sync
        try {
            const { Queue } = await import('bullmq');
            const { redis } = await import('../lib/redis');
            const syncQueue = new Queue(SHOPIFY_SYNC_QUEUE_NAME, { connection: redis as any });
            await syncQueue.add('full_sync', { shopifyStoreId: store.id, jobType: 'full_sync' });
            await syncQueue.close();
        } catch {
            // Non-critical — sync can be triggered manually
            request.log.error('Failed to enqueue Shopify sync');
        }

        // Redirect to Jawab24 settings page
        return reply.redirect(`${process.env.FRONTEND_URL || 'https://jawab24.com'}/settings?shopify=connected`);
    } catch (error) {
        request.log.error({ error }, 'Shopify auth callback failed');
        return reply.redirect(`${process.env.FRONTEND_URL || 'https://jawab24.com'}/settings?shopify=error`);
    }
}

// --- Webhooks (Shopify calls these) ---

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
            try {
                const { Queue } = await import('bullmq');
                const { redis } = await import('../lib/redis');
                const syncQueue = new Queue(SHOPIFY_SYNC_QUEUE_NAME, { connection: redis as any });
                await syncQueue.add('product_update', { shopifyStoreId: store.id, jobType: 'full_sync' });
                await syncQueue.close();
            } catch {
                request.log.error('Failed to enqueue product sync');
            }
        }
    }

    return reply.status(200).send({ ok: true });
}

// --- GDPR Mandatory Endpoints ---

export async function gdprCustomerDataRequest(_request: FastifyRequest, reply: FastifyReply) {
    // We don't store customer PII from Shopify — acknowledge request
    return reply.status(200).send({ ok: true });
}

export async function gdprCustomerRedact(_request: FastifyRequest, reply: FastifyReply) {
    // No customer PII to redact
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

    const state = crypto.randomBytes(16).toString('hex');
    reply.setCookie('shopify_state', state, { path: '/', httpOnly: true, secure: true, maxAge: 600 });

    const authUrl = shopifyService.buildAuthUrl(shopDomain, state);
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

    await shopifyService.linkStoreToPage(store.id, pageId);
    return reply.send({ ok: true });
}
