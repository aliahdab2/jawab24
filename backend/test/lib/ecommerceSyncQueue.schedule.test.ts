/**
 * scheduleEcommerceSync — the catalog refresh must run shortly after boot, not
 * only 6 h later.
 *
 * Background: the scheduler was a bare `setInterval` anchored to process start.
 * With a blue/green deploy every few hours, no prod container ever reached the
 * first tick (checked 2026-08-22: zero `[EcommerceScheduler]` log lines in either
 * backend container; every store's `last_sync_at` came from an install or a
 * manual sync). The initial sweep below is what closes that gap.
 *
 * Mutation checks (each must turn a test red):
 *   - drop the `setTimeout` initial sweep        → "runs an initial sweep" fails
 *   - anchor the initial sweep at the interval   → same test (nothing at 3 min)
 *   - drop the `setInterval`                     → "keeps sweeping" fails
 *   - let a thrown getAllActiveStores escape     → "survives a failing sweep" fails
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockAdd = vi.fn();
vi.mock('bullmq', () => ({
    Queue: vi.fn(() => ({ add: (...args: unknown[]) => mockAdd(...args) })),
}));

vi.mock('../../src/config', () => ({
    config: { redis: { host: 'localhost', port: 6379, password: 'secret' } },
}));

import { scheduleEcommerceSync } from '../../src/lib/ecommerceSyncQueue';

const STORES = [
    { id: 'store-a', platform: 'zid' },
    { id: 'store-b', platform: 'salla' },
];

function makeLog() {
    return { info: vi.fn(), error: vi.fn() };
}

describe('scheduleEcommerceSync', () => {
    let timers: { initial: NodeJS.Timeout; interval: NodeJS.Timeout } | undefined;

    beforeEach(() => {
        vi.useFakeTimers();
        mockAdd.mockReset().mockResolvedValue(undefined);
    });

    afterEach(() => {
        if (timers) { clearTimeout(timers.initial); clearInterval(timers.interval); }
        vi.useRealTimers();
    });

    it('runs an initial sweep after the boot delay, before the first interval', async () => {
        const getAllActiveStores = vi.fn().mockResolvedValue(STORES);
        const log = makeLog();
        timers = scheduleEcommerceSync({ getAllActiveStores, log, initialDelayMs: 3_000, intervalMs: 60_000 });

        await vi.advanceTimersByTimeAsync(2_999);
        expect(getAllActiveStores).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(getAllActiveStores).toHaveBeenCalledTimes(1);
        // One full_sync per active store, with the store's own platform.
        expect(mockAdd).toHaveBeenCalledTimes(2);
        expect(mockAdd).toHaveBeenCalledWith('full_sync', { ecommerceStoreId: 'store-a', platform: 'zid', jobType: 'full_sync' });
        expect(mockAdd).toHaveBeenCalledWith('full_sync', { ecommerceStoreId: 'store-b', platform: 'salla', jobType: 'full_sync' });
        expect(log.info).toHaveBeenCalledWith(expect.stringContaining('initial sweep'));
    });

    it('keeps sweeping on the interval after the initial sweep', async () => {
        const getAllActiveStores = vi.fn().mockResolvedValue(STORES);
        timers = scheduleEcommerceSync({ getAllActiveStores, log: makeLog(), initialDelayMs: 3_000, intervalMs: 60_000 });

        await vi.advanceTimersByTimeAsync(3_000);   // initial
        await vi.advanceTimersByTimeAsync(60_000);  // first interval
        await vi.advanceTimersByTimeAsync(60_000);  // second interval
        expect(getAllActiveStores).toHaveBeenCalledTimes(3);
        expect(mockAdd).toHaveBeenCalledTimes(6);
    });

    it('survives a failing sweep: logs, reports, and still runs the next one', async () => {
        const getAllActiveStores = vi.fn()
            .mockRejectedValueOnce(new Error('db down'))
            .mockResolvedValue(STORES);
        const log = makeLog();
        const onError = vi.fn();
        timers = scheduleEcommerceSync({ getAllActiveStores, log, onError, initialDelayMs: 1_000, intervalMs: 10_000 });

        await vi.advanceTimersByTimeAsync(1_000);
        expect(log.error).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(expect.any(Error));
        expect(mockAdd).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(10_000);
        expect(mockAdd).toHaveBeenCalledTimes(2);
    });

    it('uses the production defaults when none are given: 3 min lead-in, 6 h interval', async () => {
        const getAllActiveStores = vi.fn().mockResolvedValue(STORES);
        timers = scheduleEcommerceSync({ getAllActiveStores, log: makeLog() });

        await vi.advanceTimersByTimeAsync(3 * 60 * 1000 - 1);
        expect(getAllActiveStores).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(getAllActiveStores).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
        expect(getAllActiveStores).toHaveBeenCalledTimes(2);
    });
});
