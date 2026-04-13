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
import { auth } from '../utils/swagger';

export default async function notificationRoutes(fastify: FastifyInstance) {
    // All routes require authentication
    fastify.addHook('preHandler', authenticate);

    // Register device token for push notifications
    fastify.post('/register-token', {
        schema: { tags: ['Notifications'], summary: 'Register a device token for push notifications', security: auth },
    }, registerToken);

    // Remove device token (on logout)
    fastify.post('/remove-token', {
        schema: { tags: ['Notifications'], summary: 'Remove a device token', security: auth },
    }, removeToken);

    // Get user's notifications
    fastify.get('/', {
        schema: { tags: ['Notifications'], summary: 'Get user notifications', security: auth },
    }, getNotifications);

    // Get unread notification count
    // Own rate-limit bucket (500/15 min per IP) so background polling
    // never competes with and exhausts the global request budget.
    fastify.get('/unread-count', {
        schema: { tags: ['Notifications'], summary: 'Get unread notification count', security: auth },
        config: { rateLimit: { max: 500, timeWindow: '15 minutes' } },
    }, getUnreadCount);

    // Mark a notification as read
    fastify.patch('/:id/read', {
        schema: { tags: ['Notifications'], summary: 'Mark a notification as read', security: auth },
    }, markAsRead);

    // Mark all notifications as read
    fastify.post('/mark-all-read', {
        schema: { tags: ['Notifications'], summary: 'Mark all notifications as read', security: auth },
    }, markAllAsRead);
}
