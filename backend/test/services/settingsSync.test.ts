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
import { db } from '../../src/db';

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

// ── Test helpers ─────────────────────────────────────────────────────────────

function buildMembershipQuery(workspaceId: string | null) {
    const rows = workspaceId ? [{ workspaceId }] : [];
    const limitMock = vi.fn().mockResolvedValue(rows);
    const mockWhere = vi.fn().mockReturnValue({ limit: limitMock });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    return { from: mockFrom, _limitMock: limitMock };
}

function buildSettingsUpdateChain<T>(updatedRow: T) {
    const mockReturning = vi.fn().mockResolvedValue([updatedRow]);
    const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    return { set: mockSet, _setMock: mockSet };
}

describe('settingsService.updateSettings → workspace sync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // The singleton memoizes userId→workspaceId; clear it so each case's
        // membership mock is authoritative.
        settingsService.clearWorkspaceIdCache();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    it('propagates commentReplyMode change to workspace JSONB via workspaceSettingsService', async () => {
        // Mock: getSettings returns existing settings
        vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

        // Mock: select membership returns one workspace
        const membershipQuery = buildMembershipQuery('ws1');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.select).mockReturnValue({ from: membershipQuery.from } as any);

        // Mock: update returns the new settings
        const updatedSettings = { ...baseSettings, commentReplyMode: 'dual' as const };
        const updateChain = buildSettingsUpdateChain(updatedSettings);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.update).mockReturnValue({ set: updateChain.set } as any);

        await settingsService.updateSettings('u1', { commentReplyMode: 'dual' });

        expect(vi.mocked(workspaceSettingsService.updateSettings)).toHaveBeenCalledWith(
            'ws1',
            expect.objectContaining({ commentReplyMode: 'dual' }),
        );
    });

    /**
     * D-087: the write goes where the CALLER says, not where an unordered
     * `limit(1)` over `workspace_members` happens to point.
     *
     * Before this, a multi-membership user's tone, persona, away and greeting
     * text synced to whichever membership row came back first — unrelated to the
     * workspace they were looking at. D-085 guarded only `replyMode`, and only
     * when the client's diff happened to include it. 3 of 85 prod users hold two
     * memberships (2026-08-20), so this was live, silent, and cross-tenant.
     */
    it('syncs to the workspace the CALLER passed, not the membership lookup', async () => {
        vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);
        // The resolver would pick 'ws1' — the caller says 'ws-explicit'.
        const membershipQuery = buildMembershipQuery('ws1');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.select).mockReturnValue({ from: membershipQuery.from } as any);
        const updateChain = buildSettingsUpdateChain({ ...baseSettings, replyStyle: 'casual' as const });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.update).mockReturnValue({ set: updateChain.set } as any);

        await settingsService.updateSettings('u1', { replyStyle: 'casual' }, 'ws-explicit');

        expect(vi.mocked(workspaceSettingsService.updateSettings)).toHaveBeenCalledWith(
            'ws-explicit',
            expect.objectContaining({ replyStyle: 'casual' }),
        );
        expect(vi.mocked(workspaceSettingsService.updateSettings)).not.toHaveBeenCalledWith(
            'ws1', expect.anything(),
        );
    });

    // The fallback exists for callers with no request (scripts, tests). Removing
    // it would break them; relying on it from a request is the defect above.
    it('falls back to the membership lookup when no caller workspace is given', async () => {
        vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);
        const membershipQuery = buildMembershipQuery('ws1');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.select).mockReturnValue({ from: membershipQuery.from } as any);
        const updateChain = buildSettingsUpdateChain({ ...baseSettings, replyStyle: 'casual' as const });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.update).mockReturnValue({ set: updateChain.set } as any);

        await settingsService.updateSettings('u1', { replyStyle: 'casual' });

        expect(vi.mocked(workspaceSettingsService.updateSettings)).toHaveBeenCalledWith(
            'ws1', expect.objectContaining({ replyStyle: 'casual' }),
        );
    });

    it('skips workspace sync when no pipeline fields are in the update', async () => {
        // Mock: getSettings returns existing settings
        vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

        // Mock: update returns the updated settings
        const updatedSettings = { ...baseSettings, dashboardLanguage: 'en' };
        const updateChain = buildSettingsUpdateChain(updatedSettings);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.update).mockReturnValue({ set: updateChain.set } as any);

        await settingsService.updateSettings('u1', { dashboardLanguage: 'en' });

        // dashboardLanguage is NOT a pipeline field, so workspace sync should be skipped
        expect(vi.mocked(workspaceSettingsService.updateSettings)).not.toHaveBeenCalled();
    });

    it('skips workspace sync gracefully when user has no membership (does not throw)', async () => {
        // Mock: getSettings returns existing settings
        vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

        // Mock: select membership returns empty (no workspace)
        const membershipQuery = buildMembershipQuery(null);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.select).mockReturnValue({ from: membershipQuery.from } as any);

        // Mock: update returns the new settings
        const updatedSettings = { ...baseSettings, commentReplyMode: 'dual' as const };
        const updateChain = buildSettingsUpdateChain(updatedSettings);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.update).mockReturnValue({ set: updateChain.set } as any);

        // Should not throw even though no workspace is found
        await expect(settingsService.updateSettings('u1', { commentReplyMode: 'dual' })).resolves.toBeDefined();

        expect(vi.mocked(workspaceSettingsService.updateSettings)).not.toHaveBeenCalled();
    });

    it('syncs multiple pipeline fields in one call', async () => {
        // Mock: getSettings returns existing settings
        vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

        // Mock: select membership returns one workspace
        const membershipQuery = buildMembershipQuery('ws1');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.select).mockReturnValue({ from: membershipQuery.from } as any);

        // Mock: update returns the new settings
        const updatedSettings = {
            ...baseSettings,
            commentReplyMode: 'dual' as const,
            dualReplyNudge: 'Just to let you know...',
            aiEnabled: false,
        };
        const updateChain = buildSettingsUpdateChain(updatedSettings);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.update).mockReturnValue({ set: updateChain.set } as any);

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
        // Mock: getSettings returns existing settings
        vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

        // Mock: select membership returns one workspace
        const membershipQuery = buildMembershipQuery('ws1');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.select).mockReturnValue({ from: membershipQuery.from } as any);

        // Mock: update returns the new settings
        const updatedSettings = { ...baseSettings, commentReplyMode: 'private' as const };
        const updateChain = buildSettingsUpdateChain(updatedSettings);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.update).mockReturnValue({ set: updateChain.set } as any);

        await settingsService.updateSettings('u1', { commentReplyMode: 'private' });

        // The call should have exactly the update payload (no extraneous fields like dashboardLanguage)
        const calls = vi.mocked(workspaceSettingsService.updateSettings).mock.calls;
        expect(calls.length).toBe(1);
        const [wsId, updates] = calls[0];
        expect(wsId).toBe('ws1');
        expect(Object.keys(updates)).toEqual(['commentReplyMode']);
    });

    it('invalidates the Redis cache after settings update', async () => {
        // Mock: getSettings returns existing settings
        vi.mocked(db.query.settings.findFirst).mockResolvedValue(baseSettings);

        // Mock: select membership returns one workspace
        const membershipQuery = buildMembershipQuery('ws1');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.select).mockReturnValue({ from: membershipQuery.from } as any);

        // Mock: update returns the new settings
        const updatedSettings = { ...baseSettings, commentReplyMode: 'dual' as const };
        const updateChain = buildSettingsUpdateChain(updatedSettings);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(db.update).mockReturnValue({ set: updateChain.set } as any);

        await settingsService.updateSettings('u1', { commentReplyMode: 'dual' });

        expect(vi.mocked(redis.del)).toHaveBeenCalledWith('settings:v1:u1');
    });
});
