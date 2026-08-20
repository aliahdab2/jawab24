import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import { MAX_TEMPLATE_MESSAGE_LENGTH, MAX_BRAND_VOICE_LENGTH, UpdateSettingsSchema } from '@jawab24/shared';
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
    requireRole: () => async () => {},
}));

vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        updateSettings: vi.fn(),
    },
}));

// The controller runs smart auto-translation for *Multi fields (controllers/settings.ts),
// which calls the translation service (ai-worker/OpenAI). These route tests verify
// field ACCEPTANCE, not translation — stub the network calls so a *Multi payload
// doesn't 500 on an unavailable translator in the unit-test env (it works in prod).
vi.mock('../../src/services/translation', () => ({
    translateText: vi.fn(async ({ text }: { text: string }) => ({ translatedText: text })),
    generateNudgeVariations: vi.fn(async (text: string) => [text]),
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
                aiModel: 'gpt-4.1-mini',
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
                aiModel: 'gpt-4.1-mini',
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
                aiModel: 'gpt-4.1-mini',
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
            }, 'test_workspace_id');
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
                aiModel: 'gpt-4.1-mini',
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
                aiModel: 'gpt-4.1-mini',
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
                aiModel: 'gpt-4.1-mini',
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
                aiModel: 'gpt-4.1-mini',
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
                aiModel: 'gpt-4.1-mini',
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
                aiModel: 'gpt-4.1-mini',
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
                aiModel: 'gpt-4.1-mini',
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

        // Regression: a customer with a 639-char greeting (saved before this validation
        // existed) was unable to toggle ai_enabled because the frontend re-sent the
        // entire settings payload — including the legacy greetingMessage. The 500-char
        // cap rejected the whole PUT, blocking unrelated fields. The cap now matches
        // the strictest platform limit (Instagram DM = 1000 chars).
        const overLimit = 'a'.repeat(MAX_TEMPLATE_MESSAGE_LENGTH + 1);
        const atLimit = 'a'.repeat(MAX_TEMPLATE_MESSAGE_LENGTH);

        it.each([
            ['awayMessage'],
            ['greetingMessage'],
        ])('rejects %s longer than MAX_TEMPLATE_MESSAGE_LENGTH', async (field) => {
            const { authService } = await import('../../src/services/auth');
            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: { authorization: 'Bearer valid_token' },
                payload: { [field]: overLimit },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.body);
            expect(body.error).toBe('Bad Request');
            expect(body.message).toContain(field);
        });

        it.each([
            ['awayMessage'],
            ['greetingMessage'],
        ])('accepts %s exactly at MAX_TEMPLATE_MESSAGE_LENGTH', async (field) => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');
            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });
            vi.mocked(settingsService.updateSettings).mockResolvedValue({
                id: 'settings_123',
                userId: 'user_123',
                [field]: atLimit,
            } as never);

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: { authorization: 'Bearer valid_token' },
                payload: { [field]: atLimit },
            });

            expect(response.statusCode).toBe(200);
        });

        // brandVoiceNotes has its own cap (MAX_BRAND_VOICE_LENGTH = 800) — it is
        // injected into the AI system prompt, not sent to customers, so it is not
        // tied to the Instagram DM template limit above.
        const brandVoiceOverLimit = 'a'.repeat(MAX_BRAND_VOICE_LENGTH + 1);
        const brandVoiceAtLimit = 'a'.repeat(MAX_BRAND_VOICE_LENGTH);

        it('rejects brandVoiceNotes longer than MAX_BRAND_VOICE_LENGTH', async () => {
            const { authService } = await import('../../src/services/auth');
            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: { authorization: 'Bearer valid_token' },
                payload: { brandVoiceNotes: brandVoiceOverLimit },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.body);
            expect(body.error).toBe('Bad Request');
            expect(body.message).toContain('brandVoiceNotes');
        });

        it('accepts brandVoiceNotes exactly at MAX_BRAND_VOICE_LENGTH', async () => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');
            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });
            vi.mocked(settingsService.updateSettings).mockResolvedValue({
                id: 'settings_123',
                userId: 'user_123',
                brandVoiceNotes: brandVoiceAtLimit,
            } as never);

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: { authorization: 'Bearer valid_token' },
                payload: { brandVoiceNotes: brandVoiceAtLimit },
            });

            expect(response.statusCode).toBe(200);
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
                aiModel: 'gpt-4.1-mini',
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
                aiModel: 'gpt-4.1-mini',
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

    // Regression: the route schema's `additionalProperties: false` previously
    // rejected the full PUT whenever the frontend sent these fields, blocking
    // saves entirely. These tests lock the route in as accepting them.
    describe('PUT /settings - Field acceptance (regression)', () => {
        const setupAuth = async (returnValue: Record<string, unknown> = {}) => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');
            vi.mocked(authService.verifyToken).mockReturnValue({ userId: 'user_123', facebookId: 'fb_123' });
            vi.mocked(settingsService.updateSettings).mockResolvedValue({ id: 's', userId: 'user_123', ...returnValue } as never);
            return settingsService;
        };

        it('accepts limitFallbackEnabled + limitFallbackMessageMulti', async () => {
            const settingsService = await setupAuth({ limitFallbackEnabled: true });
            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: { authorization: 'Bearer valid_token' },
                payload: {
                    limitFallbackEnabled: true,
                    limitFallbackMessageMulti: { ar: 'تجاوزنا الحد', sourceLang: 'ar' },
                },
            });

            expect(response.statusCode).toBe(200);
            expect(settingsService.updateSettings).toHaveBeenCalled();
            const updates = vi.mocked(settingsService.updateSettings).mock.calls[0][1];
            expect(updates.limitFallbackEnabled).toBe(true);
            expect(updates.limitFallbackMessageMulti).toBeDefined();
        });

        it('accepts dualReplyNudgeVariations', async () => {
            const settingsService = await setupAuth();
            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: { authorization: 'Bearer valid_token' },
                payload: {
                    dualReplyNudgeVariations: { ar: ['v1', 'v2'], en: ['v1', 'v2'] },
                },
            });

            expect(response.statusCode).toBe(200);
            expect(settingsService.updateSettings).toHaveBeenCalled();
        });

        it('accepts onboardingCompletedAt as ISO string', async () => {
            const settingsService = await setupAuth();
            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: { authorization: 'Bearer valid_token' },
                payload: { onboardingCompletedAt: new Date().toISOString() },
            });

            expect(response.statusCode).toBe(200);
            expect(settingsService.updateSettings).toHaveBeenCalled();
            const updates = vi.mocked(settingsService.updateSettings).mock.calls[0][1];
            expect(updates.onboardingCompletedAt).toBeDefined();
        });

        it('accepts onboardingCompletedAt as null', async () => {
            const settingsService = await setupAuth();
            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: { authorization: 'Bearer valid_token' },
                payload: { onboardingCompletedAt: null },
            });

            expect(response.statusCode).toBe(200);
            expect(settingsService.updateSettings).toHaveBeenCalled();
        });

    });

    describe('PUT /settings - Schema rejection (root-cause coverage)', () => {
        const setupAuth = async () => {
            const { authService } = await import('../../src/services/auth');
            vi.mocked(authService.verifyToken).mockReturnValue({ userId: 'user_123', facebookId: 'fb_123' });
        };

        // Note: `additionalProperties: false` in the generated schema is
        // currently a no-op at the Fastify layer because the global Ajv runs
        // with `removeAdditional: true` (Fastify's default) — unknown keys are
        // silently stripped, not rejected. The shared Zod schema has `.strict()`
        // which the frontend uses to catch unknown keys pre-submit, and the
        // controller's `validateSchema(UpdateSettingsSchema, …)` call would
        // catch them server-side too — but since the body has already been
        // stripped by Fastify, that re-check sees an empty object. Promoting
        // server-side rejection to "400 + named field" requires changing the
        // app-wide Ajv config (`removeAdditional: false`) which has blast
        // radius on other routes; tracked for a follow-up PR.

        it('rejects dualReplyNudge longer than 80 chars with 400', async () => {
            await setupAuth();
            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: { authorization: 'Bearer valid_token' },
                payload: { dualReplyNudge: 'a'.repeat(81) },
            });

            expect(response.statusCode).toBe(400);
            expect(response.body).toContain('dualReplyNudge');
        });

        it('rejects out-of-range replyDelay with 400', async () => {
            await setupAuth();
            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: { authorization: 'Bearer valid_token' },
                payload: { replyDelay: 999 },
            });

            expect(response.statusCode).toBe(400);
            expect(response.body).toContain('replyDelay');
        });

        it('rejects awayMessage longer than MAX_TEMPLATE_MESSAGE_LENGTH', async () => {
            await setupAuth();
            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: { authorization: 'Bearer valid_token' },
                payload: { awayMessage: 'a'.repeat(MAX_TEMPLATE_MESSAGE_LENGTH + 1) },
            });

            expect(response.statusCode).toBe(400);
            expect(response.body).toContain('awayMessage');
        });
    });

    describe('PUT /settings - Shared schema round-trip (drift prevention)', () => {
        // The whole point of moving `UpdateSettingsSchema` to @jawab24/shared is
        // that the frontend and backend agree byte-for-byte on what a valid
        // settings payload looks like. Unit-testing the schema in isolation
        // (packages/shared) doesn't catch:
        //   - zodToJsonSchema producing JSON the Fastify+Ajv pipeline rejects
        //   - A stale dist/ from an unbuilt shared package
        //   - The controller's re-validation diverging from the route's gate
        //
        // These tests use the SAME schema instance the frontend would use,
        // construct payloads from it, and PUT through the real Fastify route.
        // Any drift between layers fails here.

        const setupAuthAndService = async () => {
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');
            vi.mocked(authService.verifyToken).mockReturnValue({ userId: 'user_123', facebookId: 'fb_123' });
            vi.mocked(settingsService.updateSettings).mockImplementation(async (_id, data) => ({
                id: 's', userId: 'user_123', ...data,
            } as never));
            return settingsService;
        };

        it('a payload the shared schema accepts is also accepted by the Fastify route', async () => {
            const settingsService = await setupAuthAndService();

            // Build a non-trivial payload from constructs the frontend uses.
            const validPayload = {
                dashboardLanguage: 'en',
                commentsAutoReply: true,
                replyStyle: 'professional' as const,
                replyDelay: 30,
                commentEscalationMinutes: 45,
                messageEscalationMinutes: 30,
                handoffPauseDurationMinutes: 15,
                businessHoursStart: '09:00',
                businessHoursEnd: '18:00',
                timezone: 'Asia/Riyadh',
                awayMessage: 'We\'ll get back to you soon.',
                dualReplyNudge: 'Check your DMs',
            };

            // Sanity: the shared schema must accept it (proves we built a
            // genuinely valid payload, not one that accidentally bypasses Zod).
            const parsed = UpdateSettingsSchema.safeParse(validPayload);
            expect(parsed.success).toBe(true);

            // The Fastify route — using the schema converted via zodToJsonSchema
            // — must also accept it. If the conversion drops/distorts any rule,
            // this fails.
            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: { authorization: 'Bearer valid_token' },
                payload: validPayload,
            });

            expect(response.statusCode).toBe(200);
            expect(settingsService.updateSettings).toHaveBeenCalled();
            const forwardedBody = vi.mocked(settingsService.updateSettings).mock.calls[0][1];
            // Every key we sent should reach the controller intact (no silent
            // stripping of fields the shared schema declares).
            for (const key of Object.keys(validPayload) as Array<keyof typeof validPayload>) {
                expect(forwardedBody).toHaveProperty(key);
            }
        });

        // Bad payloads constructed deliberately so each row exercises a
        // different shared-schema rule. If Fastify-side validation diverges
        // from Zod-side validation for any of these, the round-trip fails.
        it.each([
            ['dualReplyNudge too long', { dualReplyNudge: 'a'.repeat(81) }, 'dualReplyNudge'],
            ['replyDelay out of range', { replyDelay: 999 }, 'replyDelay'],
            ['awayMessage too long', { awayMessage: 'a'.repeat(MAX_TEMPLATE_MESSAGE_LENGTH + 1) }, 'awayMessage'],
            ['greetingMessage too long', { greetingMessage: 'a'.repeat(MAX_TEMPLATE_MESSAGE_LENGTH + 1) }, 'greetingMessage'],
            ['brandVoiceNotes too long', { brandVoiceNotes: 'a'.repeat(MAX_BRAND_VOICE_LENGTH + 1) }, 'brandVoiceNotes'],
            ['commentEscalationMinutes below 5', { commentEscalationMinutes: 1 }, 'commentEscalationMinutes'],
            ['messageEscalationMinutes above 1440', { messageEscalationMinutes: 2000 }, 'messageEscalationMinutes'],
            ['unknown enum commentReplyMode', { commentReplyMode: 'mixed' }, 'commentReplyMode'],
            ['unknown enum replyStyle', { replyStyle: 'snarky' }, 'replyStyle'],
        ])('%s — shared schema rejects AND Fastify route rejects with field name', async (_label, badPayload, fieldName) => {
            await setupAuthAndService();

            // Both layers must agree the payload is invalid.
            const sharedResult = UpdateSettingsSchema.safeParse(badPayload);
            expect(sharedResult.success).toBe(false);

            const response = await app.inject({
                method: 'PUT',
                url: '/settings',
                headers: { authorization: 'Bearer valid_token' },
                payload: badPayload,
            });

            expect(response.statusCode).toBe(400);
            expect(response.body).toContain(fieldName);
        });
    });
});
