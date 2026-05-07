import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import * as shopifyController from '../controllers/shopify';
import { createReregisterHandler } from '../controllers/ecommerceWebhooks';

export default async function shopifyRoutes(fastify: FastifyInstance) {
    // --- Public routes (Shopify calls these) ---

    fastify.get('/auth', shopifyController.authRedirect);
    fastify.get('/auth/callback', shopifyController.authCallback);

    // Webhooks (HMAC-verified in handler)
    fastify.post('/webhooks/uninstall', shopifyController.webhookUninstall);
    fastify.post('/webhooks/products-update', shopifyController.webhookProductsUpdate);
    fastify.post('/webhooks/orders', shopifyController.webhookOrders);

    // GDPR mandatory endpoints
    fastify.post('/gdpr/customers/data_request', shopifyController.gdprCustomerDataRequest);
    fastify.post('/gdpr/customers/redact', shopifyController.gdprCustomerRedact);
    fastify.post('/gdpr/shop/redact', shopifyController.gdprShopRedact);

    // --- Read: all workspace members ---

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
