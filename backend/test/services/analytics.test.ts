import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    comments: { postId: 'postId', replied: 'replied', needsAttention: 'needsAttention', replyMethod: 'replyMethod', aiIntent: 'aiIntent', detectedLanguage: 'detectedLanguage', flagReason: 'flagReason', createdTime: 'createdTime', repliedAt: 'repliedAt' },
    posts: { id: 'id', pageId: 'pageId' },
    instagramComments: { mediaId: 'mediaId', replied: 'replied', needsAttention: 'needsAttention', replyMethod: 'replyMethod', aiIntent: 'aiIntent', detectedLanguage: 'detectedLanguage', flagReason: 'flagReason', createdTime: 'createdTime', repliedAt: 'repliedAt' },
    instagramMedia: { id: 'id', pageId: 'pageId' },
    messages: { pageId: 'pageId', direction: 'direction', replied: 'replied', needsAttention: 'needsAttention', replyMethod: 'replyMethod', aiIntent: 'aiIntent', flagReason: 'flagReason', platform: 'platform', createdTime: 'createdTime', repliedAt: 'repliedAt' },
    pages: { id: 'id', userId: 'userId' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((...args: unknown[]) => args),
    and: vi.fn((...args: unknown[]) => args),
    gte: vi.fn((...args: unknown[]) => args),
    sql: vi.fn().mockReturnValue('sql-mock'),
}));

import { AnalyticsService } from '../../src/services/analytics';
import { db } from '../../src/db';

describe('AnalyticsService', () => {
    let service: AnalyticsService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AnalyticsService();
    });

    function setupDbMock(fbRows: any[], igRows: any[], msgRows: any[], fbTimes: any[] = [], igTimes: any[] = [], msgTimes: any[] = []) {
        let callCount = 0;
        const mockFrom = vi.fn();
        const mockInnerJoin = vi.fn();
        const mockWhere = vi.fn();
        const mockGroupBy = vi.fn();

        // Each call to db.select() triggers a new query chain
        // Order: fbComments, igComments, messages, fbTimes, igTimes, msgTimes
        const results = [fbRows, igRows, msgRows, fbTimes, igTimes, msgTimes];

        mockGroupBy.mockImplementation(() => {
            const idx = callCount - 1;
            return Promise.resolve(results[idx] || []);
        });

        mockWhere.mockImplementation(() => {
            const idx = callCount - 1;
            // Response time queries don't have groupBy — they resolve directly
            if (idx >= 3) {
                return Promise.resolve(results[idx] || []);
            }
            return { groupBy: mockGroupBy };
        });

        mockInnerJoin.mockImplementation(() => {
            return { innerJoin: mockInnerJoin, where: mockWhere };
        });

        mockFrom.mockImplementation(() => {
            return { innerJoin: mockInnerJoin, where: mockWhere };
        });

        vi.mocked(db.select).mockImplementation(() => {
            callCount++;
            return { from: mockFrom } as any;
        });
    }

    describe('getOverview', () => {
        it('should return all zeros when no data exists', async () => {
            setupDbMock([], [], []);

            const result = await service.getOverview('user-1', 30);

            expect(result.totals.comments).toBe(0);
            expect(result.totals.messages).toBe(0);
            expect(result.totals.replied).toBe(0);
            expect(result.totals.unreplied).toBe(0);
            expect(result.totals.replyRate).toBe('0.0');
            expect(result.totals.flagged).toBe(0);
            expect(result.byMethod).toEqual({});
            expect(result.byIntent).toEqual({});
            expect(result.responseTime.avgSeconds).toBeNull();
            expect(result.responseTime.p50Seconds).toBeNull();
            expect(result.responseTime.p95Seconds).toBeNull();
        });

        it('should aggregate method distribution across tables', async () => {
            const fbRows = [
                { count: 10, replied_count: 8, flagged_count: 1, reply_method: 'ai', ai_intent: 'QUESTION', detected_language: 'en', flag_reason: null },
                { count: 5, replied_count: 5, flagged_count: 0, reply_method: 'template', ai_intent: 'GREETING', detected_language: 'en', flag_reason: null },
            ];
            const igRows = [
                { count: 3, replied_count: 3, flagged_count: 0, reply_method: 'ai', ai_intent: 'COMPLIMENT', detected_language: 'ar', flag_reason: null },
            ];
            const msgRows = [
                { count: 4, replied_count: 4, flagged_count: 1, reply_method: 'ai', ai_intent: 'QUESTION', detected_language: null, flag_reason: 'angry_customer', platform: 'facebook' },
            ];

            setupDbMock(fbRows, igRows, msgRows);

            const result = await service.getOverview('user-1', 30);

            expect(result.totals.comments).toBe(18); // 10 + 5 + 3
            expect(result.totals.messages).toBe(4);
            expect(result.totals.replied).toBe(20); // 8 + 5 + 3 + 4
            expect(result.totals.flagged).toBe(2); // 1 + 0 + 1
            expect(result.byMethod.ai).toBe(15); // 8 + 3 + 4
            expect(result.byMethod.template).toBe(5);
        });

        it('should aggregate intent distribution', async () => {
            const fbRows = [
                { count: 10, replied_count: 8, flagged_count: 0, reply_method: 'ai', ai_intent: 'QUESTION', detected_language: 'en', flag_reason: null },
                { count: 5, replied_count: 5, flagged_count: 0, reply_method: 'ai', ai_intent: 'COMPLAINT', detected_language: 'en', flag_reason: null },
            ];
            const msgRows = [
                { count: 3, replied_count: 3, flagged_count: 0, reply_method: 'ai', ai_intent: 'QUESTION', detected_language: null, flag_reason: null, platform: 'facebook' },
            ];

            setupDbMock(fbRows, [], msgRows);

            const result = await service.getOverview('user-1', 30);

            expect(result.byIntent.QUESTION).toBe(13); // 10 + 3
            expect(result.byIntent.COMPLAINT).toBe(5);
        });

        it('should aggregate language distribution', async () => {
            const fbRows = [
                { count: 10, replied_count: 10, flagged_count: 0, reply_method: 'ai', ai_intent: null, detected_language: 'en', flag_reason: null },
                { count: 5, replied_count: 5, flagged_count: 0, reply_method: 'ai', ai_intent: null, detected_language: 'ar', flag_reason: null },
                { count: 2, replied_count: 2, flagged_count: 0, reply_method: 'ai', ai_intent: null, detected_language: null, flag_reason: null },
            ];

            setupDbMock(fbRows, [], []);

            const result = await service.getOverview('user-1', 30);

            expect(result.byLanguage.en).toBe(10);
            expect(result.byLanguage.ar).toBe(5);
            expect(result.byLanguage.unknown).toBe(2);
        });

        it('should parse comma-separated flag reasons', async () => {
            const fbRows = [
                { count: 3, replied_count: 3, flagged_count: 3, reply_method: 'ai', ai_intent: 'COMPLAINT', detected_language: 'en', flag_reason: 'angry_customer,price_not_in_kb' },
                { count: 2, replied_count: 2, flagged_count: 2, reply_method: 'ai', ai_intent: 'QUESTION', detected_language: 'en', flag_reason: 'low_confidence' },
            ];

            setupDbMock(fbRows, [], []);

            const result = await service.getOverview('user-1', 30);

            expect(result.flags.angry_customer).toBe(3);
            expect(result.flags.price_not_in_kb).toBe(3);
            expect(result.flags.low_confidence).toBe(2);
        });

        it('should compute response time percentiles', async () => {
            const times = [
                { seconds: 1 }, { seconds: 2 }, { seconds: 3 }, { seconds: 4 }, { seconds: 5 },
                { seconds: 6 }, { seconds: 7 }, { seconds: 8 }, { seconds: 9 }, { seconds: 10 },
            ];

            setupDbMock([], [], [], times, [], []);

            const result = await service.getOverview('user-1', 30);

            expect(result.responseTime.avgSeconds).toBe(5.5);
            expect(result.responseTime.p50Seconds).toBe(6);
            expect(result.responseTime.p95Seconds).toBe(10);
        });

        it('should set correct period dates', async () => {
            setupDbMock([], [], []);

            const result = await service.getOverview('user-1', 7);

            expect(result.period.days).toBe(7);
            const from = new Date(result.period.from);
            const to = new Date(result.period.to);
            const diffDays = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
            expect(diffDays).toBe(7);
        });

        it('should calculate reply rate correctly', async () => {
            const fbRows = [
                { count: 100, replied_count: 75, flagged_count: 0, reply_method: 'ai', ai_intent: null, detected_language: null, flag_reason: null },
            ];

            setupDbMock(fbRows, [], []);

            const result = await service.getOverview('user-1', 30);

            expect(result.totals.replyRate).toBe('75.0');
            expect(result.totals.unreplied).toBe(25);
        });

        it('should pass pageId to queries when provided', async () => {
            const fbRows = [
                { count: 10, replied_count: 10, flagged_count: 0, reply_method: 'ai', ai_intent: null, detected_language: 'en', flag_reason: null },
            ];

            setupDbMock(fbRows, [], []);

            const result = await service.getOverview('user-1', 30, 'page-uuid-123');

            // Verify the result still processes correctly with pageId
            expect(result.totals.comments).toBe(10);
            // db.select was called (6 times: 3 grouped + 3 response times)
            expect(db.select).toHaveBeenCalled();
        });

        it('should combine platform counts from comments and messages', async () => {
            const fbRows = [
                { count: 20, replied_count: 20, flagged_count: 0, reply_method: 'ai', ai_intent: null, detected_language: null, flag_reason: null },
            ];
            const igRows = [
                { count: 10, replied_count: 10, flagged_count: 0, reply_method: 'ai', ai_intent: null, detected_language: null, flag_reason: null },
            ];
            const msgRows = [
                { count: 5, replied_count: 5, flagged_count: 0, reply_method: 'ai', ai_intent: null, detected_language: null, flag_reason: null, platform: 'facebook' },
                { count: 3, replied_count: 3, flagged_count: 0, reply_method: 'ai', ai_intent: null, detected_language: null, flag_reason: null, platform: 'instagram' },
            ];

            setupDbMock(fbRows, igRows, msgRows);

            const result = await service.getOverview('user-1', 30);

            expect(result.byPlatform.facebook).toBe(25); // 20 FB comments + 5 FB messages
            expect(result.byPlatform.instagram).toBe(13); // 10 IG comments + 3 IG messages
        });
    });
});
