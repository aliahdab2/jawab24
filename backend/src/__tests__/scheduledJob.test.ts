/**
 * Tests: scheduleRecurringJob.
 *
 * This helper now drives four production jobs (lead digest, trial reminders,
 * DB cleanup, OpenAI cost snapshot), so the properties they all silently depend
 * on are pinned here:
 *   - the first run is DELAYED, never immediate (it must not block boot)
 *   - it then repeats on the interval
 *   - a rejected run is caught, logged and captured — never rethrown, because an
 *     unhandled rejection in a timer callback takes the process down
 *   - one failed run does not stop the schedule
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { captureErrorMock } = vi.hoisted(() => ({ captureErrorMock: vi.fn() }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: captureErrorMock }));

import { scheduleRecurringJob } from '../lib/scheduledJob';

beforeEach(() => {
    vi.useFakeTimers();
    captureErrorMock.mockClear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('scheduleRecurringJob', () => {
    it('does not run on registration — the first run waits for initialDelayMs', () => {
        const run = vi.fn().mockResolvedValue(undefined);

        scheduleRecurringJob({
            label: '[Test]', tag: 'test', intervalMs: 1000, initialDelayMs: 100,
            run, logError: vi.fn(),
        });

        expect(run).not.toHaveBeenCalled();
        vi.advanceTimersByTime(99);
        expect(run).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('repeats on the interval, independently of the initial run', () => {
        const run = vi.fn().mockResolvedValue(undefined);

        scheduleRecurringJob({
            label: '[Test]', tag: 'test', intervalMs: 1000, initialDelayMs: 100,
            run, logError: vi.fn(),
        });

        vi.advanceTimersByTime(100);   // initial
        vi.advanceTimersByTime(1000);  // first scheduled tick
        vi.advanceTimersByTime(1000);  // second scheduled tick
        expect(run).toHaveBeenCalledTimes(3);
    });

    it('swallows a rejection: logs it, reports it, and keeps the schedule alive', async () => {
        const boom = new Error('boom');
        const run = vi.fn().mockRejectedValue(boom);
        const logError = vi.fn();

        scheduleRecurringJob({
            label: '[Test]', tag: 'test_tag', intervalMs: 1000, initialDelayMs: 100,
            run, logError,
        });

        vi.advanceTimersByTime(100);
        await vi.waitFor(() => expect(logError).toHaveBeenCalled());

        expect(logError).toHaveBeenCalledWith(boom, '[Test] Initial run failed');
        expect(captureErrorMock).toHaveBeenCalledWith(boom, '[Test] Initial run failed', {
            tags: { cron: 'test_tag' },
            level: 'error',
        });

        // A failed run must not cancel the interval.
        vi.advanceTimersByTime(1000);
        await vi.waitFor(() => expect(logError).toHaveBeenCalledTimes(2));
        expect(logError).toHaveBeenLastCalledWith(boom, '[Test] Scheduled run failed');
    });
});
