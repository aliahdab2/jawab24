import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import {
    registerToken,
    removeToken,
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
} from '../controllers/notifications';

export default async function notificationRoutes(fastify: FastifyInstance) {
    // All routes require authentication
    fastify.addHook('preHandler', authenticate);

    // Register device token for push notifications
    fastify.post('/register-token', registerToken);

    // Remove device token (on logout)
    fastify.post('/remove-token', removeToken);

    // Get user's notifications
    fastify.get('/', getNotifications);

    // Get unread notification count
    fastify.get('/unread-count', getUnreadCount);

    // Mark a notification as read
    fastify.patch('/:id/read', markAsRead);

    // Mark all notifications as read
    fastify.post('/mark-all-read', markAllAsRead);
}
