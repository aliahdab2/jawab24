import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAiMetrics, withAiMetrics, type AiMetricsRedis } from '@jawab24/shared';

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

    it('supports AiWorkerUnreachable for backend ↔ ai-worker hop failures', () => {
        metrics.recordAiFailedBeforeLog('dm_reply', 'gpt-4.1-mini', 'AiWorkerUnreachable');
        expect(incr).toHaveBeenCalledExactlyOnceWith(
            'metrics:ai:failed_before_log:dm_reply:gpt-4.1-mini:AiWorkerUnreachable',
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

describe('withAiMetrics', () => {
    let incr: ReturnType<typeof vi.fn>;
    let metrics: ReturnType<typeof createAiMetrics>;

    beforeEach(() => {
        incr = vi.fn().mockResolvedValue(1);
        metrics = createAiMetrics({ incr });
    });

    it('emits attempts before fn runs and returns after fn resolves', async () => {
        const order: string[] = [];
        incr.mockImplementation((key: string) => {
            order.push(key);
            return Promise.resolve(1);
        });
        const result = await withAiMetrics(metrics, 'dm_reply', 'gpt-4.1-mini', async () => {
            order.push('fn');
            return 'ok';
        });
        expect(result).toBe('ok');
        expect(order).toEqual([
            'metrics:ai:attempts:dm_reply:gpt-4.1-mini',
            'fn',
            'metrics:ai:returns:dm_reply:gpt-4.1-mini',
        ]);
    });

    it('emits failed_before_log with default OpenAIApiError when fn throws', async () => {
        const err = new Error('boom');
        await expect(
            withAiMetrics(metrics, 'lead_extraction', 'gpt-4.1-mini', async () => { throw err; }),
        ).rejects.toBe(err);
        expect(incr).toHaveBeenCalledWith('metrics:ai:attempts:lead_extraction:gpt-4.1-mini');
        expect(incr).toHaveBeenCalledWith('metrics:ai:failed_before_log:lead_extraction:gpt-4.1-mini:OpenAIApiError');
        expect(incr).not.toHaveBeenCalledWith('metrics:ai:returns:lead_extraction:gpt-4.1-mini');
    });

    it('honors a custom errorClassifier', async () => {
        const abort = Object.assign(new Error('timeout'), { name: 'APIUserAbortError' });
        await expect(
            withAiMetrics(
                metrics,
                'dm_reply',
                'gpt-4.1-mini',
                async () => { throw abort; },
                (e) => (e instanceof Error && e.name === 'APIUserAbortError' ? 'AiTimeoutError' : 'OpenAIApiError'),
            ),
        ).rejects.toBe(abort);
        expect(incr).toHaveBeenCalledWith('metrics:ai:failed_before_log:dm_reply:gpt-4.1-mini:AiTimeoutError');
    });

    it('returns the wrapped value unchanged (preserves identity)', async () => {
        const obj = { id: 42, payload: [1, 2, 3] };
        const got = await withAiMetrics(metrics, 'dm_reply', 'gpt-4.1-mini', async () => obj);
        expect(got).toBe(obj);
    });

    it('falls back to pipeline=unknown when caller passes undefined', async () => {
        await withAiMetrics(metrics, undefined, 'gpt-4.1-mini', async () => 1);
        expect(incr).toHaveBeenCalledWith('metrics:ai:attempts:unknown:gpt-4.1-mini');
        expect(incr).toHaveBeenCalledWith('metrics:ai:returns:unknown:gpt-4.1-mini');
    });

    it('still rethrows even when the redis fake itself throws on emit', async () => {
        incr.mockImplementation(() => { throw new Error('redis down'); });
        const err = new Error('fn boom');
        // The metrics layer must swallow its own errors but the fn's error
        // must still propagate.
        await expect(
            withAiMetrics(metrics, 'dm_reply', 'gpt-4.1-mini', async () => { throw err; }),
        ).rejects.toBe(err);
    });
});
