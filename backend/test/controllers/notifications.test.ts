import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from '../../src/middleware/auth';

// Mock notification service before imports
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

// Import controller and mocked service AFTER mocks
import {
    registerToken,
    removeToken,
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
} from '../../src/controllers/notifications';
import { notificationService } from '../../src/services/notifications';

describe('Notifications Controller', () => {
    let mockRequest: Partial<AuthenticatedRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
        mockRequest = {
            user: { userId: 'user-123', facebookId: 'fb-123' },
            query: {},
            params: {},
            body: {},
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as any,
        };
    });

    // ---- registerToken ----
    describe('registerToken', () => {
        it('should register a token successfully', async () => {
            mockRequest.body = { token: 'device-token-abc', platform: 'android' };
            vi.mocked(notificationService.registerDeviceToken).mockResolvedValue(undefined);

            await registerToken(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(notificationService.registerDeviceToken).toHaveBeenCalledWith('user-123', 'device-token-abc', 'android');
            expect(mockReply.send).toHaveBeenCalledWith({ success: true });
        });

        it('should return 400 when token or platform is missing', async () => {
            mockRequest.body = { token: 'device-token-abc' }; // no platform

            await registerToken(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Token and platform are required' });
        });

        it('should return 400 for invalid platform', async () => {
            mockRequest.body = { token: 'device-token-abc', platform: 'windows' };

            await registerToken(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Invalid platform. Must be android, ios, or web' });
        });

        it('should return 401 when user is missing', async () => {
            mockRequest.user = undefined;

            await registerToken(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(401);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
        });
    });

    // ---- removeToken ----
    describe('removeToken', () => {
        it('should remove a token successfully', async () => {
            mockRequest.body = { token: 'device-token-abc' };
            vi.mocked(notificationService.removeDeviceToken).mockResolvedValue(undefined);

            await removeToken(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(notificationService.removeDeviceToken).toHaveBeenCalledWith('user-123', 'device-token-abc');
            expect(mockReply.send).toHaveBeenCalledWith({ success: true });
        });

        it('should return 400 when token is missing', async () => {
            mockRequest.body = {};

            await removeToken(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Token is required' });
        });

        it('should return 401 when user is missing', async () => {
            mockRequest.user = undefined;

            await removeToken(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(401);
        });
    });

    // ---- getNotifications ----
    describe('getNotifications', () => {
        it('should return notifications with pagination defaults', async () => {
            const mockResult = { notifications: [], total: 0 };
            vi.mocked(notificationService.getNotifications).mockResolvedValue(mockResult);

            await getNotifications(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(notificationService.getNotifications).toHaveBeenCalledWith('user-123', 20, 0);
            expect(mockReply.send).toHaveBeenCalledWith(mockResult);
        });

        it('should return 401 when user is missing', async () => {
            mockRequest.user = undefined;

            await getNotifications(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(401);
        });
    });

    // ---- getUnreadCount ----
    describe('getUnreadCount', () => {
        it('should return the unread count', async () => {
            vi.mocked(notificationService.getUnreadCount).mockResolvedValue(5);

            await getUnreadCount(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(notificationService.getUnreadCount).toHaveBeenCalledWith('user-123');
            expect(mockReply.send).toHaveBeenCalledWith({ count: 5 });
        });

        it('should return 401 when user is missing', async () => {
            mockRequest.user = undefined;

            await getUnreadCount(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(401);
        });
    });

    // ---- markAsRead ----
    describe('markAsRead', () => {
        it('should mark a notification as read', async () => {
            mockRequest.params = { id: 'notif-1' };
            vi.mocked(notificationService.markAsRead).mockResolvedValue(undefined);

            await markAsRead(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(notificationService.markAsRead).toHaveBeenCalledWith('notif-1', 'user-123');
            expect(mockReply.send).toHaveBeenCalledWith({ success: true });
        });

        it('should return 400 when id is missing', async () => {
            mockRequest.params = {};

            await markAsRead(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Notification ID is required' });
        });

        it('should return 401 when user is missing', async () => {
            mockRequest.user = undefined;

            await markAsRead(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(401);
        });
    });

    // ---- markAllAsRead ----
    describe('markAllAsRead', () => {
        it('should mark all notifications as read', async () => {
            vi.mocked(notificationService.markAllAsRead).mockResolvedValue(undefined);

            await markAllAsRead(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(notificationService.markAllAsRead).toHaveBeenCalledWith('user-123');
            expect(mockReply.send).toHaveBeenCalledWith({ success: true });
        });

        it('should return 401 when user is missing', async () => {
            mockRequest.user = undefined;

            await markAllAsRead(mockRequest as AuthenticatedRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(401);
        });
    });
});
