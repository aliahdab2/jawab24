import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAiMetrics, type AiMetricsRedis } from '@jawab24/shared';

// The shared factory is pure — inject a fake redis directly. No vi.mock of
// '../../src/lib/redis' needed; this is the test that proves the DI surface
// works (and that the backend wrapper at backend/src/lib/aiMetrics.ts can
// safely re-export bindings).

describe('createAiMetrics (shared factory)', () => {
    let incr: ReturnType<typeof vi.fn>;
    let redis: AiMetricsRedis;
    let metrics: ReturnType<typeof createAiMetrics>;

    beforeEach(() => {
        incr = vi.fn().mockResolvedValue(1);
        redis = { incr };
        metrics = createAiMetrics(redis);
    });

    it('recordAiAttempt builds the attempts key with pipeline + model', () => {
        metrics.recordAiAttempt('dm_reply', 'gpt-4.1-mini');
        expect(incr).toHaveBeenCalledExactlyOnceWith('metrics:ai:attempts:dm_reply:gpt-4.1-mini');
    });

    it('recordAiReturn builds the returns key', () => {
        metrics.recordAiReturn('comment_reply', 'gpt-4.1-mini');
        expect(incr).toHaveBeenCalledExactlyOnceWith('metrics:ai:returns:comment_reply:gpt-4.1-mini');
    });

    it('recordAiLogged builds the logged key', () => {
        metrics.recordAiLogged('translation', 'gpt-4.1-mini');
        expect(incr).toHaveBeenCalledExactlyOnceWith('metrics:ai:logged:translation:gpt-4.1-mini');
    });

    it('recordAiFailedBeforeLog appends error_class as a fourth segment', () => {
        metrics.recordAiFailedBeforeLog('ecommerce_tools', 'gpt-4.1-mini', 'ZeroTokens');
        expect(incr).toHaveBeenCalledExactlyOnceWith(
            'metrics:ai:failed_before_log:ecommerce_tools:gpt-4.1-mini:ZeroTokens',
        );
    });

    it('falls back to "unknown" when pipeline is undefined', () => {
        metrics.recordAiAttempt(undefined, 'gpt-4.1-mini');
        expect(incr).toHaveBeenCalledExactlyOnceWith('metrics:ai:attempts:unknown:gpt-4.1-mini');
    });

    it('swallows Redis errors silently (must never block AI calls)', async () => {
        incr.mockRejectedValueOnce(new Error('Redis down'));
        // No try/catch at the call site — must not throw.
        expect(() => metrics.recordAiAttempt('dm_reply', 'gpt-4.1-mini')).not.toThrow();
        // Give the rejected promise a tick to settle without unhandled-rejection noise.
        await new Promise((r) => setImmediate(r));
        expect(incr).toHaveBeenCalledTimes(1);
    });

    it('is fire-and-forget — does not await Redis (returns void synchronously)', () => {
        // Slow Redis: never resolves. The function must still return without blocking.
        incr.mockReturnValueOnce(new Promise(() => { /* never */ }));
        const result = metrics.recordAiReturn('dm_reply', 'gpt-4.1-mini');
        expect(result).toBeUndefined();
        expect(incr).toHaveBeenCalledTimes(1);
    });

    it('survives a redis fake that throws synchronously', () => {
        incr.mockImplementationOnce(() => { throw new Error('client not configured'); });
        expect(() => metrics.recordAiAttempt('dm_reply', 'gpt-4.1-mini')).not.toThrow();
        expect(incr).toHaveBeenCalledTimes(1);
    });

    it('survives a redis fake that returns a non-thenable', () => {
        incr.mockReturnValueOnce(42 as unknown as Promise<number>);
        expect(() => metrics.recordAiAttempt('dm_reply', 'gpt-4.1-mini')).not.toThrow();
        expect(incr).toHaveBeenCalledTimes(1);
    });
});
