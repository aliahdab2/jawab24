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
    /** Whether this deployment can actually start a connect flow for the platform.
     *  Omitted = always available (Shopify, Zid). Salla answers false while its app
     *  runs in Easy Mode with no published listing — see controllers/salla.ts. The
     *  frontend reads this instead of hardcoding availability, so the answer has one
     *  source of truth and a config change alone flips the UI. */
    isConnectAvailable?: () => boolean;
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
        // Deployment capability, not workspace state: what this build/config can do for
        // the platform. Read by the integrations page so the connect action is never
        // offered when the backend would refuse it.
        fastify.get('/capabilities', { preHandler: [authenticate] }, async (_request, reply) =>
            reply.send({ connectAvailable: controller.isConnectAvailable?.() ?? true }),
        );
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
