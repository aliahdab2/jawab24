import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commentsService } from '../../src/services/comments';
import { db } from '../../src/db';

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
    }
}));

describe('CommentsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getStats', () => {
        it('should return correct stats from aggregated query', async () => {
            // Mock total count query
            const mockTotalQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({
                            where: vi.fn().mockResolvedValue([{ count: 100 }])
                        })
                    })
                })
            };

            // Mock replied count query
            const mockRepliedQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({
                            where: vi.fn().mockResolvedValue([{ count: 60 }])
                        })
                    })
                })
            };

            // Mock method breakdown query
            const mockMethodQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({
                            where: vi.fn().mockReturnValue({
                                groupBy: vi.fn().mockResolvedValue([
                                    { method: 'template', count: 30 },
                                    { method: 'ai', count: 20 },
                                    { method: 'manual', count: 10 }
                                ])
                            })
                        })
                    })
                })
            };

            // Mock needsAttention query
            const mockNeedsAttentionQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({
                            where: vi.fn().mockResolvedValue([{ count: 2 }])
                        })
                    })
                })
            };

            // Mock repliedToday query
            const mockRepliedTodayQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({
                            where: vi.fn().mockResolvedValue([{ count: 5 }])
                        })
                    })
                })
            };

            // Sequence of calls
            vi.mocked(db.select)
                .mockReturnValueOnce(mockTotalQuery as any)
                .mockReturnValueOnce(mockRepliedQuery as any)
                .mockReturnValueOnce(mockMethodQuery as any)
                .mockReturnValueOnce(mockNeedsAttentionQuery as any)
                .mockReturnValueOnce(mockRepliedTodayQuery as any);

            const stats = await commentsService.getStats('user-123');

            expect(stats).toEqual({
                total: 100,
                replied: 60,
                unreplied: 40,
                needsAttention: 2,
                repliedToday: 5,
                replyRate: '60.0',
                byMethod: {
                    template: 30,
                    ai: 20,
                    manual: 10
                }
            });
        });

        it('should handle zero comments', async () => {
             // Mock total count query returning 0
             const mockTotalQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({
                            where: vi.fn().mockResolvedValue([{ count: 0 }])
                        })
                    })
                })
            };

            vi.mocked(db.select).mockReturnValue(mockTotalQuery as any);

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
