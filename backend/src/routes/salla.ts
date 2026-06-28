import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import * as sallaController from '../controllers/salla';
import { createEcommerceRoutes } from './ecommerceRoutes';

const baseRoutes = createEcommerceRoutes('salla', sallaController);

/**
 * Salla routes = the shared OAuth/CRUD set + two Salla-only Easy-Mode claim routes.
 * Easy Mode is asymmetric (Shopify/Zid have no `app.store.authorize`), so these live
 * here rather than in the shared factory — mirroring the Salla-only `webhookHandler`.
 */
export default async function sallaRoutes(fastify: FastifyInstance) {
    await fastify.register(baseRoutes);

    // Post-install claim (Easy Mode — no browser cookie; keyed by merchant id)
    fastify.get('/store/pending', { preHandler: [authenticate] }, sallaController.listPendingHandler);
    fastify.post('/store/claim', { preHandler: [authenticate] }, sallaController.claimStoreHandler);
}
