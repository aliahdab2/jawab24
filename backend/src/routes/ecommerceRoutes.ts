import { FastifyInstance, RouteHandlerMethod } from 'fastify';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { createReregisterHandler } from '../controllers/ecommerceWebhooks';
import type { EcommercePlatform } from '../services/ecommerce';

export interface EcommerceRouteController {
    authRedirect: RouteHandlerMethod;
    authCallback: RouteHandlerMethod;
    webhookHandler: RouteHandlerMethod;
    getStore: RouteHandlerMethod;
    getStoreProducts: RouteHandlerMethod;
    connectStore: RouteHandlerMethod;
    disconnectStoreHandler: RouteHandlerMethod;
    syncStore: RouteHandlerMethod;
    linkPage: RouteHandlerMethod;
    unlinkPage: RouteHandlerMethod;
}

/**
 * Registers the standard e-commerce route set shared by all OAuth-redirect platforms
 * (Salla, Zid). Mount under the platform prefix in the parent router, e.g.:
 *   fastify.register(createEcommerceRoutes('salla', sallaController), { prefix: '/salla' })
 *
 * The platform name is also wired into the shared webhook reregister handler so
 * each platform's `POST /<platform>/store/webhooks/reregister` is one shared
 * implementation, not a per-platform copy.
 */
export function createEcommerceRoutes(platform: EcommercePlatform, controller: EcommerceRouteController) {
    return async function ecommerceRoutes(fastify: FastifyInstance) {
        // --- Public (OAuth flow) ---
        fastify.get('/auth', controller.authRedirect);
        fastify.get('/auth/callback', controller.authCallback);
        fastify.post('/webhooks', controller.webhookHandler);

        // --- Read: all workspace members ---
        fastify.get('/store', { preHandler: [authenticate, resolveWorkspace] }, controller.getStore);
        fastify.get('/store/products', { preHandler: [authenticate, resolveWorkspace] }, controller.getStoreProducts);

        // --- Write: admin+ only ---
        fastify.post('/store/connect', { preHandler: [authenticate] }, controller.connectStore);
        fastify.delete('/store', { preHandler: [authenticate, resolveWorkspace, requireRole('admin')] }, controller.disconnectStoreHandler);
        fastify.post('/store/sync', { preHandler: [authenticate, resolveWorkspace, requireRole('admin')] }, controller.syncStore);
        fastify.post('/store/webhooks/reregister', { preHandler: [authenticate, resolveWorkspace, requireRole('admin')] }, createReregisterHandler(platform));
        fastify.patch('/store/link-page', { preHandler: [authenticate, resolveWorkspace, requireRole('admin')] }, controller.linkPage);
        fastify.patch('/store/unlink-page', { preHandler: [authenticate, resolveWorkspace, requireRole('admin')] }, controller.unlinkPage);
    };
}
