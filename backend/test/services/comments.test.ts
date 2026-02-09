import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commentsService } from '../../src/services/comments';
import { db } from '../../src/db';

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
    }
}));

/** Helper: build a chainable mock for select().from().innerJoin().innerJoin().where() */
function mockCountQuery(count: number) {
    return {
        from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
                innerJoin: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{ count }])
                })
            })
        })
    };
}

/** Helper: build a chainable mock that also chains .groupBy() */
function mockGroupByQuery(rows: { method: string; count: number }[]) {
    return {
        from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
                innerJoin: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        groupBy: vi.fn().mockResolvedValue(rows)
                    })
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
            // getStats() runs 10 parallel queries: 5 FB + 5 IG
            vi.mocked(db.select)
                // --- Facebook queries ---
                .mockReturnValueOnce(mockCountQuery(100) as any)   // fbTotal
                .mockReturnValueOnce(mockCountQuery(60) as any)    // fbReplied
                .mockReturnValueOnce(mockGroupByQuery([            // fbByMethod
                    { method: 'template', count: 30 },
                    { method: 'ai', count: 20 },
                    { method: 'manual', count: 10 },
                ]) as any)
                .mockReturnValueOnce(mockCountQuery(2) as any)     // fbNeedsAttention
                .mockReturnValueOnce(mockCountQuery(3) as any)     // fbRepliedToday
                // --- Instagram queries ---
                .mockReturnValueOnce(mockCountQuery(50) as any)    // igTotal
                .mockReturnValueOnce(mockCountQuery(30) as any)    // igReplied
                .mockReturnValueOnce(mockGroupByQuery([            // igByMethod
                    { method: 'ai', count: 15 },
                    { method: 'template', count: 10 },
                    { method: 'manual', count: 5 },
                ]) as any)
                .mockReturnValueOnce(mockCountQuery(1) as any)     // igNeedsAttention
                .mockReturnValueOnce(mockCountQuery(2) as any);    // igRepliedToday

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
            // All 10 queries return 0
            vi.mocked(db.select)
                .mockReturnValueOnce(mockCountQuery(0) as any)    // fbTotal
                .mockReturnValueOnce(mockCountQuery(0) as any)    // fbReplied
                .mockReturnValueOnce(mockGroupByQuery([]) as any) // fbByMethod
                .mockReturnValueOnce(mockCountQuery(0) as any)    // fbNeedsAttention
                .mockReturnValueOnce(mockCountQuery(0) as any)    // fbRepliedToday
                .mockReturnValueOnce(mockCountQuery(0) as any)    // igTotal
                .mockReturnValueOnce(mockCountQuery(0) as any)    // igReplied
                .mockReturnValueOnce(mockGroupByQuery([]) as any) // igByMethod
                .mockReturnValueOnce(mockCountQuery(0) as any)    // igNeedsAttention
                .mockReturnValueOnce(mockCountQuery(0) as any);   // igRepliedToday

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
