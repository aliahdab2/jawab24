import { describe, it, expect, vi, beforeEach } from 'vitest';
import { settingsService } from '../../src/services/settings';

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
        updatedAt: 'updated_at',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
}));

const baseSettings = {
    id: 'settings_123',
    userId: 'user_123',
    dashboardLanguage: 'ar',
    defaultReplyLanguage: 'ar',
    supportedLanguages: ['en', 'ar'],
    autoDetectLanguage: true,
    aiEnabled: true,
    aiModel: 'gpt-4o-mini',
    commentReplyMode: 'public' as const,
    commentsAutoReply: true,
    messagesAutoReply: true,
    dualReplyNudge: '',
    businessHoursOnly: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '18:00',
    awayMessage: null,
    greetingMessage: null,
    awayMessageMulti: {},
    greetingMessageMulti: {},
    dualReplyNudgeMulti: {},
    replyDelay: 0,
    commentEscalationMinutes: 60,
    messageEscalationMinutes: 30,
    handoffPauseDurationMinutes: 30,
    notificationsEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
};

describe('Settings Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getSettings', () => {
        it('should return existing settings for user', async () => {
            const { db } = await import('../../src/db');

            const mockSettings = {
                ...baseSettings,
                commentEscalationMinutes: 90,
                messageEscalationMinutes: 15,
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.getSettings('user_123');

            expect(result.userId).toBe('user_123');
            expect(result.dashboardLanguage).toBe('ar');
            expect(result.commentReplyMode).toBe('public');
            expect(result.commentEscalationMinutes).toBe(90);
            expect(result.messageEscalationMinutes).toBe(15);
        });

        it('should return default escalation values when fields are null', async () => {
            const { db } = await import('../../src/db');

            const mockSettings = {
                ...baseSettings,
                userId: 'user_456',
                commentEscalationMinutes: null,
                messageEscalationMinutes: null,
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings as any);

            const result = await settingsService.getSettings('user_456');

            expect(result.commentEscalationMinutes).toBe(60); // default
            expect(result.messageEscalationMinutes).toBe(30); // default
        });

        it('should create default settings if none exist', async () => {
            const { db } = await import('../../src/db');

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(null as any);

            const mockReturning = vi.fn().mockResolvedValue([{
                ...baseSettings,
                userId: 'new_user',
            }]);

            const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
            vi.mocked(db.insert).mockReturnValue({ values: mockValues } as any);

            const result = await settingsService.getSettings('new_user');

            expect(result.userId).toBe('new_user');
            expect(db.insert).toHaveBeenCalled();
        });

        it('should return settings with dual mode configuration', async () => {
            const { db } = await import('../../src/db');

            const dualNudge = 'تم الرد في رسالة خاصة 📥';

            const mockSettings = {
                ...baseSettings,
                userId: 'user_dual',
                commentReplyMode: 'dual' as const,
                dualReplyNudge: dualNudge,
                dualReplyNudgeMulti: { ar: dualNudge },
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.getSettings('user_dual');

            expect(result.commentReplyMode).toBe('dual');
            expect(result.dualReplyNudge).toEqual(dualNudge);
        });
    });

    describe('updateSettings', () => {
        it('should update settings successfully', async () => {
            const { db } = await import('../../src/db');

            // Mock getSettings to return existing settings
            const existingSettings = {
                ...baseSettings,
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(existingSettings);

            const updatedSettings = {
                ...existingSettings,
                dashboardLanguage: 'en',
                updatedAt: new Date(),
            };

            const mockReturning = vi.fn().mockResolvedValue([updatedSettings]);
            const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
            const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            const result = await settingsService.updateSettings('user_123', {
                dashboardLanguage: 'en',
            });

            expect(result.dashboardLanguage).toBe('en');
            expect(db.update).toHaveBeenCalled();
        });

        it('should update comment reply mode to dual', async () => {
            const { db } = await import('../../src/db');

            const existingSettings = {
                ...baseSettings,
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(existingSettings);

            const dualNudge = 'تحقق من الرسائل';

            const updatedSettings = {
                ...existingSettings,
                commentReplyMode: 'dual',
                dualReplyNudge: dualNudge,
                updatedAt: new Date(),
            };

            const mockReturning = vi.fn().mockResolvedValue([updatedSettings]);
            const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
            const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            const result = await settingsService.updateSettings('user_123', {
                commentReplyMode: 'dual',
                dualReplyNudge: dualNudge,
            });

            expect(result.commentReplyMode).toBe('dual');
            expect(result.dualReplyNudge).toEqual(dualNudge);
        });
    });

    describe('isCommentsAutoReplyEnabled', () => {
        it('should return true when comments auto-reply is enabled', async () => {
            const { db } = await import('../../src/db');

            const mockSettings = {
                ...baseSettings,
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.isCommentsAutoReplyEnabled('user_123');

            expect(result).toBe(true);
        });

        it('should return false when comments auto-reply is disabled', async () => {
            const { db } = await import('../../src/db');

            const mockSettings = {
                ...baseSettings,
                commentsAutoReply: false,
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.isCommentsAutoReplyEnabled('user_123');

            expect(result).toBe(false);
        });

        it('should check business hours when enabled', async () => {
            const { db } = await import('../../src/db');

            // Mock current time to be within business hours (10:00)
            vi.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
            vi.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);

            const mockSettings = {
                ...baseSettings,
                businessHoursOnly: true,
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.isCommentsAutoReplyEnabled('user_123');

            expect(result).toBe(true);
        });

        it('should return false outside business hours', async () => {
            const { db } = await import('../../src/db');

            // Mock current time to be outside business hours (22:00)
            vi.spyOn(Date.prototype, 'getHours').mockReturnValue(22);
            vi.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);

            const mockSettings = {
                ...baseSettings,
                businessHoursOnly: true,
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.isCommentsAutoReplyEnabled('user_123');

            expect(result).toBe(false);
        });
    });

    describe('isMessagesAutoReplyEnabled', () => {
        it('should return true when messages auto-reply is enabled', async () => {
            const { db } = await import('../../src/db');

            const mockSettings = {
                ...baseSettings,
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.isMessagesAutoReplyEnabled('user_123');

            expect(result).toBe(true);
        });

        it('should return false when messages auto-reply is disabled', async () => {
            const { db } = await import('../../src/db');

            const mockSettings = {
                ...baseSettings,
                messagesAutoReply: false,
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.isMessagesAutoReplyEnabled('user_123');

            expect(result).toBe(false);
        });
    });

    describe('getAwayMessage', () => {
        it('should return away message when set', async () => {
            const { db } = await import('../../src/db');

            const mockSettings = {
                ...baseSettings,
                awayMessage: 'We are currently away',
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.getAwayMessage('user_123');

            expect(result).toBe('We are currently away');
        });

        it('should return null when away message is not set', async () => {
            const { db } = await import('../../src/db');

            const mockSettings = {
                ...baseSettings,
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.getAwayMessage('user_123');

            expect(result).toBeNull();
        });
    });

    describe('getGreetingMessage', () => {
        it('should return greeting message when set', async () => {
            const { db } = await import('../../src/db');

            const mockSettings = {
                ...baseSettings,
                greetingMessage: 'Welcome! How can we help?',
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.getGreetingMessage('user_123');

            expect(result).toBe('Welcome! How can we help?');
        });
    });

    describe('getReplyDelay', () => {
        it('should return reply delay in seconds', async () => {
            const { db } = await import('../../src/db');

            const mockSettings = {
                ...baseSettings,
                replyDelay: 30,
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.getReplyDelay('user_123');

            expect(result).toBe(30);
        });

        it('should return 0 when no delay is set', async () => {
            const { db } = await import('../../src/db');

            const mockSettings = {
                ...baseSettings,
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.getReplyDelay('user_123');

            expect(result).toBe(0);
        });
    });
});
