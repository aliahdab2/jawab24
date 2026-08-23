import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { requireOwnedStore } from '../middleware/storeOwnership';
import * as customerNotificationsController from '../controllers/customerNotifications';

export default async function customerNotificationRoutes(fastify: FastifyInstance) {
    // Every route here is keyed by a client-supplied :storeId, so ownership is
    // proven before any handler runs (see middleware/storeOwnership). Writes
    // additionally require the admin role, matching the other store mutations
    // in ecommerceRoutes (disconnect / sync / link-page).
    const read = [authenticate, resolveWorkspace, requireOwnedStore];
    const write = [authenticate, resolveWorkspace, requireRole('admin'), requireOwnedStore];

    fastify.get('/notification-templates/:storeId', { preHandler: read }, customerNotificationsController.getTemplates);
    fastify.put('/notification-templates/:storeId/:type', { preHandler: write }, customerNotificationsController.updateTemplate);
    fastify.post('/notification-templates/:storeId/reset', { preHandler: write }, customerNotificationsController.resetTemplates);

    fastify.get('/notification-log/:storeId', { preHandler: read }, customerNotificationsController.getLog);
    fastify.get('/notification-log/:storeId/stats', { preHandler: read }, customerNotificationsController.getStats);
}
