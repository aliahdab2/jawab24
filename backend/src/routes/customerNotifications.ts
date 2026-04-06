import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace } from '../middleware/workspace';
import * as customerNotificationsController from '../controllers/customerNotifications';

export default async function customerNotificationRoutes(fastify: FastifyInstance) {
    const auth = [authenticate, resolveWorkspace];

    fastify.get('/notification-templates/:storeId', { preHandler: auth }, customerNotificationsController.getTemplates);
    fastify.put('/notification-templates/:storeId/:type', { preHandler: auth }, customerNotificationsController.updateTemplate);
    fastify.post('/notification-templates/:storeId/reset', { preHandler: auth }, customerNotificationsController.resetTemplates);

    fastify.get('/notification-log/:storeId', { preHandler: auth }, customerNotificationsController.getLog);
    fastify.get('/notification-log/:storeId/stats', { preHandler: auth }, customerNotificationsController.getStats);
}
