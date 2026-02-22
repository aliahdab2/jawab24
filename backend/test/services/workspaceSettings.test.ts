import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceSettingsService } from '../../src/services/workspaceSettings';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
    },
}));

import { db } from '../../src/db';
import { redis } from '../../src/lib/redis';

function mockDbSelect(result: unknown) {
    const chain: any = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(result),
    };
    vi.mocked(db.select).mockReturnValue(chain);
    return chain;
}

function mockDbUpdate() {
    const chain: any = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.update).mockReturnValue(chain);
    return chain;
}

const WS_ID = 'ws-test-123';

describe('WorkspaceSettingsService', () => {
    let service: WorkspaceSettingsService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new WorkspaceSettingsService();
    });

    // ── getSettings ───────────────────────────────────────────────────────
    describe('getSettings', () => {
        it('returns cached value from Redis without hitting DB', async () => {
            const cached = { aiEnabled: false, commentsAutoReply: false };
            vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(cached));

            const result = await service.getSettings(WS_ID);

            expect(result.aiEnabled).toBe(false);
            expect(db.select).not.toHaveBeenCalled();
        });

        it('fetches from DB when cache is empty and merges with defaults', async () => {
            vi.mocked(redis.get).mockResolvedValueOnce(null);
            mockDbSelect([{ settings: { aiEnabled: false } }]);

            const result = await service.getSettings(WS_ID);

            expect(result.aiEnabled).toBe(false);
            // Defaults still applied for unset fields
            expect(result.commentsAutoReply).toBe(true);
            expect(result.replyDelay).toBe(0);
        });

        it('returns full defaults when workspace not found in DB', async () => {
            vi.mocked(redis.get).mockResolvedValueOnce(null);
            mockDbSelect([]);

            const result = await service.getSettings(WS_ID);

            expect(result.aiEnabled).toBe(true);
            expect(result.commentsAutoReply).toBe(true);
            expect(result.messagesAutoReply).toBe(true);
            expect(result.defaultReplyLanguage).toBe('ar');
        });

        it('falls through to DB when Redis throws', async () => {
            vi.mocked(redis.get).mockRejectedValueOnce(new Error('Redis down'));
            mockDbSelect([{ settings: { replyDelay: 5 } }]);

            const result = await service.getSettings(WS_ID);

            expect(result.replyDelay).toBe(5);
        });

        it('populates cache after DB fetch', async () => {
            vi.mocked(redis.get).mockResolvedValueOnce(null);
            mockDbSelect([{ settings: {} }]);

            await service.getSettings(WS_ID);

            expect(redis.set).toHaveBeenCalledWith(
                expect.stringContaining(WS_ID),
                expect.any(String),
                'EX',
                300,
            );
        });
    });

    // ── updateSettings ────────────────────────────────────────────────────
    describe('updateSettings', () => {
        it('merges updates with existing settings and invalidates cache', async () => {
            // First call is getSettings (inside updateSettings)
            vi.mocked(redis.get).mockResolvedValueOnce(null);
            mockDbSelect([{ settings: { aiEnabled: true, replyDelay: 0 } }]);
            mockDbUpdate();

            const result = await service.updateSettings(WS_ID, { replyDelay: 10 });

            expect(result.replyDelay).toBe(10);
            expect(result.aiEnabled).toBe(true); // Existing value preserved
            expect(redis.del).toHaveBeenCalledWith(expect.stringContaining(WS_ID));
        });
    });

    // ── isCommentsAutoReplyEnabled ────────────────────────────────────────
    describe('isCommentsAutoReplyEnabled', () => {
        it('returns false when commentsAutoReply is off', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue({
                commentsAutoReply: false,
                businessHoursOnly: false,
            } as any);

            expect(await service.isCommentsAutoReplyEnabled(WS_ID)).toBe(false);
        });

        it('returns true when commentsAutoReply is on and no business hours restriction', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue({
                commentsAutoReply: true,
                businessHoursOnly: false,
            } as any);

            expect(await service.isCommentsAutoReplyEnabled(WS_ID)).toBe(true);
        });

        it('delegates to business hours check when businessHoursOnly is true', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue({
                commentsAutoReply: true,
                businessHoursOnly: true,
                businessHoursStart: '00:00',
                businessHoursEnd: '23:59',
                timezone: 'UTC',
            } as any);

            // 00:00–23:59 UTC covers all times
            expect(await service.isCommentsAutoReplyEnabled(WS_ID)).toBe(true);
        });
    });

    // ── isMessagesAutoReplyEnabled ────────────────────────────────────────
    describe('isMessagesAutoReplyEnabled', () => {
        it('returns false when messagesAutoReply is off', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue({
                messagesAutoReply: false,
                businessHoursOnly: false,
            } as any);

            expect(await service.isMessagesAutoReplyEnabled(WS_ID)).toBe(false);
        });

        it('returns true when messagesAutoReply is on', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue({
                messagesAutoReply: true,
                businessHoursOnly: false,
            } as any);

            expect(await service.isMessagesAutoReplyEnabled(WS_ID)).toBe(true);
        });
    });

    // ── getAwayMessage ────────────────────────────────────────────────────
    describe('getAwayMessage', () => {
        it('returns configured away message for detected language', async () => {
            // defaultReplyLanguage:'en' so resolveLanguage('en') → 'en', resolveLanguage('ar') → 'ar'
            vi.spyOn(service, 'getSettings').mockResolvedValue({
                awayMessageMulti: { en: 'We are away', ar: 'نحن غائبون' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            } as any);

            expect(await service.getAwayMessage(WS_ID, 'en')).toBe('We are away');
            expect(await service.getAwayMessage(WS_ID, 'ar')).toBe('نحن غائبون');
        });

        it('falls back to other language when preferred is missing', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue({
                awayMessageMulti: { en: 'We are away' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'ar',
            } as any);

            // Arabic requested but only English configured — returns English
            expect(await service.getAwayMessage(WS_ID, 'ar')).toBe('We are away');
        });

        it('returns default away message when none configured', async () => {
            // defaultReplyLanguage:'en' so resolveLanguage('en') → 'en' → DEFAULT_AWAY_MESSAGE['en']
            vi.spyOn(service, 'getSettings').mockResolvedValue({
                awayMessageMulti: {},
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            } as any);

            const msg = await service.getAwayMessage(WS_ID, 'en');
            expect(msg).toContain('away');
        });
    });

    // ── getGreetingMessage ────────────────────────────────────────────────
    describe('getGreetingMessage', () => {
        it('returns greeting for detected language', async () => {
            // defaultReplyLanguage:'en' so resolveLanguage('en') → 'en'
            vi.spyOn(service, 'getSettings').mockResolvedValue({
                greetingMessageMulti: { en: 'Welcome!', ar: 'مرحباً!' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            } as any);

            expect(await service.getGreetingMessage(WS_ID, 'en')).toBe('Welcome!');
        });

        it('returns null when no greeting configured', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue({
                greetingMessageMulti: {},
                autoDetectLanguage: true,
                defaultReplyLanguage: 'ar',
            } as any);

            expect(await service.getGreetingMessage(WS_ID, 'en')).toBeNull();
        });
    });

    // ── getReplyDelay ─────────────────────────────────────────────────────
    describe('getReplyDelay', () => {
        it('returns configured delay in seconds', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue({ replyDelay: 3 } as any);
            expect(await service.getReplyDelay(WS_ID)).toBe(3);
        });
    });

    // ── language resolution ───────────────────────────────────────────────
    describe('language resolution', () => {
        it('uses default language when autoDetect is off', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue({
                greetingMessageMulti: { en: 'Hi', ar: 'مرحباً' },
                autoDetectLanguage: false,
                defaultReplyLanguage: 'en',
            } as any);

            // Even if customer wrote in Arabic, we use the default (en)
            expect(await service.getGreetingMessage(WS_ID, 'ar')).toBe('Hi');
        });

        it('uses detected language when autoDetect is on', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue({
                greetingMessageMulti: { en: 'Hi', ar: 'مرحباً' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            } as any);

            expect(await service.getGreetingMessage(WS_ID, 'ar')).toBe('مرحباً');
        });

        it('falls back to default when detected language is "unknown"', async () => {
            vi.spyOn(service, 'getSettings').mockResolvedValue({
                greetingMessageMulti: { en: 'Hi', ar: 'مرحباً' },
                autoDetectLanguage: true,
                defaultReplyLanguage: 'en',
            } as any);

            expect(await service.getGreetingMessage(WS_ID, 'unknown')).toBe('Hi');
        });
    });
});
