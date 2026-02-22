import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import settingsRoutes from '../../src/routes/settings';

// Mock database
vi.mock('../../src/db', () => ({
    db: {
        query: {
            settings: {
                findFirst: vi.fn(),
            },
        },
        insert: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    settings: {
        id: 'id',
        userId: 'user_id',
        dashboardLanguage: 'dashboard_language',
        commentReplyMode: 'comment_reply_mode',
        dualReplyConfig: 'dual_reply_config',
        updatedAt: 'updated_at',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
}));

// Mock services
vi.mock('../../src/services/settings', () => ({
    settingsService: {
        getSettings: vi.fn(),
        updateSettings: vi.fn(),
    },
}));

vi.mock('../../src/services/auth', () => ({
    authService: {
        verifyToken: vi.fn(),
    },
}));

vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: async (req: any) => {
        req.workspaceId = 'test_workspace_id';
        req.workspaceRole = 'owner';
    },
}));

vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        updateSettings: vi.fn(),
    },
}));

describe('Settings Routes', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = fastify();
        app.register(settingsRoutes);
        await app.ready();
        vi.clearAllMocks();
    });

    describe('GET /settings - Get User Settings', () => {
        it('should return user settings with valid token', async () => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            vi.mocked(settingsService.getSettings).mockResolvedValue({
                id: 'settings_123',
                userId: 'user_123',
                dashboardLanguage: 'ar',
                defaultReplyLanguage: 'ar',
                supportedLanguages: ['en', 'ar'],
                autoDetectLanguage: true,
                aiEnabled: true,
                aiModel: 'gpt-4o-mini',
                commentReplyMode: 'public',
                commentsAutoReply: true,
                messagesAutoReply: true,
                dualReplyNudge: null,
                businessHoursOnly: false,
                businessHoursStart: '09:00',
                businessHoursEnd: '18:00',
                awayMessage: null,
                greetingMessage: null,
                replyDelay: 0,
                timezone: 'UTC',
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 60,
                handoffPauseDurationMinutes: 30,
                notificationsEnabled: true,
            });

            const response = await app.inject({
                method: 'GET',
                url: '/settings',
                headers: {
                    authorization: 'Bearer valid_token',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.userId).toBe('user_123');
            expect(body.dashboardLanguage).toBe('ar');
            expect(body.commentReplyMode).toBe('public');
            expect(settingsService.getSettings).toHaveBeenCalledWith('user_123');
        });

        it('should create default settings if none exist', async () => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'new_user',
                facebookId: 'fb_new',
            });

            vi.mocked(settingsService.getSettings).mockResolvedValue({
                id: 'new_settings',
                userId: 'new_user',
                dashboardLanguage: 'ar',
                defaultReplyLanguage: 'ar',
                supportedLanguages: ['en', 'ar'],
                autoDetectLanguage: true,
                aiEnabled: true,
                aiModel: 'gpt-4o-mini',
                commentReplyMode: 'public',
                commentsAutoReply: true,
                messagesAutoReply: true,
                dualReplyNudge: null,
                businessHoursOnly: false,
                businessHoursStart: '09:00',
                businessHoursEnd: '18:00',
                awayMessage: null,
                greetingMessage: null,
                replyDelay: 0,
                timezone: 'UTC',
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 60,
                handoffPauseDurationMinutes: 30,
                notificationsEnabled: true,
            });

            const response = await app.inject({
                method: 'GET',
                url: '/settings',
                headers: {
                    authorization: 'Bearer new_user_token',
                },
            });

            expect(response.statusCode).toBe(200);
            expect(settingsService.getSettings).toHaveBeenCalledWith('new_user');
        });

        it('should return 401 without auth token', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/settings',
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return 401 with invalid token', async () => {
            const { authService } = await import('../../src/services/auth');

            vi.mocked(authService.verifyToken).mockReturnValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/settings',
                headers: {
                    authorization: 'Bearer invalid_token',
                },
            });

            expect(response.statusCode).toBe(401);
        });
    });

    describe('PUT /settings - Update User Settings', () => {
        it('should update dashboard language', async () => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            vi.mocked(settingsService.updateSettings).mockResolvedValue({
                id: 'settings_123',
                userId: 'user_123',
                dashboardLanguage: 'en',
                defaultReplyLanguage: 'ar',
                supportedLanguages: ['en', 'ar'],
                autoDetectLanguage: true,
                aiEnabled: true,
                aiModel: 'gpt-4o-mini',
                commentReplyMode: 'public',
                commentsAutoReply: true,
                messagesAutoReply: true,
                dualReplyNudge: null,
                businessHoursOnly: false,
                businessHoursStart: '09:00',
                businessHoursEnd: '18:00',
                awayMessage: null,
                greetingMessage: null,
                replyDelay: 0,
                timezone: 'UTC',
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 60,
                handoffPauseDurationMinutes: 30,
                notificationsEnabled: true,
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    dashboardLanguage: 'en',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.dashboardLanguage).toBe('en');
            expect(settingsService.updateSettings).toHaveBeenCalledWith('user_123', {
                dashboardLanguage: 'en',
            });
        });

        it('should update comment reply mode to public', async () => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            vi.mocked(settingsService.updateSettings).mockResolvedValue({
                id: 'settings_123',
                userId: 'user_123',
                dashboardLanguage: 'ar',
                defaultReplyLanguage: 'ar',
                supportedLanguages: ['en', 'ar'],
                autoDetectLanguage: true,
                aiEnabled: true,
                aiModel: 'gpt-4o-mini',
                commentReplyMode: 'public',
                commentsAutoReply: true,
                messagesAutoReply: true,
                dualReplyNudge: null,
                businessHoursOnly: false,
                businessHoursStart: '09:00',
                businessHoursEnd: '18:00',
                awayMessage: null,
                greetingMessage: null,
                replyDelay: 0,
                timezone: 'UTC',
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 60,
                handoffPauseDurationMinutes: 30,
                notificationsEnabled: true,
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    commentReplyMode: 'public',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.commentReplyMode).toBe('public');
        });

        it('should update comment reply mode to private', async () => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            vi.mocked(settingsService.updateSettings).mockResolvedValue({
                id: 'settings_123',
                userId: 'user_123',
                dashboardLanguage: 'ar',
                defaultReplyLanguage: 'ar',
                supportedLanguages: ['en', 'ar'],
                autoDetectLanguage: true,
                aiEnabled: true,
                aiModel: 'gpt-4o-mini',
                commentReplyMode: 'private',
                commentsAutoReply: true,
                messagesAutoReply: true,
                dualReplyNudge: null,
                businessHoursOnly: false,
                businessHoursStart: '09:00',
                businessHoursEnd: '18:00',
                awayMessage: null,
                greetingMessage: null,
                replyDelay: 0,
                timezone: 'UTC',
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 60,
                handoffPauseDurationMinutes: 30,
                notificationsEnabled: true,
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    commentReplyMode: 'private',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.commentReplyMode).toBe('private');
        });

        it('should update comment reply mode to dual with config', async () => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            const dualNudge = 'تم الرد في رسالة خاصة 📥';

            vi.mocked(settingsService.updateSettings).mockResolvedValue({
                id: 'settings_123',
                userId: 'user_123',
                dashboardLanguage: 'ar',
                defaultReplyLanguage: 'ar',
                supportedLanguages: ['en', 'ar'],
                autoDetectLanguage: true,
                aiEnabled: true,
                aiModel: 'gpt-4o-mini',
                commentReplyMode: 'dual',
                commentsAutoReply: true,
                messagesAutoReply: true,
                dualReplyNudge: dualNudge,
                businessHoursOnly: false,
                businessHoursStart: '09:00',
                businessHoursEnd: '18:00',
                awayMessage: null,
                greetingMessage: null,
                replyDelay: 0,
                timezone: 'UTC',
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 60,
                handoffPauseDurationMinutes: 30,
                notificationsEnabled: true,
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    commentReplyMode: 'dual',
                    dualReplyNudge: dualNudge,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.commentReplyMode).toBe('dual');
            expect(body.dualReplyNudge).toEqual(dualNudge);
        });

        it('should reject invalid comment reply mode', async () => {
            const { authService } = await import('../../src/services/auth');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    commentReplyMode: 'invalid_mode',
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.body);
            expect(body.error).toBe('Bad Request');
        });

        it('should update business hours settings', async () => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            vi.mocked(settingsService.updateSettings).mockResolvedValue({
                id: 'settings_123',
                userId: 'user_123',
                dashboardLanguage: 'ar',
                defaultReplyLanguage: 'ar',
                supportedLanguages: ['en', 'ar'],
                autoDetectLanguage: true,
                aiEnabled: true,
                aiModel: 'gpt-4o-mini',
                commentReplyMode: 'public',
                commentsAutoReply: true,
                messagesAutoReply: true,
                dualReplyNudge: null,
                businessHoursOnly: true,
                businessHoursStart: '08:00',
                businessHoursEnd: '20:00',
                awayMessage: null,
                greetingMessage: null,
                replyDelay: 0,
                timezone: 'UTC',
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 60,
                handoffPauseDurationMinutes: 30,
                notificationsEnabled: true,
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    businessHoursOnly: true,
                    businessHoursStart: '08:00',
                    businessHoursEnd: '20:00',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.businessHoursOnly).toBe(true);
            expect(body.businessHoursStart).toBe('08:00');
            expect(body.businessHoursEnd).toBe('20:00');
        });

        it('should update AI settings', async () => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            vi.mocked(settingsService.updateSettings).mockResolvedValue({
                id: 'settings_123',
                userId: 'user_123',
                dashboardLanguage: 'ar',
                defaultReplyLanguage: 'ar',
                supportedLanguages: ['en', 'ar'],
                autoDetectLanguage: true,
                aiEnabled: false,
                aiModel: 'gpt-4o-mini',
                commentReplyMode: 'public',
                commentsAutoReply: true,
                messagesAutoReply: true,
                dualReplyNudge: null,
                businessHoursOnly: false,
                businessHoursStart: '09:00',
                businessHoursEnd: '18:00',
                awayMessage: null,
                greetingMessage: null,
                replyDelay: 0,
                timezone: 'UTC',
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 60,
                handoffPauseDurationMinutes: 30,
                notificationsEnabled: true,
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    aiEnabled: false,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.aiEnabled).toBe(false);
        });

        it('should update multiple settings at once', async () => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            vi.mocked(settingsService.updateSettings).mockResolvedValue({
                id: 'settings_123',
                userId: 'user_123',
                dashboardLanguage: 'en',
                defaultReplyLanguage: 'en',
                supportedLanguages: ['en', 'ar'],
                autoDetectLanguage: false,
                aiEnabled: false,
                aiModel: 'gpt-4o-mini',
                commentReplyMode: 'dual',
                commentsAutoReply: false,
                messagesAutoReply: false,
                dualReplyNudge: 'تحقق من الرسائل',
                businessHoursOnly: true,
                businessHoursStart: '09:00',
                businessHoursEnd: '17:00',
                awayMessage: 'We are away',
                greetingMessage: 'Hello!',
                replyDelay: 5,
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    dashboardLanguage: 'en',
                    defaultReplyLanguage: 'en',
                    autoDetectLanguage: false,
                    aiEnabled: false,
                    commentReplyMode: 'dual',
                    dualReplyNudge: 'تحقق من الرسائل',
                    commentsAutoReply: false,
                    messagesAutoReply: false,
                    businessHoursOnly: true,
                    businessHoursStart: '09:00',
                    businessHoursEnd: '17:00',
                    awayMessage: 'We are away',
                    greetingMessage: 'Hello!',
                    replyDelay: 5,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.dashboardLanguage).toBe('en');
            expect(body.commentReplyMode).toBe('dual');
            expect(body.aiEnabled).toBe(false);
            expect(body.replyDelay).toBe(5);
        });

        it('should require authentication', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                payload: {
                    dashboardLanguage: 'en',
                },
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return 401 with invalid token', async () => {
            const { authService } = await import('../../src/services/auth');

            vi.mocked(authService.verifyToken).mockReturnValue(null);

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: {
                    authorization: 'Bearer invalid_token',
                },
                payload: {
                    dashboardLanguage: 'en',
                },
            });

            expect(response.statusCode).toBe(401);
        });

        it('should update timezone with valid IANA timezone', async () => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            vi.mocked(settingsService.updateSettings).mockResolvedValue({
                id: 'settings_123',
                userId: 'user_123',
                dashboardLanguage: 'ar',
                defaultReplyLanguage: 'ar',
                supportedLanguages: ['en', 'ar'],
                autoDetectLanguage: true,
                aiEnabled: true,
                aiModel: 'gpt-4o-mini',
                commentReplyMode: 'public',
                commentsAutoReply: true,
                messagesAutoReply: true,
                dualReplyNudge: null,
                businessHoursOnly: true,
                businessHoursStart: '09:00',
                businessHoursEnd: '18:00',
                timezone: 'America/New_York',
                awayMessage: null,
                greetingMessage: null,
                replyDelay: 0,
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 60,
                handoffPauseDurationMinutes: 30,
                notificationsEnabled: true,
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    timezone: 'America/New_York',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.timezone).toBe('America/New_York');
        });

        it('should reject invalid timezone', async () => {
            const { authService } = await import('../../src/services/auth');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    timezone: 'Not/A/Real/Timezone',
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.body);
            expect(body.error).toBe('Invalid request');
        });

        it('should validate reply delay range', async () => {
            const { authService } = await import('../../src/services/auth');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    replyDelay: 500, // Max is 300
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.body);
            expect(body.error).toBe('Bad Request');
        });

        it('should validate away message length', async () => {
            const { authService } = await import('../../src/services/auth');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            const longMessage = 'a'.repeat(501); // Max is 500

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    awayMessage: longMessage,
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.body);
            expect(body.error).toBe('Bad Request');
        });
    });

    describe('Settings - Edge Cases', () => {
        it('should handle empty dual reply nudge', async () => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            vi.mocked(settingsService.updateSettings).mockResolvedValue({
                id: 'settings_123',
                userId: 'user_123',
                dashboardLanguage: 'ar',
                defaultReplyLanguage: 'ar',
                supportedLanguages: ['en', 'ar'],
                autoDetectLanguage: true,
                aiEnabled: true,
                aiModel: 'gpt-4o-mini',
                commentReplyMode: 'dual',
                commentsAutoReply: true,
                messagesAutoReply: true,
                dualReplyNudge: '',
                businessHoursOnly: false,
                businessHoursStart: '09:00',
                businessHoursEnd: '18:00',
                awayMessage: null,
                greetingMessage: null,
                replyDelay: 0,
                timezone: 'UTC',
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 60,
                handoffPauseDurationMinutes: 30,
                notificationsEnabled: true,
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    commentReplyMode: 'dual',
                    dualReplyNudge: '',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.commentReplyMode).toBe('dual');
            expect(body.dualReplyNudge).toBe('');
        });

        it('should handle clearing away message', async () => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            vi.mocked(settingsService.updateSettings).mockResolvedValue({
                id: 'settings_123',
                userId: 'user_123',
                dashboardLanguage: 'ar',
                defaultReplyLanguage: 'ar',
                supportedLanguages: ['en', 'ar'],
                autoDetectLanguage: true,
                aiEnabled: true,
                aiModel: 'gpt-4o-mini',
                commentReplyMode: 'public',
                commentsAutoReply: true,
                messagesAutoReply: true,
                dualReplyNudge: null,
                businessHoursOnly: false,
                businessHoursStart: '09:00',
                businessHoursEnd: '18:00',
                awayMessage: null,
                greetingMessage: null,
                replyDelay: 0,
                timezone: 'UTC',
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 60,
                handoffPauseDurationMinutes: 30,
                notificationsEnabled: true,
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    awayMessage: '', // Empty string to clear
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.awayMessage).toBeNull();
        });
    });
});
