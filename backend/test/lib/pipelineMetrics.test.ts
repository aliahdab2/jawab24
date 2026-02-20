import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted to the top of the file, so redisMock must use vi.hoisted()
// to be initialized before the factory function runs.
const redisMock = vi.hoisted(() => ({
    incr: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    scan: vi.fn(),
    mget: vi.fn(),
    del: vi.fn(),
}));
vi.mock('../../src/lib/redis', () => ({ redis: redisMock }));

import { pipelineMetrics, PipelineMetrics } from '../../src/lib/pipelineMetrics';

describe('pipelineMetrics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: Redis healthy, no keys exist, no since timestamp yet
        redisMock.incr.mockResolvedValue(1);
        redisMock.get.mockResolvedValue(null);
        redisMock.set.mockResolvedValue('OK');
        redisMock.scan.mockResolvedValue(['0', []]);
        redisMock.mget.mockResolvedValue([]);
        redisMock.del.mockResolvedValue(1);
    });

    it('should start with empty counters', async () => {
        const metrics = await pipelineMetrics.getMetrics();
        expect(metrics.counters).toEqual({});
        expect(metrics.since).toBeDefined();
    });

    it('should record and increment counters via redis.incr', async () => {
        await pipelineMetrics.record('facebook_message', 'success');
        await pipelineMetrics.record('facebook_message', 'success');
        await pipelineMetrics.record('facebook_message', 'debounce_skipped');

        expect(redisMock.incr).toHaveBeenCalledTimes(3);
        expect(redisMock.incr).toHaveBeenCalledWith('metrics:pipeline:facebook_message.success');
        expect(redisMock.incr).toHaveBeenCalledWith('metrics:pipeline:facebook_message.debounce_skipped');
    });

    it('should track different pipelines independently via SCAN + mget', async () => {
        redisMock.get.mockResolvedValue('2025-01-01T00:00:00.000Z');
        redisMock.scan.mockResolvedValue(['0', [
            'metrics:pipeline:facebook_message.success',
            'metrics:pipeline:instagram_message.success',
            'metrics:pipeline:facebook_comment.rate_limited',
            'metrics:pipeline:instagram_comment.handoff_active',
        ]]);
        redisMock.mget.mockResolvedValue(['1', '1', '1', '1']);

        const { counters } = await pipelineMetrics.getMetrics();
        expect(counters['facebook_message.success']).toBe(1);
        expect(counters['instagram_message.success']).toBe(1);
        expect(counters['facebook_comment.rate_limited']).toBe(1);
        expect(counters['instagram_comment.handoff_active']).toBe(1);
    });

    it('should reset counters and update since timestamp', async () => {
        const timeBefore = Date.now();

        // Simulate counter keys existing when reset() SCANs
        redisMock.scan.mockResolvedValue(['0', ['metrics:pipeline:facebook_message.success']]);

        await pipelineMetrics.reset();

        // Should delete the counter key (not the _since key)
        expect(redisMock.del).toHaveBeenCalledWith('metrics:pipeline:facebook_message.success');
        // Should write a new since timestamp
        expect(redisMock.set).toHaveBeenCalledWith('metrics:pipeline:_since', expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));

        // The timestamp written should be >= the time we started
        const setCall = redisMock.set.mock.calls.find(c => c[0] === 'metrics:pipeline:_since');
        expect(new Date(setCall![1] as string).getTime()).toBeGreaterThanOrEqual(timeBefore);
    });

    it('should handle all outcome types', async () => {
        const outcomes = [
            'success', 'page_not_found', 'no_user', 'auto_reply_disabled',
            'debounce_skipped', 'handoff_active', 'rate_limited', 'settings_disabled',
            'already_replied', 'no_reply_generated', 'send_failed', 'post_disabled',
            'media_disabled', 'error',
        ] as const;

        for (const outcome of outcomes) {
            await pipelineMetrics.record('facebook_message', outcome);
        }

        expect(redisMock.incr).toHaveBeenCalledTimes(outcomes.length);
        for (const outcome of outcomes) {
            expect(redisMock.incr).toHaveBeenCalledWith(`metrics:pipeline:facebook_message.${outcome}`);
        }
    });

    it('counters persist across new instance creation (simulated restart)', async () => {
        // Simulate Redis already holding data from a previous process
        redisMock.get.mockResolvedValue('2025-01-01T00:00:00.000Z');
        redisMock.scan.mockResolvedValue(['0', ['metrics:pipeline:facebook_message.success']]);
        redisMock.mget.mockResolvedValue(['3']);

        const newInstance = new PipelineMetrics();
        const { counters } = await newInstance.getMetrics();
        expect(counters['facebook_message.success']).toBe(3);
    });

    it('returns empty counters when Redis is unavailable (graceful degradation)', async () => {
        redisMock.get.mockRejectedValue(new Error('ECONNREFUSED'));

        const { counters } = await pipelineMetrics.getMetrics();
        expect(counters).toEqual({});
        // Should not throw
    });
});
