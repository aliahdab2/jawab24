import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import notificationRoutes from '../../src/routes/notifications';
import { notificationService } from '../../src/services/notifications';

// Mock the notification service
vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        registerDeviceToken: vi.fn(),
        removeDeviceToken: vi.fn(),
        getNotifications: vi.fn(),
        getUnreadCount: vi.fn(),
        markAsRead: vi.fn(),
        markAllAsRead: vi.fn(),
    },
}));

// Mock the auth middleware
vi.mock('../../src/middleware/auth', () => ({
    authenticate: async (request: any, reply: any) => {
        // Check for auth header
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        // Add mock user to request
        request.user = { userId: 'user-123' };
    },
}));

describe('Notification Routes', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        app = Fastify();
        await app.register(notificationRoutes, { prefix: '/notifications' });
        await app.ready();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await app.close();
    });

    describe('POST /notifications/register-token', () => {
        it('should register a device token successfully', async () => {
            (notificationService.registerDeviceToken as any).mockResolvedValue(undefined);

            const response = await app.inject({
                method: 'POST',
                url: '/notifications/register-token',
                headers: { authorization: 'Bearer test-token' },
                payload: {
                    token: 'fcm-token-abc',
                    platform: 'android',
                },
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({ success: true });
            expect(notificationService.registerDeviceToken).toHaveBeenCalledWith(
                'user-123',
                'fcm-token-abc',
                'android'
            );
        });

        it('should return 400 if token is missing', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/notifications/register-token',
                headers: { authorization: 'Bearer test-token' },
                payload: {
                    platform: 'android',
                },
            });

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.payload).error).toContain('required');
        });

        it('should return 400 for invalid platform', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/notifications/register-token',
                headers: { authorization: 'Bearer test-token' },
                payload: {
                    token: 'fcm-token-abc',
                    platform: 'invalid',
                },
            });

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.payload).error).toContain('Invalid platform');
        });

        it('should return 401 without auth header', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/notifications/register-token',
                payload: {
                    token: 'fcm-token-abc',
                    platform: 'android',
                },
            });

            expect(response.statusCode).toBe(401);
        });
    });

    describe('POST /notifications/remove-token', () => {
        it('should remove a device token successfully', async () => {
            (notificationService.removeDeviceToken as any).mockResolvedValue(undefined);

            const response = await app.inject({
                method: 'POST',
                url: '/notifications/remove-token',
                headers: { authorization: 'Bearer test-token' },
                payload: {
                    token: 'fcm-token-abc',
                },
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({ success: true });
        });

        it('should return 400 if token is missing', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/notifications/remove-token',
                headers: { authorization: 'Bearer test-token' },
                payload: {},
            });

            expect(response.statusCode).toBe(400);
        });
    });

    describe('GET /notifications', () => {
        it('should return notifications with unread count', async () => {
            const mockResponse = {
                notifications: [
                    {
                        id: 'notif-1',
                        type: 'payment_failed',
                        title: 'فشل الدفع',
                        body: 'نص',
                        read: false,
                        createdAt: new Date().toISOString(),
                    },
                ],
                unreadCount: 1,
            };

            (notificationService.getNotifications as any).mockResolvedValue(mockResponse);

            const response = await app.inject({
                method: 'GET',
                url: '/notifications',
                headers: { authorization: 'Bearer test-token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.notifications).toHaveLength(1);
            expect(body.unreadCount).toBe(1);
        });

        it('should respect limit and offset parameters', async () => {
            (notificationService.getNotifications as any).mockResolvedValue({
                notifications: [],
                unreadCount: 0,
            });

            await app.inject({
                method: 'GET',
                url: '/notifications?limit=10&offset=5',
                headers: { authorization: 'Bearer test-token' },
            });

            expect(notificationService.getNotifications).toHaveBeenCalledWith(
                'user-123',
                10,
                5,
                'ar'
            );
        });

        it('should cap limit at 100', async () => {
            (notificationService.getNotifications as any).mockResolvedValue({
                notifications: [],
                unreadCount: 0,
            });

            await app.inject({
                method: 'GET',
                url: '/notifications?limit=500',
                headers: { authorization: 'Bearer test-token' },
            });

            expect(notificationService.getNotifications).toHaveBeenCalledWith(
                'user-123',
                100,
                0,
                'ar'
            );
        });

        it('should pass lang=en when query param is en', async () => {
            (notificationService.getNotifications as any).mockResolvedValue({
                notifications: [],
                unreadCount: 0,
            });

            await app.inject({
                method: 'GET',
                url: '/notifications?lang=en',
                headers: { authorization: 'Bearer test-token' },
            });

            expect(notificationService.getNotifications).toHaveBeenCalledWith(
                'user-123',
                20,
                0,
                'en'
            );
        });
    });

    describe('GET /notifications/unread-count', () => {
        it('should return unread count', async () => {
            (notificationService.getUnreadCount as any).mockResolvedValue(5);

            const response = await app.inject({
                method: 'GET',
                url: '/notifications/unread-count',
                headers: { authorization: 'Bearer test-token' },
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({ count: 5 });
        });
    });

    describe('PATCH /notifications/:id/read', () => {
        it('should mark notification as read', async () => {
            (notificationService.markAsRead as any).mockResolvedValue(undefined);

            const response = await app.inject({
                method: 'PATCH',
                url: '/notifications/notif-123/read',
                headers: { authorization: 'Bearer test-token' },
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({ success: true });
            expect(notificationService.markAsRead).toHaveBeenCalledWith('notif-123', 'user-123');
        });
    });

    describe('POST /notifications/mark-all-read', () => {
        it('should mark all notifications as read', async () => {
            (notificationService.markAllAsRead as any).mockResolvedValue(undefined);

            const response = await app.inject({
                method: 'POST',
                url: '/notifications/mark-all-read',
                headers: { authorization: 'Bearer test-token' },
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({ success: true });
            expect(notificationService.markAllAsRead).toHaveBeenCalledWith('user-123');
        });
    });
});
