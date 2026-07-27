import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/redis', () => {
    // The MULTI chain delegates to the SAME del/incr spies as the direct calls, so
    // assertions read the same way whether a command was pipelined or not.
    const del = vi.fn().mockResolvedValue(1);
    const incr = vi.fn().mockResolvedValue(1);
    const multi = vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.del = (...args: unknown[]) => { del(...args); return chain; };
        chain.incr = (...args: unknown[]) => { incr(...args); return chain; };
        chain.exec = () => Promise.resolve([]);
        return chain;
    });
    return {
        redis: {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue('OK'),
            eval: vi.fn().mockResolvedValue(1),
            del,
            incr,
            multi,
        },
    };
});

import { redis } from '../lib/redis';
import {
    pagesStatsCacheKey,
    messagesStatsCacheKey,
    commentsStatsCacheKey,
    allStatsCacheKeys,
    withStatsCache,
    invalidateEndpointStatsCaches,
    invalidateWorkspaceStatsCache,
    statsEpochKey,
    STATS_INVALIDATION_THROTTLE,
} from '../services/statsCache';

/** Flush the microtask/macrotask queue so fire-and-forget redis chains settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

const mockRedis = redis as unknown as {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    eval: ReturnType<typeof vi.fn>;
    incr: ReturnType<typeof vi.fn>;
    multi: ReturnType<typeof vi.fn>;
};

/** Chainable MULTI stub that records the queued commands. */
function stubMulti() {
    const calls: Array<[string, unknown[]]> = [];
    const chain: Record<string, unknown> = {};
    for (const cmd of ['del', 'incr'] as const) {
        chain[cmd] = (...args: unknown[]) => { calls.push([cmd, args]); return chain; };
    }
    chain.exec = () => Promise.resolve([]);
    mockRedis.multi.mockReturnValue(chain);
    return calls;
}

describe('statsCache', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('allStatsCacheKeys covers every stats key builder', () => {
        // Regression guard for the ":v2 bug": invalidation once hardcoded
        // `stats:workspace:{id}` while getPages wrote `stats:workspace:{id}:v2`,
        // silently turning invalidation into a no-op. Invalidation must always
        // go through allStatsCacheKeys, and that list must include the exact
        // key each cache writer uses.
        const keys = allStatsCacheKeys('w1');
        expect(keys).toContain(pagesStatsCacheKey('w1'));
        expect(keys).toContain(messagesStatsCacheKey('w1'));
        expect(keys).toContain(commentsStatsCacheKey('w1'));
        expect(keys).toHaveLength(3);
    });

    it('pages stats key keeps its :v2 suffix (matches what getPages writes)', () => {
        expect(pagesStatsCacheKey('w1')).toBe('stats:workspace:w1:v2');
    });

    it('invalidateEndpointStatsCaches deletes messages + comments keys', () => {
        invalidateEndpointStatsCaches('w1');
        expect(mockRedis.del).toHaveBeenCalledWith(
            messagesStatsCacheKey('w1'),
            commentsStatsCacheKey('w1'),
        );
    });

    it('invalidateWorkspaceStatsCache drops the endpoint caches UNTHROTTLED (the stuck-counter fix)', async () => {
        // Throttle window already open: SET NX returns null so the pages-aggregate
        // DEL is skipped. The endpoint (messages + comments) caches — which back the
        // inbox "needs action" chip that refetches on every SSE event — MUST still be
        // dropped, or the chip reads a stale count that sticks (chip N, list 0).
        mockRedis.set.mockResolvedValueOnce(null);
        invalidateWorkspaceStatsCache('w1');
        await flush();

        expect(mockRedis.del).toHaveBeenCalledWith(
            messagesStatsCacheKey('w1'),
            commentsStatsCacheKey('w1'),
        );
        // pages aggregate NOT dropped while throttled
        expect(mockRedis.del).not.toHaveBeenCalledWith(pagesStatsCacheKey('w1'));
    });

    it('invalidateWorkspaceStatsCache drops the pages aggregate only when the throttle window is open', async () => {
        mockRedis.set.mockResolvedValueOnce('OK');
        invalidateWorkspaceStatsCache('w1');
        await flush();

        expect(mockRedis.set).toHaveBeenCalledWith(
            'stats:throttle:w1', '1', 'EX', STATS_INVALIDATION_THROTTLE, 'NX',
        );
        expect(mockRedis.del).toHaveBeenCalledWith(pagesStatsCacheKey('w1'));
        // endpoint caches still dropped on this path too
        expect(mockRedis.del).toHaveBeenCalledWith(
            messagesStatsCacheKey('w1'),
            commentsStatsCacheKey('w1'),
        );
    });

    it('withStatsCache returns the cached value without computing on hit', async () => {
        mockRedis.get.mockResolvedValueOnce(JSON.stringify({ total: 5 }));
        const compute = vi.fn();
        await expect(withStatsCache('k', 60, compute)).resolves.toEqual({ total: 5 });
        expect(compute).not.toHaveBeenCalled();
    });

    it('withStatsCache computes and stores with TTL on miss', async () => {
        mockRedis.get.mockResolvedValueOnce(null);
        const compute = vi.fn().mockResolvedValue({ total: 7 });
        await expect(withStatsCache('k', 60, compute)).resolves.toEqual({ total: 7 });
        expect(mockRedis.set).toHaveBeenCalledWith('k', JSON.stringify({ total: 7 }), 'EX', 60);
    });

    it('withStatsCache with a null key bypasses redis entirely', async () => {
        const compute = vi.fn().mockResolvedValue({ total: 3 });
        await expect(withStatsCache(null, 60, compute)).resolves.toEqual({ total: 3 });
        expect(mockRedis.get).not.toHaveBeenCalled();
        expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('withStatsCache tolerates redis errors and corrupt payloads', async () => {
        const compute = vi.fn().mockResolvedValue({ total: 9 });

        mockRedis.get.mockRejectedValueOnce(new Error('redis down'));
        await expect(withStatsCache('k', 60, compute)).resolves.toEqual({ total: 9 });

        mockRedis.get.mockResolvedValueOnce('not-json{');
        await expect(withStatsCache('k', 60, compute)).resolves.toEqual({ total: 9 });

        mockRedis.get.mockResolvedValueOnce(null);
        mockRedis.set.mockRejectedValueOnce(new Error('redis down'));
        await expect(withStatsCache('k', 60, compute)).resolves.toEqual({ total: 9 });
    });
});

// The chip showed 1 over an empty list THREE times. Root cause 1 (a throttled
// DEL) was fixed in #464; this covers root cause 2, the read-compute-write race:
// a compute that started before the DEL used to re-SET the stale count with a
// fresh TTL, and with no polling on the chip query it stuck until reload.
describe('statsCache epoch CAS (stuck needs-action chip, root cause 2)', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('bumps the epoch in the SAME multi as the endpoint DEL', async () => {
        const queued = stubMulti();
        invalidateEndpointStatsCaches('ws-1');
        await flush();

        expect(queued).toEqual([
            ['del', [messagesStatsCacheKey('ws-1'), commentsStatsCacheKey('ws-1')]],
            ['incr', [statsEpochKey('ws-1')]],
        ]);
    });

    it('captures the epoch BEFORE computing and CAS-writes against it', async () => {
        mockRedis.get.mockImplementation((key: string) =>
            Promise.resolve(key === statsEpochKey('ws-1') ? '7' : null));

        await withStatsCache('k', 60, async () => ({ actionRequired: 0 }), statsEpochKey('ws-1'));
        await flush();

        // Guarded write, not a bare SET — the bare path would clobber a DEL.
        expect(mockRedis.set).not.toHaveBeenCalled();
        const [, numKeys, epochKey, cacheKey, captured] = mockRedis.eval.mock.calls[0];
        expect([numKeys, epochKey, cacheKey, captured]).toEqual([2, statsEpochKey('ws-1'), 'k', '7']);
    });

    it('treats a missing epoch key as the empty sentinel so the first write still lands', async () => {
        mockRedis.get.mockResolvedValue(null);
        await withStatsCache('k', 60, async () => ({ actionRequired: 1 }), statsEpochKey('ws-1'));
        await flush();
        expect(mockRedis.eval.mock.calls[0][4]).toBe('');
    });

    it('leaves the heavy pages aggregate on the unguarded write — no epochKey, no CAS', async () => {
        await withStatsCache(pagesStatsCacheKey('ws-1'), 300, async () => ({ total: 1 }));
        await flush();
        expect(mockRedis.eval).not.toHaveBeenCalled();
        expect(mockRedis.set).toHaveBeenCalled();
    });

    it('does not read an epoch when the call bypasses caching entirely', async () => {
        await withStatsCache(null, 60, async () => ({ total: 1 }), statsEpochKey('ws-1'));
        await flush();
        expect(mockRedis.get).not.toHaveBeenCalled();
        expect(mockRedis.eval).not.toHaveBeenCalled();
    });
});
