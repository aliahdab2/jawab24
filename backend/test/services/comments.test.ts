import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commentsService } from '../../src/services/comments';
import { db } from '../../src/db';
import { collectSqlValues } from '../helpers/sqlInspect';

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
    resolved: number;
    actionRequired: number;
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
                    resolved: 3,
                    actionRequired: 39,  // (100 - 60 - 3 unreplied) + 2 needsAttention = 37 + 2
                    repliedToday: 3,
                    aiToday: 2,
                    postReplyToday: 1,
                    ai: 20,
                    template: 30,
                    manual: 10,
                }) as any)
                // Instagram stats — single row with all FILTER counts
                .mockReturnValueOnce(mockStatsQuery({
                    total: 50,
                    replied: 30,
                    needsAttention: 1,
                    resolved: 2,
                    actionRequired: 19,  // (50 - 30 - 2 unreplied) + 1 needsAttention = 18 + 1
                    repliedToday: 2,
                    aiToday: 1,
                    postReplyToday: 1,
                    ai: 15,
                    template: 10,
                    manual: 5,
                }) as any);

            const stats = await commentsService.getStats('user-123');

            expect(stats).toEqual({
                total: 150,          // 100 + 50
                replied: 90,         // 60 + 30
                unreplied: 55,       // total - replied - resolved = 150 - 90 - 5
                needsAttention: 3,   // 2 + 1
                actionRequired: 58,  // 39 + 19
                resolved: 5,         // 3 + 2
                repliedToday: 5,     // 3 + 2
                replyRate: '60.0',
                byMethod: {
                    template: 40,    // 30 + 10
                    ai: 35,          // 20 + 15
                    manual: 15,      // 10 + 5
                    postReply: 0,
                },
                repliedTodayByMethod: {
                    ai: 3,           // 2 + 1
                    postReply: 2,    // 1 + 1
                },
            });
        });

        it('should include flagged replies in actionRequired count', async () => {
            // Scenario: 10 total, 8 replied (2 flagged), 0 resolved
            // actionRequired = 2 unreplied + 2 flagged = 4
            vi.mocked(db.select)
                .mockReturnValueOnce(mockStatsQuery({
                    total: 10,
                    replied: 8,
                    needsAttention: 2,   // 2 flagged (replied but need attention)
                    resolved: 0,
                    actionRequired: 4,   // 2 unreplied + 2 flagged
                    repliedToday: 3,
                    ai: 6,
                    template: 2,
                    manual: 0,
                }) as any)
                .mockReturnValueOnce(mockStatsQuery({
                    total: 0, replied: 0, needsAttention: 0, resolved: 0, actionRequired: 0,
                    repliedToday: 0, ai: 0, template: 0, manual: 0,
                }) as any);

            const stats = await commentsService.getStats('user-flagged');

            expect(stats.actionRequired).toBe(4);
            expect(stats.unreplied).toBe(2);      // only unreplied
            expect(stats.needsAttention).toBe(2);  // only flagged
            // actionRequired > unreplied because it includes flagged replies
            expect(stats.actionRequired).toBeGreaterThan(stats.unreplied);
        });

        it('should push pageId into the WHERE clause for both FB and IG queries', async () => {
            // Capture the WHERE arg from each of the 2 parallel queries (FB + IG).
            // The chip counts on the comments page must reflect the active page filter,
            // otherwise the badges drift from the list and users see "0 results / 2 needs attention".
            const fbWhere = vi.fn().mockResolvedValue([{
                total: 0, replied: 0, needsAttention: 0, resolved: 0, actionRequired: 0,
                repliedToday: 0, ai: 0, template: 0, manual: 0,
            }]);
            const igWhere = vi.fn().mockResolvedValue([{
                total: 0, replied: 0, needsAttention: 0, resolved: 0, actionRequired: 0,
                repliedToday: 0, ai: 0, template: 0, manual: 0,
            }]);
            const buildChain = (where: typeof fbWhere) => ({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({ where }),
                    }),
                }),
            });
            vi.mocked(db.select)
                .mockReturnValueOnce(buildChain(fbWhere) as any)
                .mockReturnValueOnce(buildChain(igWhere) as any);

            await commentsService.getStats('user-scoped', { pageId: 'page_42' });

            expect(fbWhere).toHaveBeenCalledTimes(1);
            expect(igWhere).toHaveBeenCalledTimes(1);
            // Drizzle serializes pageId as a literal chunk inside the SQL object —
            // stringify is robust to internal shape changes across drizzle versions.
            expect(collectSqlValues(fbWhere.mock.calls[0][0])).toContain('page_42');
            expect(collectSqlValues(igWhere.mock.calls[0][0])).toContain('page_42');
        });

        it('should NOT include any pageId predicate when scope is workspace-wide', async () => {
            const fbWhere = vi.fn().mockResolvedValue([{
                total: 0, replied: 0, needsAttention: 0, resolved: 0, actionRequired: 0,
                repliedToday: 0, ai: 0, template: 0, manual: 0,
            }]);
            const igWhere = vi.fn().mockResolvedValue([{
                total: 0, replied: 0, needsAttention: 0, resolved: 0, actionRequired: 0,
                repliedToday: 0, ai: 0, template: 0, manual: 0,
            }]);
            const buildChain = (where: typeof fbWhere) => ({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({ where }),
                    }),
                }),
            });
            vi.mocked(db.select)
                .mockReturnValueOnce(buildChain(fbWhere) as any)
                .mockReturnValueOnce(buildChain(igWhere) as any);

            await commentsService.getStats('user-unscoped');

            // No specific pageId leaked into the WHERE — guards against accidental
            // hardcoded scope sneaking in via shared helpers.
            expect(collectSqlValues(fbWhere.mock.calls[0][0])).not.toContain('page_42');
            expect(collectSqlValues(igWhere.mock.calls[0][0])).not.toContain('page_42');
        });

        it('should handle zero comments', async () => {
            // Both queries return zeros
            vi.mocked(db.select)
                .mockReturnValueOnce(mockStatsQuery({
                    total: 0, replied: 0, needsAttention: 0, resolved: 0, actionRequired: 0,
                    repliedToday: 0, ai: 0, template: 0, manual: 0,
                }) as any)
                .mockReturnValueOnce(mockStatsQuery({
                    total: 0, replied: 0, needsAttention: 0, resolved: 0, actionRequired: 0,
                    repliedToday: 0, ai: 0, template: 0, manual: 0,
                }) as any);

            const stats = await commentsService.getStats('user-empty');

            expect(stats).toEqual({
                total: 0,
                replied: 0,
                unreplied: 0,
                needsAttention: 0,
                actionRequired: 0,
                resolved: 0,
                repliedToday: 0,
                replyRate: '0',
                byMethod: { template: 0, ai: 0, manual: 0, postReply: 0 },
                repliedTodayByMethod: { ai: 0, postReply: 0 },
            });
        });
    });
});
