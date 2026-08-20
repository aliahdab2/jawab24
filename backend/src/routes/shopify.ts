import { FastifyInstance, RouteHandlerMethod } from 'fastify';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import * as shopifyController from '../controllers/shopify';
import { createReregisterHandler } from '../controllers/ecommerceWebhooks';
import type { ShopifyWebhookPath } from '../services/shopify';

// Webhook delivery handlers, keyed by the registration path union from
// SHOPIFY_WEBHOOK_TOPIC_DEFS (services/shopify.ts) — a path subscribed there
// without a handler here (or a leftover handler) fails type-check.
const webhookHandlers: Record<ShopifyWebhookPath, RouteHandlerMethod> = {
    'uninstall': shopifyController.webhookUninstall,
    'products-update': shopifyController.webhookProductsUpdate,
    'orders': shopifyController.webhookOrders,
    'fulfillments': shopifyController.webhookFulfillments,
};

export default async function shopifyRoutes(fastify: FastifyInstance) {
    // --- Public routes (Shopify calls these) ---

    fastify.get('/auth', shopifyController.authRedirect);
    fastify.get('/auth/callback', shopifyController.authCallback);

    // Webhooks (HMAC-verified in handler)
    for (const [path, handler] of Object.entries(webhookHandlers)) {
        fastify.post(`/webhooks/${path}`, handler);
    }

    // App Pricing billing return (D-C) — public trigger, verified server-side.
    // Rate-limited: it fans out to an Admin API call per hit.
    fastify.get('/billing/return', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, shopifyController.billingReturn);

    // GDPR mandatory endpoints
    fastify.post('/gdpr/customers/data_request', shopifyController.gdprCustomerDataRequest);
    fastify.post('/gdpr/customers/redact', shopifyController.gdprCustomerRedact);
    fastify.post('/gdpr/shop/redact', shopifyController.gdprShopRedact);

    // --- Read: all workspace members ---

    // Deployment capability (see routes/ecommerceRoutes.ts). Shopify does not use the
    // shared route factory, so the same endpoint is declared here to keep the three
    // platforms' API surface identical for the integrations page.
    fastify.get('/capabilities', { preHandler: [authenticate] }, async (_request, reply) =>
        reply.send({ connectAvailable: true }),
    );
    fastify.get('/store', { preHandler: [authenticate, resolveWorkspace] }, shopifyController.getStore);
    fastify.get('/store/products', { preHandler: [authenticate, resolveWorkspace] }, shopifyController.getStoreProducts);

    // --- Write: admin+ only ---

    fastify.post('/store/connect', { preHandler: [authenticate] }, shopifyController.connectStore);
    fastify.delete('/store', { preHandler: [authenticate, resolveWorkspace, requireRole('admin')] }, shopifyController.disconnectStoreHandler);
    fastify.post('/store/sync', { preHandler: [authenticate, resolveWorkspace, requireRole('admin')] }, shopifyController.syncStore);
    fastify.post('/store/webhooks/reregister', { preHandler: [authenticate, resolveWorkspace, requireRole('admin')] }, createReregisterHandler('shopify'));
    fastify.patch('/store/link-page', { preHandler: [authenticate, resolveWorkspace, requireRole('admin')] }, shopifyController.linkPage);
    fastify.patch('/store/unlink-page', { preHandler: [authenticate, resolveWorkspace, requireRole('admin')] }, shopifyController.unlinkPage);
}
