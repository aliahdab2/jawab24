import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commentsService } from '../../src/services/comments';
import { db } from '../../src/db';

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
    }
}));

/**
 * Helper: build a chainable mock for select().from().innerJoin().innerJoin().where()
 * Now returns a single row with all FILTER aggregation fields.
 */
function mockStatsQuery(stats: {
    total: number;
    replied: number;
    needsAttention: number;
    repliedToday: number;
    ai: number;
    template: number;
    manual: number;
}) {
    return {
        from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
                innerJoin: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([stats])
                })
            })
        })
    };
}

describe('CommentsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getStats', () => {
        it('should return correct stats from aggregated query', async () => {
            // getStats() now runs 2 parallel queries (FB + IG), each returning all counts
            vi.mocked(db.select)
                // Facebook stats — single row with all FILTER counts
                .mockReturnValueOnce(mockStatsQuery({
                    total: 100,
                    replied: 60,
                    needsAttention: 2,
                    repliedToday: 3,
                    ai: 20,
                    template: 30,
                    manual: 10,
                }) as any)
                // Instagram stats — single row with all FILTER counts
                .mockReturnValueOnce(mockStatsQuery({
                    total: 50,
                    replied: 30,
                    needsAttention: 1,
                    repliedToday: 2,
                    ai: 15,
                    template: 10,
                    manual: 5,
                }) as any);

            const stats = await commentsService.getStats('user-123');

            expect(stats).toEqual({
                total: 150,          // 100 + 50
                replied: 90,         // 60 + 30
                unreplied: 60,       // total - replied
                needsAttention: 3,   // 2 + 1
                repliedToday: 5,     // 3 + 2
                replyRate: '60.0',
                byMethod: {
                    template: 40,    // 30 + 10
                    ai: 35,          // 20 + 15
                    manual: 15,      // 10 + 5
                }
            });
        });

        it('should handle zero comments', async () => {
            // Both queries return zeros
            vi.mocked(db.select)
                .mockReturnValueOnce(mockStatsQuery({
                    total: 0, replied: 0, needsAttention: 0,
                    repliedToday: 0, ai: 0, template: 0, manual: 0,
                }) as any)
                .mockReturnValueOnce(mockStatsQuery({
                    total: 0, replied: 0, needsAttention: 0,
                    repliedToday: 0, ai: 0, template: 0, manual: 0,
                }) as any);

            const stats = await commentsService.getStats('user-empty');

            expect(stats).toEqual({
                total: 0,
                replied: 0,
                unreplied: 0,
                needsAttention: 0,
                repliedToday: 0,
                replyRate: '0',
                byMethod: { template: 0, ai: 0, manual: 0 }
            });
        });
    });
});
