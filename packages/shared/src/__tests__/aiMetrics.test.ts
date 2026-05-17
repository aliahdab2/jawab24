import { describe, it, expect, vi } from 'vitest';
import {
    createAiMetrics,
    normalizeModelTag,
    withAiMetrics,
    type AiMetricsRedis,
} from '../aiMetrics';

function fakeRedis(): { incr: ReturnType<typeof vi.fn>; client: AiMetricsRedis } {
    const incr = vi.fn().mockResolvedValue(1);
    return { incr, client: { incr } };
}

describe('normalizeModelTag', () => {
    it('strips a trailing dated snapshot suffix', () => {
        expect(normalizeModelTag('gpt-4.1-mini-2025-04-14')).toBe('gpt-4.1-mini');
        expect(normalizeModelTag('gpt-4o-mini-2024-07-18')).toBe('gpt-4o-mini');
    });

    it('passes through models that already use the rolling alias', () => {
        expect(normalizeModelTag('gpt-4.1-mini')).toBe('gpt-4.1-mini');
        expect(normalizeModelTag('gpt-4o-mini')).toBe('gpt-4o-mini');
    });

    it('does not strip non-date trailing segments', () => {
        // gpt-4o-mini-transcribe ends in a word, not a YYYY-MM-DD.
        expect(normalizeModelTag('gpt-4o-mini-transcribe')).toBe('gpt-4o-mini-transcribe');
        expect(normalizeModelTag('text-embedding-3-small')).toBe('text-embedding-3-small');
    });
});

describe('createAiMetrics — key shape', () => {
    it('emits the documented key shape per stage', () => {
        const { incr, client } = fakeRedis();
        const m = createAiMetrics(client);

        m.recordAiAttempt('dm_reply', 'gpt-4.1-mini');
        m.recordAiReturn('dm_reply', 'gpt-4.1-mini');
        m.recordAiLogged('dm_reply', 'gpt-4.1-mini');
        m.recordAiFailedBeforeLog('dm_reply', 'gpt-4.1-mini', 'AiRefusalError');

        expect(incr).toHaveBeenNthCalledWith(1, 'metrics:ai:attempts:dm_reply:gpt-4.1-mini');
        expect(incr).toHaveBeenNthCalledWith(2, 'metrics:ai:returns:dm_reply:gpt-4.1-mini');
        expect(incr).toHaveBeenNthCalledWith(3, 'metrics:ai:logged:dm_reply:gpt-4.1-mini');
        expect(incr).toHaveBeenNthCalledWith(4, 'metrics:ai:failed_before_log:dm_reply:gpt-4.1-mini:AiRefusalError');
    });

    it('normalizes the model before emitting (same logical call → same key)', () => {
        const { incr, client } = fakeRedis();
        const m = createAiMetrics(client);

        // Call site A resolves the rolling alias; call site B sees the dated
        // snapshot from `completion.model`. Without normalization these would
        // land under different keys and break gap analysis.
        m.recordAiAttempt('translation', 'gpt-4.1-mini');
        m.recordAiReturn('translation', 'gpt-4.1-mini-2025-04-14');

        expect(incr).toHaveBeenNthCalledWith(1, 'metrics:ai:attempts:translation:gpt-4.1-mini');
        expect(incr).toHaveBeenNthCalledWith(2, 'metrics:ai:returns:translation:gpt-4.1-mini');
    });

    it('falls back to `unknown` when pipeline is undefined', () => {
        const { incr, client } = fakeRedis();
        const m = createAiMetrics(client);

        m.recordAiAttempt(undefined, 'gpt-4.1-mini');

        expect(incr).toHaveBeenCalledWith('metrics:ai:attempts:unknown:gpt-4.1-mini');
    });

    it('swallows synchronous incr throws so it never blocks the AI pipeline', () => {
        const client: AiMetricsRedis = {
            incr: () => { throw new Error('redis down'); },
        };
        const m = createAiMetrics(client);

        expect(() => m.recordAiAttempt('dm_reply', 'gpt-4.1-mini')).not.toThrow();
    });
});

describe('createAiMetrics — onMissingPipeline diagnostic hook', () => {
    it('fires the hook with stage + normalized model when pipeline is undefined', () => {
        const { client } = fakeRedis();
        const onMissingPipeline = vi.fn();
        const m = createAiMetrics(client, { onMissingPipeline });

        m.recordAiAttempt(undefined, 'gpt-4.1-mini-2025-04-14');

        expect(onMissingPipeline).toHaveBeenCalledTimes(1);
        // Model passed to the hook is normalized — consistent with the emitted key.
        expect(onMissingPipeline).toHaveBeenCalledWith('attempts', 'gpt-4.1-mini');
    });

    it('does NOT fire the hook when pipeline is set', () => {
        const { client } = fakeRedis();
        const onMissingPipeline = vi.fn();
        const m = createAiMetrics(client, { onMissingPipeline });

        m.recordAiAttempt('dm_reply', 'gpt-4.1-mini');
        m.recordAiReturn('dm_reply', 'gpt-4.1-mini');

        expect(onMissingPipeline).not.toHaveBeenCalled();
    });

    it('fires once per stage', () => {
        const { client } = fakeRedis();
        const onMissingPipeline = vi.fn();
        const m = createAiMetrics(client, { onMissingPipeline });

        m.recordAiAttempt(undefined, 'gpt-4.1-mini');
        m.recordAiReturn(undefined, 'gpt-4.1-mini');
        m.recordAiLogged(undefined, 'gpt-4.1-mini');
        m.recordAiFailedBeforeLog(undefined, 'gpt-4.1-mini', 'Other');

        // No internal dedupe — the host (backend/ai-worker wrappers) owns rate-limiting.
        expect(onMissingPipeline).toHaveBeenCalledTimes(4);
        expect(onMissingPipeline.mock.calls.map((c) => c[0])).toEqual([
            'attempts', 'returns', 'logged', 'failed_before_log',
        ]);
    });

    it('does not break the emit if the hook itself throws', () => {
        const { incr, client } = fakeRedis();
        const m = createAiMetrics(client, {
            onMissingPipeline: () => { throw new Error('sentry sdk failed'); },
        });

        expect(() => m.recordAiAttempt(undefined, 'gpt-4.1-mini')).not.toThrow();
        expect(incr).toHaveBeenCalledWith('metrics:ai:attempts:unknown:gpt-4.1-mini');
    });
});

describe('withAiMetrics — wrapper contract', () => {
    it('emits attempts then returns on success', async () => {
        const { incr, client } = fakeRedis();
        const m = createAiMetrics(client);

        await withAiMetrics(m, 'dm_reply', 'gpt-4.1-mini', async () => 'ok');

        expect(incr).toHaveBeenNthCalledWith(1, 'metrics:ai:attempts:dm_reply:gpt-4.1-mini');
        expect(incr).toHaveBeenNthCalledWith(2, 'metrics:ai:returns:dm_reply:gpt-4.1-mini');
    });

    it('emits attempts then failed_before_log on throw, and re-throws', async () => {
        const { incr, client } = fakeRedis();
        const m = createAiMetrics(client);

        await expect(
            withAiMetrics(m, 'dm_reply', 'gpt-4.1-mini', async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');

        expect(incr).toHaveBeenNthCalledWith(1, 'metrics:ai:attempts:dm_reply:gpt-4.1-mini');
        expect(incr).toHaveBeenNthCalledWith(2, 'metrics:ai:failed_before_log:dm_reply:gpt-4.1-mini:OpenAIApiError');
    });

    it('routes thrown errors through the optional classifier', async () => {
        const { incr, client } = fakeRedis();
        const m = createAiMetrics(client);

        await expect(
            withAiMetrics(
                m,
                'dm_reply',
                'gpt-4.1-mini',
                async () => { throw Object.assign(new Error('aborted'), { name: 'APIUserAbortError' }); },
                (e) => (e instanceof Error && e.name === 'APIUserAbortError' ? 'AiTimeoutError' : 'OpenAIApiError'),
            ),
        ).rejects.toThrow('aborted');

        expect(incr).toHaveBeenNthCalledWith(2, 'metrics:ai:failed_before_log:dm_reply:gpt-4.1-mini:AiTimeoutError');
    });
});
