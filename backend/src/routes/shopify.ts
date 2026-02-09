import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import * as shopifyController from '../controllers/shopify';

export default async function shopifyRoutes(fastify: FastifyInstance) {
    // --- Public routes (Shopify calls these) ---

    fastify.get('/auth', shopifyController.authRedirect);
    fastify.get('/auth/callback', shopifyController.authCallback);

    // Webhooks (HMAC-verified in handler)
    fastify.post('/webhooks/uninstall', shopifyController.webhookUninstall);
    fastify.post('/webhooks/products-update', shopifyController.webhookProductsUpdate);

    // GDPR mandatory endpoints
    fastify.post('/gdpr/customers/data_request', shopifyController.gdprCustomerDataRequest);
    fastify.post('/gdpr/customers/redact', shopifyController.gdprCustomerRedact);
    fastify.post('/gdpr/shop/redact', shopifyController.gdprShopRedact);

    // --- Protected routes (Jawab24 JWT required) ---

    fastify.get('/store', { preHandler: [authenticate] }, shopifyController.getStore);
    fastify.post('/store/connect', { preHandler: [authenticate] }, shopifyController.connectStore);
    fastify.delete('/store', { preHandler: [authenticate] }, shopifyController.disconnectStoreHandler);
    fastify.post('/store/sync', { preHandler: [authenticate] }, shopifyController.syncStore);
    fastify.get('/store/products', { preHandler: [authenticate] }, shopifyController.getStoreProducts);
    fastify.patch('/store/link-page', { preHandler: [authenticate] }, shopifyController.linkPage);
}
