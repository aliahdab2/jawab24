import { FastifyReply } from 'fastify';
import { notificationService } from '../services/notifications';
import { AuthenticatedRequest } from '../middleware/auth';

/**
 * Register a device token for push notifications
 */
export async function registerToken(
    request: AuthenticatedRequest,
    reply: FastifyReply
) {
    if (!request.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }
    const userId = request.user.userId;

    const body = request.body as { token?: string; platform?: string };
    const { token, platform } = body;

    if (!token || !platform) {
        return reply.status(400).send({ error: 'Token and platform are required' });
    }

    if (!['android', 'ios', 'web'].includes(platform)) {
        return reply.status(400).send({ error: 'Invalid platform. Must be android, ios, or web' });
    }

    try {
        await notificationService.registerDeviceToken(userId, token, platform as 'android' | 'ios' | 'web');
        return reply.send({ success: true });
    } catch (error) {
        console.error('Failed to register device token:', error);
        return reply.status(500).send({ error: 'Failed to register device token' });
    }
}

/**
 * Remove a device token (on logout)
 */
export async function removeToken(
    request: AuthenticatedRequest,
    reply: FastifyReply
) {
    if (!request.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }
    const userId = request.user.userId;

    const body = request.body as { token?: string };
    const { token } = body;

    if (!token) {
        return reply.status(400).send({ error: 'Token is required' });
    }

    try {
        await notificationService.removeDeviceToken(userId, token);
        return reply.send({ success: true });
    } catch (error) {
        console.error('Failed to remove device token:', error);
        return reply.status(500).send({ error: 'Failed to remove device token' });
    }
}

/**
 * Get user's notifications
 */
export async function getNotifications(
    request: AuthenticatedRequest,
    reply: FastifyReply
) {
    if (!request.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }
    const userId = request.user.userId;

    const query = request.query as { limit?: string; offset?: string; lang?: string };
    const limit = Math.min(parseInt(query.limit || '20', 10), 100);
    const offset = parseInt(query.offset || '0', 10);
    const lang = (query.lang === 'en' ? 'en' : 'ar') as 'ar' | 'en';

    try {
        const result = await notificationService.getNotifications(userId, limit, offset, lang);
        return reply.send(result);
    } catch (error) {
        console.error('Failed to get notifications:', error);
        return reply.status(500).send({ error: 'Failed to get notifications' });
    }
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(
    request: AuthenticatedRequest,
    reply: FastifyReply
) {
    if (!request.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }
    const userId = request.user.userId;

    try {
        const count = await notificationService.getUnreadCount(userId);
        return reply.send({ count });
    } catch (error) {
        console.error('Failed to get unread count:', error);
        return reply.status(500).send({ error: 'Failed to get unread count' });
    }
}

/**
 * Mark a notification as read
 */
export async function markAsRead(
    request: AuthenticatedRequest,
    reply: FastifyReply
) {
    if (!request.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }
    const userId = request.user.userId;

    const params = request.params as { id?: string };
    const { id } = params;

    if (!id) {
        return reply.status(400).send({ error: 'Notification ID is required' });
    }

    try {
        await notificationService.markAsRead(id, userId);
        return reply.send({ success: true });
    } catch (error) {
        console.error('Failed to mark notification as read:', error);
        return reply.status(500).send({ error: 'Failed to mark notification as read' });
    }
}

/**
 * Mark all notifications as read
 */
export async function markAllAsRead(
    request: AuthenticatedRequest,
    reply: FastifyReply
) {
    if (!request.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }
    const userId = request.user.userId;

    try {
        await notificationService.markAllAsRead(userId);
        return reply.send({ success: true });
    } catch (error) {
        console.error('Failed to mark all notifications as read:', error);
        return reply.status(500).send({ error: 'Failed to mark all notifications as read' });
    }
}
