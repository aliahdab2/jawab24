import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        execute: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    comments: { postId: 'postId', replied: 'replied', needsAttention: 'needsAttention', replyMethod: 'replyMethod', aiIntent: 'aiIntent', detectedLanguage: 'detectedLanguage', flagReason: 'flagReason', createdTime: 'createdTime', repliedAt: 'repliedAt' },
    posts: { id: 'id', pageId: 'pageId' },
    instagramComments: { mediaId: 'mediaId', replied: 'replied', needsAttention: 'needsAttention', replyMethod: 'replyMethod', aiIntent: 'aiIntent', detectedLanguage: 'detectedLanguage', flagReason: 'flagReason', createdTime: 'createdTime', repliedAt: 'repliedAt' },
    instagramMedia: { id: 'id', pageId: 'pageId' },
    messages: { pageId: 'pageId', direction: 'direction', replied: 'replied', needsAttention: 'needsAttention', replyMethod: 'replyMethod', aiIntent: 'aiIntent', flagReason: 'flagReason', platform: 'platform', createdTime: 'createdTime', repliedAt: 'repliedAt' },
    pages: { id: 'id', userId: 'userId' },
    aiUsageLog: { userId: 'userId', createdAt: 'createdAt', model: 'model', tokensIn: 'tokensIn', tokensOut: 'tokensOut', costUsd: 'costUsd', cached: 'cached' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((...args: unknown[]) => args),
    and: vi.fn((...args: unknown[]) => args),
    gte: vi.fn((...args: unknown[]) => args),
    lt: vi.fn((...args: unknown[]) => args),
    isNotNull: vi.fn((...args: unknown[]) => args),
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

    /**
     * Setup DB mocks for getOverview.
     *
     * After the percentile_cont optimization, getOverview uses:
     *   - 3x db.select() for grouped rows (fbComments, igComments, messages)
     *   - 1x db.execute() for response time percentiles (SQL CTE with percentile_cont)
     */
    function setupDbMock(
        fbRows: any[], igRows: any[], msgRows: any[],
        responseTimeResult: { avg: string | null; p50: string | null; p95: string | null } = { avg: null, p50: null, p95: null },
    ) {
        let callCount = 0;
        const mockFrom = vi.fn();
        const mockInnerJoin = vi.fn();
        const mockWhere = vi.fn();
        const mockGroupBy = vi.fn();

        const results = [fbRows, igRows, msgRows];

        mockGroupBy.mockImplementation(() => {
            const idx = callCount - 1;
            return Promise.resolve(results[idx] || []);
        });

        mockWhere.mockImplementation(() => {
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

        // Mock db.execute for the response time SQL CTE query
        vi.mocked((db as any).execute).mockResolvedValue([responseTimeResult]);
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

        it('should return response time percentiles from SQL', async () => {
            // After the percentile_cont optimization, response times come from
            // a single db.execute() SQL CTE — not from fetching all rows into JS.
            setupDbMock([], [], [], { avg: '5.5', p50: '5.5', p95: '9.6' });

            const result = await service.getOverview('user-1', 30);

            expect(result.responseTime.avgSeconds).toBe(5.5);
            expect(result.responseTime.p50Seconds).toBe(5.5);
            expect(result.responseTime.p95Seconds).toBe(9.6);
        });

        it('should return null response times when no data', async () => {
            setupDbMock([], [], [], { avg: null, p50: null, p95: null });

            const result = await service.getOverview('user-1', 30);

            expect(result.responseTime.avgSeconds).toBeNull();
            expect(result.responseTime.p50Seconds).toBeNull();
            expect(result.responseTime.p95Seconds).toBeNull();
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

    describe('getAiUsage', () => {
        // getAiUsage runs two parallel queries: one ends at .orderBy() (model+day),
        // the other ends at .groupBy() (intent). The mocked groupBy must be
        // thenable AND expose .orderBy so both code paths resolve.
        function setupAiUsageMock(rows: any[], intentRows: any[] = []) {
            const mockOrderBy = vi.fn().mockResolvedValue(rows);
            const mockGroupBy = vi.fn().mockImplementation(() => {
                const promise: any = Promise.resolve(intentRows);
                promise.orderBy = mockOrderBy;
                return promise;
            });
            const mockWhere = vi.fn().mockReturnValue({ groupBy: mockGroupBy });
            const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);
        }

        it('should return empty report when no data exists', async () => {
            setupAiUsageMock([]);

            const result = await service.getAiUsage('user-1', 30);

            expect(result.totals.calls).toBe(0);
            expect(result.totals.llmCalls).toBe(0);
            expect(result.totals.cacheHits).toBe(0);
            expect(result.totals.tokensIn).toBe(0);
            expect(result.totals.tokensOut).toBe(0);
            expect(result.totals.costUsd).toBe(0);
            expect(result.byModel).toEqual({});
            expect(result.byDay).toEqual([]);
            expect(result.period.days).toBe(30);
        });

        it('should aggregate totals across multiple rows', async () => {
            setupAiUsageMock([
                { model: 'gpt-4o-mini', day: '2026-02-15', calls: 100, llmCalls: 80, cacheHits: 20, tokensIn: 50000, tokensOut: 20000, costUsd: 0.019500 },
                { model: 'gpt-4o-mini', day: '2026-02-16', calls: 50, llmCalls: 40, cacheHits: 10, tokensIn: 25000, tokensOut: 10000, costUsd: 0.009750 },
            ]);

            const result = await service.getAiUsage('user-1', 30);

            expect(result.totals.calls).toBe(150);
            expect(result.totals.llmCalls).toBe(120);
            expect(result.totals.cacheHits).toBe(30);
            expect(result.totals.tokensIn).toBe(75000);
            expect(result.totals.tokensOut).toBe(30000);
        });

        it('should group by model correctly', async () => {
            setupAiUsageMock([
                { model: 'gpt-4o-mini', day: '2026-02-15', calls: 100, llmCalls: 80, cacheHits: 20, tokensIn: 50000, tokensOut: 20000, costUsd: 0.019500 },
                { model: 'gpt-4o', day: '2026-02-15', calls: 10, llmCalls: 10, cacheHits: 0, tokensIn: 5000, tokensOut: 2000, costUsd: 0.100000 },
                { model: 'gpt-4o-mini', day: '2026-02-16', calls: 50, llmCalls: 40, cacheHits: 10, tokensIn: 25000, tokensOut: 10000, costUsd: 0.009750 },
            ]);

            const result = await service.getAiUsage('user-1', 30);

            expect(result.byModel['gpt-4o-mini'].calls).toBe(150);
            expect(result.byModel['gpt-4o-mini'].llmCalls).toBe(120);
            expect(result.byModel['gpt-4o-mini'].cacheHits).toBe(30);
            expect(result.byModel['gpt-4o'].calls).toBe(10);
            expect(result.byModel['gpt-4o'].tokensIn).toBe(5000);
        });

        it('should group by day correctly and sort ascending', async () => {
            setupAiUsageMock([
                { model: 'gpt-4o-mini', day: '2026-02-15', calls: 100, llmCalls: 80, cacheHits: 20, tokensIn: 50000, tokensOut: 20000, costUsd: 0.01 },
                { model: 'gpt-4o-mini', day: '2026-02-16', calls: 50, llmCalls: 40, cacheHits: 10, tokensIn: 25000, tokensOut: 10000, costUsd: 0.005 },
            ]);

            const result = await service.getAiUsage('user-1', 30);

            expect(result.byDay).toHaveLength(2);
            expect(result.byDay[0].date).toBe('2026-02-15');
            expect(result.byDay[0].calls).toBe(100);
            expect(result.byDay[1].date).toBe('2026-02-16');
            expect(result.byDay[1].calls).toBe(50);
        });

        it('should merge multiple models on the same day in byDay', async () => {
            setupAiUsageMock([
                { model: 'gpt-4o-mini', day: '2026-02-15', calls: 100, llmCalls: 80, cacheHits: 20, tokensIn: 50000, tokensOut: 20000, costUsd: 0.01 },
                { model: 'gpt-4o', day: '2026-02-15', calls: 10, llmCalls: 10, cacheHits: 0, tokensIn: 5000, tokensOut: 2000, costUsd: 0.10 },
            ]);

            const result = await service.getAiUsage('user-1', 30);

            expect(result.byDay).toHaveLength(1);
            expect(result.byDay[0].date).toBe('2026-02-15');
            expect(result.byDay[0].calls).toBe(110);
            expect(result.byDay[0].tokensIn).toBe(55000);
        });

        it('should set correct period dates', async () => {
            setupAiUsageMock([]);

            const result = await service.getAiUsage('user-1', 7);

            expect(result.period.days).toBe(7);
            const from = new Date(result.period.from);
            const to = new Date(result.period.to);
            const diffDays = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
            expect(diffDays).toBe(7);
        });
    });
});
