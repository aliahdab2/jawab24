import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Regression test: locks the current behavior of settingsService.updateSettings
 * propagating pipeline-relevant fields to the workspace JSONB via
 * workspaceSettingsService.updateSettings.
 *
 * This catches future regressions in the sync code path. The sync path bridges
 * the legacy settings table and the workspace.settings JSONB that the reply
 * pipeline reads from.
 *
 * Context: 5 merchants selected commentReplyMode='dual' in UI but the pipeline
 * ran in 'public' mode. The sync path looked correct but didn't run in production.
 * This test locks expected behavior so it can't break silently again.
 */

// Mock Redis — default to cache miss
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
    },
}));

// Mock database with full chain for both getSettings (query) and updateSettings (update/select)
vi.mock('../../src/db', () => ({
    db: {
        query: {
            settings: {
                findFirst: vi.fn(),
            },
        },
        select: vi.fn(),
        update: vi.fn(),
        insert: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    settings: {
        id: 'id',
        userId: 'user_id',
        updatedAt: 'updated_at',
    },
    workspaceMembers: {
        userId: 'user_id',
        workspaceId: 'workspace_id',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
}));

vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        updateSettings: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

import { settingsService } from '../../src/services/settings';
import { redis } from '../../src/lib/redis';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';

const baseSettings = {
    id: 'settings_123',
    userId: 'u1',
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
    dualReplyNudgeMulti: {},
    dualReplyNudgeVariations: {},
    businessHoursOnly: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '18:00',
    timezone: 'Asia/Damascus',
    awayMessage: null,
    greetingMessage: null,
    awayMessageMulti: {},
    greetingMessageMulti: {},
    replyDelay: 0,
    commentEscalationMinutes: 60,
    messageEscalationMinutes: 30,
    handoffPauseDurationMinutes: 30,
    replyStyle: 'professional' as const,
    brandVoiceNotes: '',
    brandVoiceNotesMulti: {},
    holdLowConfidence: false,
    notificationsEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
};

describe('settingsService.updateSettings → workspace sync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('propagates commentReplyMode change to workspace JSONB via workspaceSettingsService', async () => {
        const { db } = await import('../../src/db');

        // Mock: getSettings returns existing settings
        vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

        // Mock: select membership returns one workspace
        const mockFrom = vi.fn().mockReturnThis();
        const mockWhere = vi.fn().mockReturnThis();
        const mockLimit = vi.fn().mockResolvedValue([{ workspaceId: 'ws1' }]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockFrom.mockReturnValue({ where: mockWhere } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockWhere.mockReturnValue({ limit: mockLimit } as any);

        // Mock: update returns the new settings
        const updatedSettings = { ...baseSettings, commentReplyMode: 'dual' as const };
        const mockReturning = vi.fn().mockResolvedValue([updatedSettings]);
        const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockReturning });
        const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

        await settingsService.updateSettings('u1', { commentReplyMode: 'dual' });

        expect(vi.mocked(workspaceSettingsService.updateSettings)).toHaveBeenCalledWith(
            'ws1',
            expect.objectContaining({ commentReplyMode: 'dual' }),
        );
    });

    it('skips workspace sync when no pipeline fields are in the update', async () => {
        const { db } = await import('../../src/db');

        // Mock: getSettings returns existing settings
        vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

        // Mock: update returns the updated settings
        const updatedSettings = { ...baseSettings, dashboardLanguage: 'en' };
        const mockReturning = vi.fn().mockResolvedValue([updatedSettings]);
        const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockReturning });
        const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

        await settingsService.updateSettings('u1', { dashboardLanguage: 'en' });

        // dashboardLanguage is NOT a pipeline field, so workspace sync should be skipped
        expect(vi.mocked(workspaceSettingsService.updateSettings)).not.toHaveBeenCalled();
    });

    it('skips workspace sync gracefully when user has no membership (does not throw)', async () => {
        const { db } = await import('../../src/db');

        // Mock: getSettings returns existing settings
        vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

        // Mock: select membership returns empty (no workspace)
        const mockFrom = vi.fn().mockReturnThis();
        const mockWhere = vi.fn().mockReturnThis();
        const mockLimit = vi.fn().mockResolvedValue([]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockFrom.mockReturnValue({ where: mockWhere } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockWhere.mockReturnValue({ limit: mockLimit } as any);

        // Mock: update returns the new settings
        const updatedSettings = { ...baseSettings, commentReplyMode: 'dual' as const };
        const mockReturning = vi.fn().mockResolvedValue([updatedSettings]);
        const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockReturning });
        const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

        // Should not throw even though no workspace is found
        await expect(settingsService.updateSettings('u1', { commentReplyMode: 'dual' })).resolves.toBeDefined();

        expect(vi.mocked(workspaceSettingsService.updateSettings)).not.toHaveBeenCalled();
    });

    it('syncs multiple pipeline fields in one call', async () => {
        const { db } = await import('../../src/db');

        // Mock: getSettings returns existing settings
        vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

        // Mock: select membership returns one workspace
        const mockFrom = vi.fn().mockReturnThis();
        const mockWhere = vi.fn().mockReturnThis();
        const mockLimit = vi.fn().mockResolvedValue([{ workspaceId: 'ws1' }]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockFrom.mockReturnValue({ where: mockWhere } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockWhere.mockReturnValue({ limit: mockLimit } as any);

        // Mock: update returns the new settings
        const updatedSettings = {
            ...baseSettings,
            commentReplyMode: 'dual' as const,
            dualReplyNudge: 'Just to let you know...',
            aiEnabled: false,
        };
        const mockReturning = vi.fn().mockResolvedValue([updatedSettings]);
        const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockReturning });
        const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

        await settingsService.updateSettings('u1', {
            commentReplyMode: 'dual',
            dualReplyNudge: 'Just to let you know...',
            aiEnabled: false,
        });

        expect(vi.mocked(workspaceSettingsService.updateSettings)).toHaveBeenCalledWith(
            'ws1',
            expect.objectContaining({
                commentReplyMode: 'dual',
                dualReplyNudge: 'Just to let you know...',
                aiEnabled: false,
            }),
        );
    });

    it('passes only the fields in the update to workspaceSettingsService, not the entire DB record', async () => {
        const { db } = await import('../../src/db');

        // Mock: getSettings returns existing settings
        vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

        // Mock: select membership returns one workspace
        const mockFrom = vi.fn().mockReturnThis();
        const mockWhere = vi.fn().mockReturnThis();
        const mockLimit = vi.fn().mockResolvedValue([{ workspaceId: 'ws1' }]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockFrom.mockReturnValue({ where: mockWhere } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockWhere.mockReturnValue({ limit: mockLimit } as any);

        // Mock: update returns the new settings
        const updatedSettings = { ...baseSettings, commentReplyMode: 'private' as const };
        const mockReturning = vi.fn().mockResolvedValue([updatedSettings]);
        const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockReturning });
        const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

        await settingsService.updateSettings('u1', { commentReplyMode: 'private' });

        // The call should have exactly the update payload (no extraneous fields like dashboardLanguage)
        const calls = vi.mocked(workspaceSettingsService.updateSettings).mock.calls;
        expect(calls.length).toBe(1);
        const [wsId, updates] = calls[0];
        expect(wsId).toBe('ws1');
        expect(Object.keys(updates)).toEqual(['commentReplyMode']);
    });

    it('invalidates the Redis cache after settings update', async () => {
        const { db } = await import('../../src/db');

        // Mock: getSettings returns existing settings
        vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

        // Mock: select membership returns one workspace
        const mockFrom = vi.fn().mockReturnThis();
        const mockWhere = vi.fn().mockReturnThis();
        const mockLimit = vi.fn().mockResolvedValue([{ workspaceId: 'ws1' }]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockFrom.mockReturnValue({ where: mockWhere } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockWhere.mockReturnValue({ limit: mockLimit } as any);

        // Mock: update returns the new settings
        const updatedSettings = { ...baseSettings, commentReplyMode: 'dual' as const };
        const mockReturning = vi.fn().mockResolvedValue([updatedSettings]);
        const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockReturning });
        const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

        await settingsService.updateSettings('u1', { commentReplyMode: 'dual' });

        expect(vi.mocked(redis.del)).toHaveBeenCalledWith('settings:v1:u1');
    });
});
