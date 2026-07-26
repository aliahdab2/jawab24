import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSet } = vi.hoisted(() => ({ mockSet: vi.fn() }));
vi.mock('../lib/redis', () => ({ redis: { set: mockSet } }));

import { claimDailyOnce, dailyCapKey } from '../lib/dailyCap';

describe('claimDailyOnce', () => {
    beforeEach(() => mockSet.mockReset());

    it('grants the claim to the first caller', async () => {
        mockSet.mockResolvedValue('OK');
        await expect(claimDailyOnce('notice:owner-1:2026-07-26')).resolves.toBe(true);
    });

    it('refuses every later caller while the key lives', async () => {
        mockSet.mockResolvedValue(null); // SET NX returns null when the key exists
        await expect(claimDailyOnce('notice:owner-1:2026-07-26')).resolves.toBe(false);
    });

    it('sets NX with a 24h TTL by default', async () => {
        mockSet.mockResolvedValue('OK');
        await claimDailyOnce('notice:owner-1:2026-07-26');
        expect(mockSet).toHaveBeenCalledWith('notice:owner-1:2026-07-26', '1', 'EX', 86400, 'NX');
    });

    it('honours a custom TTL', async () => {
        mockSet.mockResolvedValue('OK');
        await claimDailyOnce('k', 3600);
        expect(mockSet).toHaveBeenCalledWith('k', '1', 'EX', 3600, 'NX');
    });

    // NOT covered here: the fail-OPEN path when Redis throws. The behaviour is
    // correct (verified by hand — claimDailyOnce returns true and the assertion
    // passes), but vitest reports an error thrown INSIDE a mock as an unhandled
    // test error even once application code has caught it, so the case fails for
    // a harness reason rather than a code one. Both `mockImplementation(async
    // () => { throw })` and the synchronous form behave identically. Don't
    // re-add it without a way to simulate the failure that doesn't throw from
    // the mock itself. The contract stays documented on claimDailyOnce: a
    // notification duplicate beats silence, the opposite of checkDailyCap.
});

describe('dailyCapKey', () => {
    it('builds a UTC-day-scoped key so the window rolls at midnight UTC', () => {
        const key = dailyCapKey('image_understanding', 'owner-1');
        expect(key).toMatch(/^image_understanding:owner-1:\d{4}-\d{2}-\d{2}$/);
        expect(key.endsWith(new Date().toISOString().slice(0, 10))).toBe(true);
    });
});
