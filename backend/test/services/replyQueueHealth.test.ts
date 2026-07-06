import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config', () => ({
    config: {
        adminEmails: ['admin@example.com'],
        replyQueueHealth: {
            enabled: true,
            waitingThreshold: 25,
            waitP95ThresholdMs: 15000,
            alertCooldownSeconds: 3600,
            evalIntervalMs: 60000,
        },
    },
}));
vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), set: vi.fn(), lpush: vi.fn(), ltrim: vi.fn(), lrange: vi.fn() },
}));
vi.mock('../../src/lib/replyQueue', () => ({ getQueueStats: vi.fn() }));
vi.mock('../../src/services/email', () => ({ emailService: { send: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('@sentry/node', () => ({ captureMessage: vi.fn() }));

import { config } from '../../src/config';
import { redis } from '../../src/lib/redis';
import { getQueueStats } from '../../src/lib/replyQueue';
import { emailService } from '../../src/services/email';
import * as Sentry from '@sentry/node';
import {
    computeQueueWaitMs,
    recordQueueWaitSample,
    getQueueHealth,
    evaluateQueueBacklogAndAlert,
    resetBreachStateForTests,
} from '../../src/services/replyQueueHealth';

const NOW_MS = new Date('2026-07-04T12:00:00Z').getTime();
const NOW = new Date(NOW_MS);

/** Flush the fire-and-forget promise chain inside recordQueueWaitSample. */
const flush = () => new Promise((r) => setImmediate(r));

function mockStats(overrides: Partial<{ waiting: number; active: number; delayed: number; failed: number }> = {}) {
    vi.mocked(getQueueStats).mockResolvedValue({
        waiting: 0, active: 1, delayed: 0, completed: 100, failed: 0, total: 1,
        ...overrides,
    });
}

/** Build newest-first "ts:wait" sample entries, all inside the window. */
function samples(waits: number[], ts: number = NOW_MS - 1000): string[] {
    return waits.map((w) => `${ts}:${w}`);
}

beforeEach(() => {
    vi.clearAllMocks();
    resetBreachStateForTests();
    config.replyQueueHealth.enabled = true;
    mockStats();
    vi.mocked(redis.lrange).mockResolvedValue([]);
    vi.mocked(redis.set).mockResolvedValue('OK');
    vi.mocked(redis.lpush).mockResolvedValue(1);
    vi.mocked(redis.ltrim).mockResolvedValue('OK');
});

describe('computeQueueWaitMs', () => {
    it('is pickup time minus enqueue time', () => {
        expect(computeQueueWaitMs({ timestamp: NOW_MS - 500 }, NOW_MS)).toBe(500);
    });

    it('excludes the intentional scheduling delay', () => {
        expect(computeQueueWaitMs({ timestamp: NOW_MS - 5000, opts: { delay: 4000 } }, NOW_MS)).toBe(1000);
    });

    it('clamps to 0 when a delayed job is promoted early', () => {
        expect(computeQueueWaitMs({ timestamp: NOW_MS - 1000, opts: { delay: 60000 } }, NOW_MS)).toBe(0);
    });
});

describe('recordQueueWaitSample', () => {
    it('pushes "ts:wait" and trims the list to the cap', async () => {
        recordQueueWaitSample(123.6, NOW_MS);
        await flush();
        expect(redis.lpush).toHaveBeenCalledWith('metrics:queue_wait:reply', `${NOW_MS}:124`);
        expect(redis.ltrim).toHaveBeenCalledWith('metrics:queue_wait:reply', 0, 1999);
    });

    it('swallows Redis failures (metrics never break replies)', async () => {
        vi.mocked(redis.lpush).mockRejectedValue(new Error('redis down'));
        expect(() => recordQueueWaitSample(5, NOW_MS)).not.toThrow();
        await flush();
    });
});

describe('getQueueHealth', () => {
    it('computes nearest-rank percentiles over the recent window', async () => {
        // 20 samples: 1..20ms → p50 = 10, p95 = 19, max = 20
        vi.mocked(redis.lrange).mockResolvedValue(samples(Array.from({ length: 20 }, (_, i) => i + 1)));
        mockStats({ waiting: 2, active: 3, delayed: 4, failed: 5 });

        const h = await getQueueHealth(NOW_MS);
        expect(h).toMatchObject({ waiting: 2, active: 3, delayed: 4, failed: 5 });
        expect(h.waitP50Ms).toBe(10);
        expect(h.waitP95Ms).toBe(19);
        expect(h.waitMaxMs).toBe(20);
        expect(h.sampleCount).toBe(20);
        expect(h.windowMinutes).toBe(15);
    });

    it('excludes samples older than the window (newest-first list)', async () => {
        const inWindow = samples([100, 200], NOW_MS - 60_000);
        const tooOld = samples([9999, 8888], NOW_MS - 16 * 60_000);
        vi.mocked(redis.lrange).mockResolvedValue([...inWindow, ...tooOld]);

        const h = await getQueueHealth(NOW_MS);
        expect(h.sampleCount).toBe(2);
        expect(h.waitMaxMs).toBe(200);
    });

    it('keeps in-window samples that appear after an older entry (interleaved LPUSH order)', async () => {
        // Concurrent workers can push slightly out of timestamp order — an
        // in-window sample after an out-of-window one must NOT be dropped.
        vi.mocked(redis.lrange).mockResolvedValue([
            ...samples([100], NOW_MS - 60_000),
            ...samples([9999], NOW_MS - 16 * 60_000), // old
            ...samples([300], NOW_MS - 14 * 60_000),  // still in window
        ]);

        const h = await getQueueHealth(NOW_MS);
        expect(h.sampleCount).toBe(2);
        expect(h.waitMaxMs).toBe(300);
    });

    it('returns nulls on an idle queue (no recent samples)', async () => {
        const h = await getQueueHealth(NOW_MS);
        expect(h.waitP50Ms).toBeNull();
        expect(h.waitP95Ms).toBeNull();
        expect(h.waitMaxMs).toBeNull();
        expect(h.sampleCount).toBe(0);
    });

    it('skips malformed entries', async () => {
        vi.mocked(redis.lrange).mockResolvedValue(['garbage', ':5', `${NOW_MS}:abc`, `${NOW_MS}:42`]);
        const h = await getQueueHealth(NOW_MS);
        expect(h.sampleCount).toBe(1);
        expect(h.waitMaxMs).toBe(42);
    });
});

describe('evaluateQueueBacklogAndAlert', () => {
    it('returns null and touches nothing when disabled', async () => {
        config.replyQueueHealth.enabled = false;
        expect(await evaluateQueueBacklogAndAlert(NOW)).toBeNull();
        expect(getQueueStats).not.toHaveBeenCalled();
        expect(redis.set).not.toHaveBeenCalled();
    });

    it('does not alert on a healthy queue', async () => {
        await evaluateQueueBacklogAndAlert(NOW);
        await evaluateQueueBacklogAndAlert(NOW);
        expect(redis.set).not.toHaveBeenCalled();
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('does not alert on a single breach (burst clearing itself)', async () => {
        mockStats({ waiting: 30 });
        await evaluateQueueBacklogAndAlert(NOW);
        expect(redis.set).not.toHaveBeenCalled();
    });

    it('alerts on the second consecutive breach via waiting depth', async () => {
        mockStats({ waiting: 30 });
        await evaluateQueueBacklogAndAlert(NOW);
        await evaluateQueueBacklogAndAlert(NOW);

        expect(redis.set).toHaveBeenCalledWith('alert:reply_queue_backlog', '1', 'EX', 3600, 'NX');
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
        expect(emailService.send).toHaveBeenCalledTimes(1);
        expect(vi.mocked(emailService.send).mock.calls[0][0]).toMatchObject({ to: 'admin@example.com', type: 'transactional' });
    });

    it('alerts on the second consecutive breach via p95 wait', async () => {
        vi.mocked(redis.lrange).mockResolvedValue(samples([20000, 21000, 22000]));
        await evaluateQueueBacklogAndAlert(NOW);
        await evaluateQueueBacklogAndAlert(NOW);
        expect(redis.set).toHaveBeenCalledWith('alert:reply_queue_backlog', '1', 'EX', 3600, 'NX');
    });

    it('resets the breach counter after a healthy evaluation', async () => {
        mockStats({ waiting: 30 });
        await evaluateQueueBacklogAndAlert(NOW); // breach 1
        mockStats({ waiting: 0 });
        await evaluateQueueBacklogAndAlert(NOW); // healthy → reset
        mockStats({ waiting: 30 });
        await evaluateQueueBacklogAndAlert(NOW); // breach 1 again
        expect(redis.set).not.toHaveBeenCalled();
    });

    it('is suppressed by the SET-NX cooldown', async () => {
        vi.mocked(redis.set).mockResolvedValue(null); // dedup slot already taken
        mockStats({ waiting: 30 });
        await evaluateQueueBacklogAndAlert(NOW);
        await evaluateQueueBacklogAndAlert(NOW);
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
        expect(emailService.send).not.toHaveBeenCalled();
    });

    it('skips overlapping evaluations while one is still in flight', async () => {
        let release!: (v: Awaited<ReturnType<typeof getQueueStats>>) => void;
        vi.mocked(getQueueStats).mockReturnValueOnce(new Promise((r) => { release = r; }));

        const first = evaluateQueueBacklogAndAlert(NOW); // stalls on getQueueStats
        expect(await evaluateQueueBacklogAndAlert(NOW)).toBeNull(); // skipped
        expect(getQueueStats).toHaveBeenCalledTimes(1);

        release({ waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0, total: 0 });
        expect(await first).not.toBeNull();

        mockStats(); // flag released → next evaluation runs normally
        expect(await evaluateQueueBacklogAndAlert(NOW)).not.toBeNull();
        expect(getQueueStats).toHaveBeenCalledTimes(2);
    });
});
