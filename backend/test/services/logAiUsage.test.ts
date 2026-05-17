/**
 * Unit tests for logAiUsage — the single writer to ai_usage_log.
 *
 * Critical invariants:
 *   1. Every row records the exact pipeline tag passed in (no NULL, no defaults).
 *   2. costUsd is computed from the pricing table for the model.
 *   3. Embedding rows pass tokensOut=0 and still log a non-zero cost.
 *   4. DB failures never throw — they increment a Redis drop counter and
 *      capture the exception to Sentry instead.
 *   5. Successful inserts fire recordAiLogged so the Phase 6.5 P1
 *      `metrics:ai:logged:*` counters reflect actual DB writes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted so the vi.mock factories below (which run before imports) can see them.
const { valuesMock, insertMock, redisIncrMock, sentryCaptureExceptionMock, recordAiLoggedMock } = vi.hoisted(() => {
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
    const redisIncrMock = vi.fn().mockResolvedValue(1);
    const sentryCaptureExceptionMock = vi.fn();
    const recordAiLoggedMock = vi.fn();
    return { valuesMock, insertMock, redisIncrMock, sentryCaptureExceptionMock, recordAiLoggedMock };
});

vi.mock('../../src/db', () => ({ db: { insert: insertMock } }));
vi.mock('../../src/db/schema', () => ({ aiCache: {}, aiUsageLog: {}, semanticCache: {} }));
vi.mock('../../src/lib/redis', () => ({
    redis: { incr: redisIncrMock, get: vi.fn(), set: vi.fn() },
    redisScanDelete: vi.fn(),
}));
vi.mock('@sentry/node', async () => {
    const actual = await vi.importActual<typeof import('@sentry/node')>('@sentry/node');
    return { ...actual, captureException: sentryCaptureExceptionMock };
});
vi.mock('../../src/lib/aiMetrics', () => ({
    recordAiLogged: recordAiLoggedMock,
    recordAiAttempt: vi.fn(),
    recordAiReturn: vi.fn(),
    recordAiFailedBeforeLog: vi.fn(),
}));

import { logAiUsage } from '../../src/services/ai';

beforeEach(() => {
    valuesMock.mockClear();
    insertMock.mockClear();
    redisIncrMock.mockClear();
    sentryCaptureExceptionMock.mockClear();
    recordAiLoggedMock.mockClear();
    valuesMock.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('logAiUsage', () => {
    it('writes the exact pipeline tag — no NULL, no default substitution', async () => {
        await logAiUsage({
            userId: 'user-1',
            pageId: 'page-1',
            model: 'gpt-4.1-mini',
            tokensIn: 1000,
            tokensOut: 200,
            cached: false,
            pipeline: 'comment_reply',
        });

        expect(valuesMock).toHaveBeenCalledTimes(1);
        const row = valuesMock.mock.calls[0]![0]!;
        expect(row.pipeline).toBe('comment_reply');
    });

    it('computes cost for chat completion via the pricing table', async () => {
        // gpt-4.1-mini: $0.0004 in/1K + $0.0016 out/1K. 1000/200 → 0.0004 + 0.00032 = 0.00072
        await logAiUsage({
            userId: 'u', model: 'gpt-4.1-mini', tokensIn: 1000, tokensOut: 200,
            cached: false, pipeline: 'dm_reply',
        });
        const row = valuesMock.mock.calls[0]![0]!;
        expect(row.costUsd).toBeCloseTo(0.00072, 6);
    });

    it('logs embedding rows with tokensOut=0 and a non-zero cost', async () => {
        // text-embedding-3-small: $0.00002/1K input, $0/1K output. 5000 in → $0.0001
        await logAiUsage({
            userId: 'u', model: 'text-embedding-3-small', tokensIn: 5000, tokensOut: 0,
            cached: false, pipeline: 'embedding_rag',
        });
        const row = valuesMock.mock.calls[0]![0]!;
        expect(row.tokensOut).toBe(0);
        expect(row.pipeline).toBe('embedding_rag');
        expect(row.costUsd).toBeCloseTo(0.0001, 6);
    });

    it('persists cachedInputTokens and discounts cost when prompt cache hits', async () => {
        // gpt-4.1-mini: 2000 in (1500 cached → 75% off, $0.0001/1K), 200 out
        // Fresh:  500/1000  * 0.0004  = 0.0002
        // Cached: 1500/1000 * 0.0001  = 0.00015
        // Output: 200/1000  * 0.0016  = 0.00032
        // Total                       = 0.00067
        await logAiUsage({
            userId: 'u', model: 'gpt-4.1-mini',
            tokensIn: 2000, cachedInputTokens: 1500, tokensOut: 200,
            cached: false, pipeline: 'dm_reply',
        });
        const row = valuesMock.mock.calls[0]![0]!;
        expect(row.cachedInputTokens).toBe(1500);
        expect(row.costUsd).toBeCloseTo(0.00067, 6);
        expect(row.pricingVersion).toBe('v2');
    });

    it('defaults cachedInputTokens to 0 when caller omits it (back-compat)', async () => {
        await logAiUsage({
            userId: 'u', model: 'gpt-4.1-mini', tokensIn: 1000, tokensOut: 200,
            cached: false, pipeline: 'comment_reply',
        });
        const row = valuesMock.mock.calls[0]![0]!;
        expect(row.cachedInputTokens).toBe(0);
        // Same as the original chat-completion test
        expect(row.costUsd).toBeCloseTo(0.00072, 6);
    });

    it('records cache hits as zero-token zero-cost rows', async () => {
        await logAiUsage({
            userId: 'u', model: 'gpt-4.1-mini', tokensIn: 0, tokensOut: 0,
            cached: true, pipeline: 'comment_reply',
        });
        const row = valuesMock.mock.calls[0]![0]!;
        expect(row.cached).toBe(true);
        expect(row.tokensIn).toBe(0);
        expect(row.tokensOut).toBe(0);
        expect(row.costUsd).toBe(0);
    });

    it('on DB failure: increments redis drop counter, captures exception to Sentry, never throws', async () => {
        const dbErr = new Error('column "pricing_version" of relation "ai_usage_log" does not exist');
        valuesMock.mockRejectedValueOnce(dbErr);

        await expect(logAiUsage({
            userId: 'u', model: 'gpt-4.1-mini', tokensIn: 100, tokensOut: 50,
            cached: false, pipeline: 'eval',
        })).resolves.toBeUndefined();

        expect(redisIncrMock).toHaveBeenCalledWith('metrics:pipeline:ai_usage_log.dropped');
        expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
        const [capturedErr, captureOpts] = sentryCaptureExceptionMock.mock.calls[0]!;
        expect(capturedErr).toBe(dbErr);
        expect(captureOpts).toMatchObject({
            level: 'warning',
            tags: { source: 'ai_usage_log' },
            extra: { pipeline: 'eval', model: 'gpt-4.1-mini' },
        });
    });

    it('on DB AND redis failure: silently discards, still does not throw', async () => {
        valuesMock.mockRejectedValueOnce(new Error('DB unavailable'));
        redisIncrMock.mockRejectedValueOnce(new Error('Redis unavailable'));

        await expect(logAiUsage({
            userId: 'u', model: 'gpt-4.1-mini', tokensIn: 100, tokensOut: 50,
            cached: false, pipeline: 'eval',
        })).resolves.toBeUndefined();

        expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    });

    it('fires recordAiLogged after a successful insert (Phase 6.5 P1 logged counter contract)', async () => {
        // Defensive against future regressions where someone reorders or
        // accidentally moves the recordAiLogged call outside the try block.
        // Prod symptom would be: metrics:ai:logged:* keys stop populating
        // while attempts/returns continue — same fail mode that PR #163's
        // diagnostic surface was built to detect.
        await logAiUsage({
            userId: 'u', model: 'gpt-4.1-mini', tokensIn: 100, tokensOut: 50,
            cached: false, pipeline: 'dm_reply',
        });

        expect(recordAiLoggedMock).toHaveBeenCalledTimes(1);
        expect(recordAiLoggedMock).toHaveBeenCalledWith('dm_reply', 'gpt-4.1-mini');
    });

    it('does NOT fire recordAiLogged when the insert throws', async () => {
        valuesMock.mockRejectedValueOnce(new Error('DB unavailable'));

        await logAiUsage({
            userId: 'u', model: 'gpt-4.1-mini', tokensIn: 100, tokensOut: 50,
            cached: false, pipeline: 'dm_reply',
        });

        expect(recordAiLoggedMock).not.toHaveBeenCalled();
    });

    it('every AiPipeline value produces a row with that pipeline tag', async () => {
        const tags = [
            'comment_reply', 'dm_reply', 'playground', 'eval',
            'embedding_rag', 'embedding_cache', 'translation', 'transcription',
            'lead_extraction', 'kb_file_extraction', 'ecommerce_tools', 'failover', 'unknown',
        ] as const;

        for (const pipeline of tags) {
            valuesMock.mockClear();
            await logAiUsage({
                userId: 'u', model: 'gpt-4.1-mini', tokensIn: 10, tokensOut: 5,
                cached: false, pipeline,
            });
            expect(valuesMock.mock.calls[0]![0]!.pipeline).toBe(pipeline);
        }
    });
});
