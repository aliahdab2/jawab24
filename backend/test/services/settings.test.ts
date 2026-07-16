import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_HANDOFF_PAUSE_MINUTES } from '@jawab24/shared';
import { settingsService } from '../../src/services/settings';

// Workspace-membership rows returned by the mocked db.select chain
// (resolveWorkspaceId). Default EMPTY: the D-026 overlay short-circuits
// (no workspace) and every legacy test behaves exactly as before.
const hoisted = vi.hoisted(() => ({
    membershipRows: [] as Array<{ workspaceId: string }>,
}));

// Mock Redis — default to cache miss so existing DB-path tests are unaffected
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
    },
}));

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
        select: vi.fn(() => ({
            from: () => ({
                where: () => ({
                    limit: () => Promise.resolve(hoisted.membershipRows),
                }),
            }),
        })),
    },
}));

vi.mock('../../src/db/schema', () => ({
    settings: {
        id: 'id',
        userId: 'user_id',
        updatedAt: 'updated_at',
    },
    workspaceMembers: {
        workspaceId: 'workspace_id',
        userId: 'user_id',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
}));

// Workspace store (D-026 overlay source). Default getSettings REJECTS so any
// test that opts into a membership but forgets to mock the store exercises
// the fail-open path instead of silently overlaying stale data.
vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        getSettings: vi.fn().mockRejectedValue(new Error('workspace store not mocked')),
        updateSettings: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

const baseSettings = {
    id: 'settings_123',
    userId: 'user_123',
    dashboardLanguage: 'ar',
    defaultReplyLanguage: 'ar',
    supportedLanguages: ['en', 'ar'],
    autoDetectLanguage: true,
    aiEnabled: true,
    aiModel: 'gpt-4.1-mini',
    commentReplyMode: 'public' as const,
    commentsAutoReply: true,
    messagesAutoReply: true,
    dualReplyNudge: '',
    businessHoursOnly: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '18:00',
    timezone: 'Asia/Damascus',
    awayMessage: null,
    greetingMessage: null,
    awayMessageMulti: {},
    greetingMessageMulti: {},
    dualReplyNudgeMulti: {},
    replyDelay: 0,
    commentEscalationMinutes: 60,
    messageEscalationMinutes: 30,
    handoffPauseDurationMinutes: DEFAULT_HANDOFF_PAUSE_MINUTES,
    notificationsEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
};

describe('Settings Service', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        // The singleton memoizes userId→workspaceId; clear it so each case's
        // membership mock is authoritative.
        const { settingsService } = await import('../../src/services/settings');
        settingsService.clearWorkspaceIdCache();
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

        // Regression: mapToUserSettings used to omit greetingMessageEnabled entirely,
        // so the API never returned it and the settings-page toggle always rendered
        // off (and any unrelated save then wrote it back to false). The DB column was
        // written correctly — only the read-back mapping was missing the field.
        it('should map greetingMessageEnabled back from the DB record', async () => {
            const { db } = await import('../../src/db');

            vi.mocked(db.query.settings.findFirst).mockResolvedValue({
                ...baseSettings,
                userId: 'user_greet',
                greetingMessageEnabled: true,
            } as any);

            const result = await settingsService.getSettings('user_greet');
            expect(result.greetingMessageEnabled).toBe(true);
        });

        it('should default greetingMessageEnabled to false when the column is null', async () => {
            const { db } = await import('../../src/db');

            vi.mocked(db.query.settings.findFirst).mockResolvedValue({
                ...baseSettings,
                userId: 'user_greet_null',
                greetingMessageEnabled: null,
            } as any);

            const result = await settingsService.getSettings('user_greet_null');
            expect(result.greetingMessageEnabled).toBe(false);
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

        it('should check business hours when enabled (within hours)', async () => {
            const { db } = await import('../../src/db');

            // Mock current time: 07:00 UTC = 10:00 Asia/Riyadh (UTC+3) → within 09:00-18:00
            const RealDate = Date;
            vi.spyOn(globalThis, 'Date').mockImplementation((...args: unknown[]) => {
                if (args.length === 0) return new RealDate('2026-02-15T07:00:00Z');
                return new (RealDate as any)(...args);
            });

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

            // Mock current time: 20:00 UTC = 23:00 Asia/Riyadh (UTC+3) → outside 09:00-18:00
            const RealDate = Date;
            vi.spyOn(globalThis, 'Date').mockImplementation((...args: unknown[]) => {
                if (args.length === 0) return new RealDate('2026-02-15T20:00:00Z');
                return new (RealDate as any)(...args);
            });

            const mockSettings = {
                ...baseSettings,
                businessHoursOnly: true,
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.isCommentsAutoReplyEnabled('user_123');

            expect(result).toBe(false);
        });

        it('should respect user timezone for business hours check', async () => {
            const { db } = await import('../../src/db');

            // 14:00 UTC = 09:00 America/New_York (UTC-5) → within 09:00-18:00
            const RealDate = Date;
            vi.spyOn(globalThis, 'Date').mockImplementation((...args: unknown[]) => {
                if (args.length === 0) return new RealDate('2026-02-15T14:00:00Z');
                return new (RealDate as any)(...args);
            });

            const mockSettings = {
                ...baseSettings,
                businessHoursOnly: true,
                timezone: 'America/New_York',
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.isCommentsAutoReplyEnabled('user_123');

            expect(result).toBe(true);
        });

        it('should fallback to server time on invalid timezone', async () => {
            const { db } = await import('../../src/db');

            // Use a time that would be within business hours in server time
            const RealDate = Date;
            vi.spyOn(globalThis, 'Date').mockImplementation((...args: unknown[]) => {
                if (args.length === 0) return new RealDate('2026-02-15T10:00:00Z');
                return new (RealDate as any)(...args);
            });
            // Fallback uses getHours/getMinutes on the mocked date
            vi.spyOn(RealDate.prototype, 'getHours').mockReturnValue(10);
            vi.spyOn(RealDate.prototype, 'getMinutes').mockReturnValue(0);

            const mockSettings = {
                ...baseSettings,
                businessHoursOnly: true,
                timezone: 'Invalid/Timezone',
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.isCommentsAutoReplyEnabled('user_123');

            expect(result).toBe(true); // Falls back to server time 10:00, within 09:00-18:00
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

        it('should return default away message when none is set', async () => {
            const { db } = await import('../../src/db');

            const mockSettings = {
                ...baseSettings,
            };

            vi.mocked(db.query.settings.findFirst).mockResolvedValue(mockSettings);

            const result = await settingsService.getAwayMessage('user_123');

            // Send-time fallback returns the default away message
            expect(result).toBeTruthy();
            expect(typeof result).toBe('string');
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

    // =========================================================
    // Redis cache behaviour
    // =========================================================

    describe('Redis caching', () => {
        it('getSettings: returns cached value and skips DB when cache hits', async () => {
            const { redis } = await import('../../src/lib/redis');
            const { db } = await import('../../src/db');

            const cached = { ...baseSettings, replyDelay: 99 };
            vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(cached));

            const result = await settingsService.getSettings('user_123');

            expect(result.replyDelay).toBe(99);
            // DB should NOT have been queried
            expect(db.query.settings.findFirst).not.toHaveBeenCalled();
        });

        it('getSettings: populates cache after a DB miss', async () => {
            const { redis } = await import('../../src/lib/redis');
            const { db } = await import('../../src/db');

            vi.mocked(redis.get).mockResolvedValueOnce(null); // cache miss
            vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

            await settingsService.getSettings('user_123');

            expect(redis.set).toHaveBeenCalledWith(
                'settings:v1:user_123',
                expect.any(String),
                'EX',
                300,
            );
        });

        it('getSettings: uses correct cache key per user', async () => {
            const { redis } = await import('../../src/lib/redis');
            const { db } = await import('../../src/db');

            vi.mocked(redis.get).mockResolvedValue(null);
            vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

            await settingsService.getSettings('user_abc');

            expect(redis.get).toHaveBeenCalledWith('settings:v1:user_abc');
        });

        it('updateSettings: invalidates cache after update', async () => {
            const { redis } = await import('../../src/lib/redis');
            const { db } = await import('../../src/db');

            vi.mocked(redis.get).mockResolvedValue(null);
            vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

            const mockReturning = vi.fn().mockResolvedValue([{ ...baseSettings, dashboardLanguage: 'en' }]);
            const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
            const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            await settingsService.updateSettings('user_123', { dashboardLanguage: 'en' });

            expect(redis.del).toHaveBeenCalledWith('settings:v1:user_123');
        });

        it('getSettings: falls back to DB when Redis.get throws', async () => {
            const { redis } = await import('../../src/lib/redis');
            const { db } = await import('../../src/db');

            vi.mocked(redis.get).mockRejectedValueOnce(new Error('Redis down'));
            vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

            const result = await settingsService.getSettings('user_123');

            // Should still return correct data from DB despite Redis failure
            expect(result.userId).toBe('user_123');
            expect(db.query.settings.findFirst).toHaveBeenCalled();
        });

        it('getSettings: continues without error when Redis.set throws', async () => {
            const { redis } = await import('../../src/lib/redis');
            const { db } = await import('../../src/db');

            vi.mocked(redis.get).mockResolvedValueOnce(null);
            vi.mocked(redis.set).mockRejectedValueOnce(new Error('Redis down'));
            vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

            // Should not throw even though cache write failed
            const result = await settingsService.getSettings('user_123');
            expect(result.userId).toBe('user_123');
        });

        it('updateSettings: continues without error when Redis.del throws', async () => {
            const { redis } = await import('../../src/lib/redis');
            const { db } = await import('../../src/db');

            vi.mocked(redis.get).mockResolvedValue(null);
            vi.mocked(redis.del).mockRejectedValueOnce(new Error('Redis down'));
            vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

            const mockReturning = vi.fn().mockResolvedValue([baseSettings]);
            const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
            const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            // Should not throw even though cache invalidation failed
            await expect(
                settingsService.updateSettings('user_123', { dashboardLanguage: 'en' }),
            ).resolves.not.toThrow();
        });
    });

    // D-026: legacy settings reads serve pipeline fields from the WORKSPACE store —
    // the store the reply pipeline actually obeys. Regression for the D-025 cohort
    // where the legacy row said masters ON while the pipeline ran OFF, so the
    // /settings page and dashboard lied to every new signup.
    describe('workspace pipeline-field overlay (D-026)', () => {
        beforeEach(() => {
            hoisted.membershipRows.length = 0;
        });

        it('serves effective masters from the workspace store (the "API lies to new signups" regression)', async () => {
            const { db } = await import('../../src/db');
            const { workspaceSettingsService } = await import('../../src/services/workspaceSettings');

            hoisted.membershipRows.push({ workspaceId: 'ws_1' });
            // Legacy row: the pre-D-025 defaults — masters ON, mode public
            vi.mocked(db.query.settings.findFirst).mockResolvedValue({ ...baseSettings });
            // Workspace store: the D-025 new-signup seed — the state the pipeline runs
            vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
                commentsAutoReply: false,
                messagesAutoReply: false,
                commentReplyMode: 'dual',
            } as any);

            const result = await settingsService.getSettings('user_123');

            expect(result.commentsAutoReply).toBe(false);
            expect(result.messagesAutoReply).toBe(false);
            expect(result.commentReplyMode).toBe('dual');
        });

        it('does NOT overlay aiModel (legacy is authoritative — admin override bypasses sync)', async () => {
            const { db } = await import('../../src/db');
            const { workspaceSettingsService } = await import('../../src/services/workspaceSettings');

            hoisted.membershipRows.push({ workspaceId: 'ws_1' });
            vi.mocked(db.query.settings.findFirst).mockResolvedValue({
                ...baseSettings,
                aiModel: 'gpt-4.1', // admin-set premium model, legacy table only
            });
            vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
                aiModel: 'gpt-4.1-mini', // stale workspace copy
                commentsAutoReply: true,
            } as any);

            const result = await settingsService.getSettings('user_123');
            expect(result.aiModel).toBe('gpt-4.1');
        });

        it('leaves non-pipeline fields untouched', async () => {
            const { db } = await import('../../src/db');
            const { workspaceSettingsService } = await import('../../src/services/workspaceSettings');

            hoisted.membershipRows.push({ workspaceId: 'ws_1' });
            vi.mocked(db.query.settings.findFirst).mockResolvedValue({
                ...baseSettings,
                dashboardLanguage: 'ar',
                notificationsEnabled: true,
            });
            vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
                commentsAutoReply: false,
            } as any);

            const result = await settingsService.getSettings('user_123');
            expect(result.dashboardLanguage).toBe('ar');
            expect(result.notificationsEnabled).toBe(true);
            expect(result.commentsAutoReply).toBe(false);
        });

        it('fails open to legacy values when the workspace store read throws', async () => {
            const { db } = await import('../../src/db');
            const { workspaceSettingsService } = await import('../../src/services/workspaceSettings');
            const { captureError } = await import('../../src/utils/sentryHelpers');

            hoisted.membershipRows.push({ workspaceId: 'ws_1' });
            vi.mocked(db.query.settings.findFirst).mockResolvedValue({ ...baseSettings });
            vi.mocked(workspaceSettingsService.getSettings).mockRejectedValue(new Error('redis down'));

            const result = await settingsService.getSettings('user_123');

            // Legacy values survive — a workspace-store hiccup never breaks a read
            expect(result.commentsAutoReply).toBe(true);
            expect(result.messagesAutoReply).toBe(true);
            expect(vi.mocked(captureError)).toHaveBeenCalled();
        });

        it('is an identity function when the user has no workspace', async () => {
            const { db } = await import('../../src/db');
            const { workspaceSettingsService } = await import('../../src/services/workspaceSettings');

            // membershipRows left empty — no workspace
            vi.mocked(db.query.settings.findFirst).mockResolvedValue({ ...baseSettings });

            const result = await settingsService.getSettings('user_123');

            expect(result.commentsAutoReply).toBe(true);
            expect(vi.mocked(workspaceSettingsService.getSettings)).not.toHaveBeenCalled();
        });

        it('overlays the value returned by updateSettings (read-after-write consistency)', async () => {
            const { db } = await import('../../src/db');
            const { workspaceSettingsService } = await import('../../src/services/workspaceSettings');

            hoisted.membershipRows.push({ workspaceId: 'ws_1' });
            vi.mocked(db.query.settings.findFirst).mockResolvedValue({ ...baseSettings });

            const mockReturning = vi.fn().mockResolvedValue([{ ...baseSettings, replyDelay: 5 }]);
            const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
            const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            // Workspace store reflects the synced write
            vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
                replyDelay: 5,
                commentsAutoReply: false,
            } as any);

            const result = await settingsService.updateSettings('user_123', { replyDelay: 5 });

            expect(result.replyDelay).toBe(5);
            expect(result.commentsAutoReply).toBe(false);
        });
    });
});
