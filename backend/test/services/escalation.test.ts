import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock the database before importing
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        update: vi.fn(),
    },
}));

// Mock notification service
vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: vi.fn().mockResolvedValue('notif-123'),
        sendNotification: vi.fn().mockResolvedValue('notif-123'),
    },
}));

// Mock schema exports (drizzle needs these for query building)
vi.mock('../../src/db/schema', () => ({
    comments: { id: 'id', postId: 'post_id', replied: 'replied', needsAttention: 'needs_attention', createdTime: 'created_time', flagReason: 'flag_reason', updatedAt: 'updated_at' },
    messages: { id: 'id', pageId: 'page_id', replied: 'replied', needsAttention: 'needs_attention', direction: 'direction', createdTime: 'created_time', flagReason: 'flag_reason', updatedAt: 'updated_at' },
    pages: { id: 'id', userId: 'user_id', name: 'name', autoReplyEnabled: 'auto_reply_enabled' },
    posts: { id: 'id', pageId: 'page_id' },
    settings: { userId: 'user_id', commentEscalationMinutes: 'comment_escalation_minutes', messageEscalationMinutes: 'message_escalation_minutes' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...args: unknown[]) => ({ args, op: 'and' })),
    sql: Object.assign(
        vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, type: 'sql' })),
        { join: vi.fn(() => ({ type: 'sql_join' })) }
    ),
}));

import { runEscalationSweep, startEscalationCron, stopEscalationCron } from '../../src/services/escalation';
import { db } from '../../src/db';
import { notificationService } from '../../src/services/notifications';

/**
 * Helper: mock the new batch-query pattern used by escalateComments / escalateMessages.
 *
 * After the N+1 fix, each function issues:
 *   1. ONE db.select() batch query (comments join pages join settings) → staleRows
 *   2. Per-user db.update() calls (still needed for different flag reasons per threshold)
 *
 * So a full runEscalationSweep() calls db.select() exactly TWICE:
 *   - Once for comments batch
 *   - Once for messages batch
 */
function mockBatchSelect(commentRows: any[], messageRows: any[]) {
    let callIdx = 0;
    const results = [commentRows, messageRows];

    (db.select as any).mockImplementation(() => {
        const idx = callIdx++;
        return {
            from: vi.fn().mockReturnValue({
                innerJoin: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        leftJoin: vi.fn().mockReturnValue({
                            where: vi.fn().mockResolvedValue(results[idx] || []),
                        }),
                    }),
                    leftJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue(results[idx] || []),
                    }),
                }),
            }),
        };
    });
}

describe('Escalation Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        (notificationService.sendNotification as any).mockResolvedValue('notif-123');
    });

    afterEach(() => {
        stopEscalationCron();
        vi.useRealTimers();
        vi.resetAllMocks();
    });

    describe('runEscalationSweep', () => {
        it('should skip when no stale items found', async () => {
            mockBatchSelect([], []);

            await runEscalationSweep();

            expect(db.update).not.toHaveBeenCalled();
            expect(notificationService.sendNotification).not.toHaveBeenCalled();
        });

        it('should escalate stale comments and send one notification per user', async () => {
            // Batch query returns 3 stale comments for user-1
            mockBatchSelect(
                [
                    { userId: 'user-1', itemId: 'c-1', pageName: 'My Page', thresholdMinutes: 60 },
                    { userId: 'user-1', itemId: 'c-2', pageName: 'My Page', thresholdMinutes: 60 },
                    { userId: 'user-1', itemId: 'c-3', pageName: 'My Page', thresholdMinutes: 60 },
                ],
                [] // no stale messages
            );

            (db.update as any).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            await runEscalationSweep();

            expect(db.update).toHaveBeenCalled();
            expect(notificationService.sendNotification).toHaveBeenCalledTimes(1);
            expect(notificationService.sendNotification).toHaveBeenCalledWith(
                'user-1',
                expect.objectContaining({
                    type: 'stale_comment',
                    data: { deepLink: '/comments?filter=flagged' },
                })
            );
        });

        it('should escalate stale messages and send notification', async () => {
            mockBatchSelect(
                [], // no stale comments
                [
                    { userId: 'user-2', itemId: 'm-1', pageName: 'Shop', thresholdMinutes: 15 },
                    { userId: 'user-2', itemId: 'm-2', pageName: 'Shop', thresholdMinutes: 15 },
                ]
            );

            (db.update as any).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            await runEscalationSweep();

            expect(db.update).toHaveBeenCalled();
            expect(notificationService.sendNotification).toHaveBeenCalledWith(
                'user-2',
                expect.objectContaining({
                    type: 'stale_message',
                    data: { deepLink: '/messages?filter=flagged', type: 'message' },
                })
            );
        });

        it('should handle multiple users independently from single batch', async () => {
            // Single batch returns stale items for two different users
            mockBatchSelect(
                [
                    { userId: 'user-a', itemId: 'c-a1', pageName: 'Page A', thresholdMinutes: 60 },
                    { userId: 'user-b', itemId: 'c-b1', pageName: 'Page B', thresholdMinutes: 120 },
                    { userId: 'user-b', itemId: 'c-b2', pageName: 'Page B', thresholdMinutes: 120 },
                ],
                []
            );

            (db.update as any).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            await runEscalationSweep();

            // Both users should get separate notifications
            expect(notificationService.sendNotification).toHaveBeenCalledTimes(2);
            expect(notificationService.sendNotification).toHaveBeenCalledWith(
                'user-a',
                expect.objectContaining({ data: { deepLink: '/comments?filter=flagged' } })
            );
            expect(notificationService.sendNotification).toHaveBeenCalledWith(
                'user-b',
                expect.objectContaining({ data: { deepLink: '/comments?filter=flagged' } })
            );
        });

        it('should skip rows with null userId', async () => {
            mockBatchSelect(
                [{ userId: null, itemId: 'c-1', pageName: null, thresholdMinutes: 60 }],
                [{ userId: null, itemId: 'm-1', pageName: null, thresholdMinutes: 30 }]
            );

            await runEscalationSweep();

            expect(db.update).not.toHaveBeenCalled();
            expect(notificationService.sendNotification).not.toHaveBeenCalled();
        });

        it('should not throw on database error', async () => {
            (db.select as any).mockImplementation(() => ({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({
                            leftJoin: vi.fn().mockReturnValue({
                                where: vi.fn().mockRejectedValue(new Error('DB connection lost')),
                            }),
                        }),
                    }),
                }),
            }));

            await expect(runEscalationSweep()).resolves.not.toThrow();
        });

        /**
         * REGRESSION TEST: Guard against N+1 query reintroduction.
         *
         * The old implementation called db.select() once per user (O(N) queries).
         * The new batch implementation calls db.select() exactly TWICE total
         * (once for comments, once for messages) regardless of user count.
         */
        it('should use exactly 2 SELECT queries regardless of user count (no N+1)', async () => {
            // 5 users × multiple stale items each — should still be only 2 SELECT calls
            mockBatchSelect(
                [
                    { userId: 'u1', commentId: 'c1', thresholdMinutes: 60 },
                    { userId: 'u2', commentId: 'c2', thresholdMinutes: 60 },
                    { userId: 'u3', commentId: 'c3', thresholdMinutes: 90 },
                    { userId: 'u4', commentId: 'c4', thresholdMinutes: 120 },
                    { userId: 'u5', commentId: 'c5', thresholdMinutes: 30 },
                ],
                [
                    { userId: 'u1', messageId: 'm1', thresholdMinutes: 30 },
                    { userId: 'u3', messageId: 'm3', thresholdMinutes: 15 },
                ]
            );

            (db.update as any).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            await runEscalationSweep();

            // Key assertion: exactly 2 db.select() calls (1 comments batch + 1 messages batch)
            // NOT 5+ calls (which would indicate per-user querying)
            expect(db.select).toHaveBeenCalledTimes(2);
        });
    });

    describe('startEscalationCron / stopEscalationCron', () => {
        it('should start and stop the cron interval', () => {
            startEscalationCron();
            expect(vi.getTimerCount()).toBe(1);

            stopEscalationCron();
            expect(vi.getTimerCount()).toBe(0);
        });

        it('should not start multiple crons', () => {
            startEscalationCron();
            startEscalationCron(); // Second call should be a no-op
            expect(vi.getTimerCount()).toBe(1);

            stopEscalationCron();
        });
    });
});
