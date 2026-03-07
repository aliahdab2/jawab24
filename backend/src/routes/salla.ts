import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace } from '../middleware/workspace';
import * as sallaController from '../controllers/salla';

export default async function sallaRoutes(fastify: FastifyInstance) {
    // --- Public routes (Salla OAuth) ---

    fastify.get('/auth', sallaController.authRedirect);
    fastify.get('/auth/callback', sallaController.authCallback);

    // Single webhook endpoint — dispatches by event type in body (HMAC-verified in handler)
    fastify.post('/webhooks', sallaController.webhookHandler);

    // --- Protected routes (Jawab24 JWT required) ---

    fastify.get('/store', { preHandler: [authenticate, resolveWorkspace] }, sallaController.getStore);
    fastify.post('/store/connect', { preHandler: [authenticate] }, sallaController.connectStore);
    fastify.delete('/store', { preHandler: [authenticate, resolveWorkspace] }, sallaController.disconnectStoreHandler);
    fastify.post('/store/sync', { preHandler: [authenticate, resolveWorkspace] }, sallaController.syncStore);
    fastify.get('/store/products', { preHandler: [authenticate, resolveWorkspace] }, sallaController.getStoreProducts);
    fastify.patch('/store/link-page', { preHandler: [authenticate, resolveWorkspace] }, sallaController.linkPage);
    fastify.patch('/store/unlink-page', { preHandler: [authenticate, resolveWorkspace] }, sallaController.unlinkPage);
}
