import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/redis', () => ({
    redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
    },
}));

import { redis } from '../lib/redis';
import {
    pagesStatsCacheKey,
    messagesStatsCacheKey,
    commentsStatsCacheKey,
    allStatsCacheKeys,
    withStatsCache,
    invalidateEndpointStatsCaches,
} from '../services/statsCache';

const mockRedis = redis as unknown as {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
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

    it('invalidateEndpointStatsCaches deletes messages + comments keys', () => {
        invalidateEndpointStatsCaches('w1');
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
