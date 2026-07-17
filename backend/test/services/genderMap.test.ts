import { describe, it, expect, vi, beforeEach } from 'vitest';

const pipelineMock = {
    incr: vi.fn(),
    expire: vi.fn(),
    exec: vi.fn().mockResolvedValue([]),
};
pipelineMock.incr.mockReturnValue(pipelineMock);
pipelineMock.expire.mockReturnValue(pipelineMock);

vi.mock('../../src/lib/redis', () => ({
    redis: {
        mget: vi.fn(),
        pipeline: vi.fn(() => pipelineMock),
    },
}));

import { redis } from '../../src/lib/redis';
import {
    genderNameKeyHash,
    recordGenderObservation,
    getConfidentGender,
    MIN_OBSERVATIONS,
} from '../../src/services/genderMap';

describe('genderMap — fleet-learned first-name→gender consensus (v53)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pipelineMock.incr.mockReturnValue(pipelineMock);
        pipelineMock.expire.mockReturnValue(pipelineMock);
        pipelineMock.exec.mockResolvedValue([]);
    });

    describe('genderNameKeyHash', () => {
        it('uses only the first whitespace token', () => {
            expect(genderNameKeyHash('أحمد الخطيب')).toBe(genderNameKeyHash('أحمد'));
        });

        it('normalizes Arabic spelling variants into one entry (alef variants)', () => {
            expect(genderNameKeyHash('أحمد')).toBe(genderNameKeyHash('احمد'));
        });

        it('is case-insensitive for Latin names', () => {
            expect(genderNameKeyHash('Ahmed')).toBe(genderNameKeyHash('ahmed'));
        });

        it('different names hash to different entries', () => {
            expect(genderNameKeyHash('أحمد')).not.toBe(genderNameKeyHash('فاطمة'));
        });

        it('returns null for empty / whitespace-only input', () => {
            expect(genderNameKeyHash('')).toBeNull();
            expect(genderNameKeyHash('   ')).toBeNull();
        });
    });

    describe('recordGenderObservation', () => {
        it('increments the observed gender counter and refreshes BOTH sibling TTLs', async () => {
            await recordGenderObservation('أحمد', 'm');

            expect(pipelineMock.incr).toHaveBeenCalledTimes(1);
            const incrKey = pipelineMock.incr.mock.calls[0][0] as string;
            // 16 hex chars (64-bit) — 8 would collide across the fleet's name space.
            expect(incrKey).toMatch(/^gender:name:[0-9a-f]{16}:m$/);

            // Both m and f TTLs refreshed together so one sibling can't expire
            // while the other persists and skew the ratio.
            expect(pipelineMock.expire).toHaveBeenCalledTimes(2);
            const expiredKeys = pipelineMock.expire.mock.calls.map(c => c[0] as string).sort();
            expect(expiredKeys[0]).toMatch(/:f$/);
            expect(expiredKeys[1]).toMatch(/:m$/);
        });

        it('never throws when Redis is down (best-effort learning)', async () => {
            vi.mocked(redis.pipeline).mockImplementationOnce(() => { throw new Error('redis down'); });
            await expect(recordGenderObservation('أحمد', 'f')).resolves.toBeUndefined();
        });

        it('no-ops on an empty name', async () => {
            await recordGenderObservation('  ', 'm');
            expect(redis.pipeline).not.toHaveBeenCalled();
        });
    });

    describe('getConfidentGender', () => {
        const withCounts = (m: number, f: number) => {
            vi.mocked(redis.mget).mockResolvedValue([String(m), String(f)]);
        };

        it('reads both counters in one MGET (atomic snapshot)', async () => {
            withCounts(10, 0);
            await getConfidentGender('أحمد');
            expect(redis.mget).toHaveBeenCalledTimes(1);
            const keys = vi.mocked(redis.mget).mock.calls[0] as string[];
            expect(keys[0]).toMatch(/:m$/);
            expect(keys[1]).toMatch(/:f$/);
        });

        it(`confident at exactly ${MIN_OBSERVATIONS} consistent observations`, async () => {
            withCounts(5, 0);
            expect(await getConfidentGender('أحمد')).toBe('m');
        });

        it('not confident below the observation floor', async () => {
            withCounts(4, 0);
            expect(await getConfidentGender('أحمد')).toBeNull();
        });

        it('confident at exactly the 0.9 majority ratio (9 vs 1)', async () => {
            withCounts(9, 1);
            expect(await getConfidentGender('أحمد')).toBe('m');
        });

        it('not confident just below the ratio (4 vs 1 = 0.8)', async () => {
            withCounts(4, 1);
            expect(await getConfidentGender('نور')).toBeNull();
        });

        it('learns feminine names too', async () => {
            withCounts(0, 7);
            expect(await getConfidentGender('فاطمة')).toBe('f');
        });

        it('a genuinely unisex name (mixed counts) never becomes confident', async () => {
            withCounts(6, 6);
            expect(await getConfidentGender('نور')).toBeNull();
        });

        it('missing counters read as zero', async () => {
            vi.mocked(redis.mget).mockResolvedValue([null, null]);
            expect(await getConfidentGender('أحمد')).toBeNull();
        });

        it('returns null (per-name bucket — the safe direction) when Redis errors', async () => {
            vi.mocked(redis.mget).mockRejectedValue(new Error('redis down'));
            expect(await getConfidentGender('أحمد')).toBeNull();
        });

        it('returns null for an empty name', async () => {
            expect(await getConfidentGender('')).toBeNull();
            expect(redis.mget).not.toHaveBeenCalled();
        });
    });
});
