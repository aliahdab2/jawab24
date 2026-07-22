import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/redis', () => {
    const multi = {
        del: vi.fn(),
        incr: vi.fn(),
        expire: vi.fn(),
        exec: vi.fn().mockResolvedValue([]),
    };
    multi.del.mockReturnValue(multi);
    multi.incr.mockReturnValue(multi);
    multi.expire.mockReturnValue(multi);
    return {
        redis: {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue('OK'),
            del: vi.fn().mockResolvedValue(1),
            eval: vi.fn().mockResolvedValue(1),
            multi: vi.fn(() => multi),
        },
    };
});

import { redis } from '../lib/redis';
import {
    pagesStatsCacheKey,
    messagesStatsCacheKey,
    commentsStatsCacheKey,
    statsEpochKey,
    allStatsCacheKeys,
    withStatsCache,
    invalidateEndpointStatsCaches,
    invalidateWorkspaceStatsCache,
    STATS_INVALIDATION_THROTTLE,
} from '../services/statsCache';

/** Flush the microtask/macrotask queue so fire-and-forget redis chains settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

const mockRedis = redis as unknown as {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    eval: ReturnType<typeof vi.fn>;
    multi: ReturnType<typeof vi.fn>;
};

/** The chained MULTI stub shared by every redis.multi() call. */
const multi = () => mockRedis.multi() as unknown as {
    del: ReturnType<typeof vi.fn>;
    incr: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
};

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

    it('invalidateEndpointStatsCaches deletes messages + comments keys and bumps the epoch', () => {
        invalidateEndpointStatsCaches('w1');
        expect(multi().del).toHaveBeenCalledWith(
            messagesStatsCacheKey('w1'),
            commentsStatsCacheKey('w1'),
        );
        // The epoch bump is what lets a mid-flight compute detect that its snapshot
        // went stale — without it the DEL is undone by that compute's own write.
        expect(multi().incr).toHaveBeenCalledWith(statsEpochKey('w1'));
    });

    it('invalidateWorkspaceStatsCache drops the endpoint caches UNTHROTTLED (the stuck-counter fix)', async () => {
        // Throttle window already open: SET NX returns null so the pages-aggregate
        // DEL is skipped. The endpoint (messages + comments) caches — which back the
        // inbox "needs action" chip that refetches on every SSE event — MUST still be
        // dropped, or the chip reads a stale count that sticks (chip N, list 0).
        mockRedis.set.mockResolvedValueOnce(null);
        invalidateWorkspaceStatsCache('w1');
        await flush();

        expect(multi().del).toHaveBeenCalledWith(
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
        expect(multi().del).toHaveBeenCalledWith(
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

    it('withStatsCache writes through the epoch guard when an epoch key is given', async () => {
        // Regression guard for the stuck "needs attention" chip: a compute that
        // started before an invalidation must not overwrite the DEL with its stale
        // snapshot. The guard is a Lua CAS on the epoch captured before the compute.
        mockRedis.get
            .mockResolvedValueOnce(null)   // cache miss
            .mockResolvedValueOnce('7');   // epoch at compute start
        const compute = vi.fn().mockResolvedValue({ actionRequired: 1 });

        await expect(
            withStatsCache('k', 60, compute, statsEpochKey('w1')),
        ).resolves.toEqual({ actionRequired: 1 });

        expect(mockRedis.set).not.toHaveBeenCalled();
        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.stringContaining('SET'),
            2,
            'k',
            statsEpochKey('w1'),
            JSON.stringify({ actionRequired: 1 }),
            '60',
            '7',   // only writes while the epoch still reads 7
        );
    });

    it('withStatsCache treats a missing epoch key as the empty sentinel', async () => {
        // Never-invalidated workspace: GET returns null on both sides, so the first
        // write must still land (otherwise stats would never cache at all).
        mockRedis.get
            .mockResolvedValueOnce(null)   // cache miss
            .mockResolvedValueOnce(null);  // no epoch key yet
        const compute = vi.fn().mockResolvedValue({ total: 2 });

        await withStatsCache('k', 60, compute, statsEpochKey('w1'));

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String), 2, 'k', statsEpochKey('w1'), JSON.stringify({ total: 2 }), '60', '',
        );
    });

    it('withStatsCache skips the epoch read when caching is bypassed', async () => {
        const compute = vi.fn().mockResolvedValue({ total: 1 });
        await withStatsCache(null, 60, compute, statsEpochKey('w1'));
        expect(mockRedis.get).not.toHaveBeenCalled();
        expect(mockRedis.eval).not.toHaveBeenCalled();
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
