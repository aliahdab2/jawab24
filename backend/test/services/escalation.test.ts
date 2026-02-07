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
    },
}));

// Mock schema exports (drizzle needs these for query building)
vi.mock('../../src/db/schema', () => ({
    comments: { id: 'id', postId: 'post_id', replied: 'replied', needsAttention: 'needs_attention', createdTime: 'created_time', flagReason: 'flag_reason', updatedAt: 'updated_at' },
    messages: { id: 'id', pageId: 'page_id', replied: 'replied', needsAttention: 'needs_attention', direction: 'direction', createdTime: 'created_time', flagReason: 'flag_reason', updatedAt: 'updated_at' },
    pages: { id: 'id', userId: 'user_id' },
    posts: { id: 'id', pageId: 'page_id' },
    settings: { userId: 'user_id', commentEscalationMinutes: 'comment_escalation_minutes', messageEscalationMinutes: 'message_escalation_minutes' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...args: unknown[]) => ({ args, op: 'and' })),
    lte: vi.fn((field, value) => ({ field, value, op: 'lte' })),
    sql: Object.assign(
        vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, type: 'sql' })),
        { join: vi.fn(() => ({ type: 'sql_join' })) }
    ),
}));

import { runEscalationSweep, startEscalationCron, stopEscalationCron } from '../../src/services/escalation';
import { db } from '../../src/db';
import { notificationService } from '../../src/services/notifications';

describe('Escalation Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        // Re-establish mock return value after clearAllMocks
        (notificationService.sendTemplateNotification as any).mockResolvedValue('notif-123');
    });

    afterEach(() => {
        stopEscalationCron();
        vi.useRealTimers();
        vi.resetAllMocks();
    });

    describe('runEscalationSweep', () => {
        it('should skip users with no stale comments', async () => {
            // Mock settings query - one user with default escalation
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockResolvedValue([
                    { userId: 'user-1', commentEscalationMinutes: 60 },
                ]),
            });

            // Mock stale comments query - none found
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({
                            where: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                }),
            });

            // Mock settings query for messages
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockResolvedValue([
                    { userId: 'user-1', messageEscalationMinutes: 30 },
                ]),
            });

            // Mock stale messages query - none found
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            await runEscalationSweep();

            // Should not have tried to update or notify
            expect(db.update).not.toHaveBeenCalled();
            expect(notificationService.sendTemplateNotification).not.toHaveBeenCalled();
        });

        it('should escalate stale comments and send notification', async () => {
            // Mock settings query for comments
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockResolvedValue([
                    { userId: 'user-1', commentEscalationMinutes: 60 },
                ]),
            });

            // Mock stale comments query - 3 stale comments found
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({
                            where: vi.fn().mockResolvedValue([
                                { commentId: 'c-1' },
                                { commentId: 'c-2' },
                                { commentId: 'c-3' },
                            ]),
                        }),
                    }),
                }),
            });

            // Mock batch update
            (db.update as any).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            // Mock settings query for messages
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockResolvedValue([
                    { userId: 'user-1', messageEscalationMinutes: 30 },
                ]),
            });

            // Mock stale messages query - none
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            await runEscalationSweep();

            // Should have updated the comments
            expect(db.update).toHaveBeenCalled();

            // Should have sent exactly one notification for the user
            expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith(
                'user-1',
                'stale_comment',
                { count: '3', minutes: '60' },
                { deepLink: '/comments?filter=flagged' }
            );
        });

        it('should escalate stale messages and send notification', async () => {
            // Mock settings query for comments - no users
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockResolvedValue([]),
            });

            // Mock settings query for messages
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockResolvedValue([
                    { userId: 'user-2', messageEscalationMinutes: 15 },
                ]),
            });

            // Mock stale messages query - 2 stale messages
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([
                            { messageId: 'm-1' },
                            { messageId: 'm-2' },
                        ]),
                    }),
                }),
            });

            // Mock batch update
            (db.update as any).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            await runEscalationSweep();

            expect(db.update).toHaveBeenCalled();
            expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith(
                'user-2',
                'stale_comment',
                { count: '2', minutes: '15' },
                { deepLink: '/messages?filter=flagged' }
            );
        });

        it('should handle multiple users independently', async () => {
            // Mock settings query for comments - two users
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockResolvedValue([
                    { userId: 'user-a', commentEscalationMinutes: 60 },
                    { userId: 'user-b', commentEscalationMinutes: 120 },
                ]),
            });

            // Mock stale comments for user-a (1 stale)
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({
                            where: vi.fn().mockResolvedValue([{ commentId: 'c-a1' }]),
                        }),
                    }),
                }),
            });

            // Mock update for user-a
            (db.update as any).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            // Mock stale comments for user-b (0 stale)
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({
                            where: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                }),
            });

            // Mock settings query for messages - same two users
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockResolvedValue([
                    { userId: 'user-a', messageEscalationMinutes: 30 },
                    { userId: 'user-b', messageEscalationMinutes: 30 },
                ]),
            });

            // Mock stale messages for user-a (0)
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            // Mock stale messages for user-b (0)
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            await runEscalationSweep();

            // Only user-a should get a notification (user-b had no stale items)
            expect(notificationService.sendTemplateNotification).toHaveBeenCalledTimes(1);
            expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith(
                'user-a',
                'stale_comment',
                { count: '1', minutes: '60' },
                { deepLink: '/comments?filter=flagged' }
            );
        });

        it('should skip users with null userId', async () => {
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockResolvedValue([
                    { userId: null, commentEscalationMinutes: 60 },
                ]),
            });

            // Mock settings for messages
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockResolvedValue([
                    { userId: null, messageEscalationMinutes: 30 },
                ]),
            });

            await runEscalationSweep();

            expect(db.update).not.toHaveBeenCalled();
            expect(notificationService.sendTemplateNotification).not.toHaveBeenCalled();
        });

        it('should use default thresholds when settings value is null', async () => {
            // User with null escalation minutes (defaults: 60 for comments, 30 for messages)
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockResolvedValue([
                    { userId: 'user-1', commentEscalationMinutes: null },
                ]),
            });

            // Mock stale comments query
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({
                            where: vi.fn().mockResolvedValue([{ commentId: 'c-1' }]),
                        }),
                    }),
                }),
            });

            // Mock update
            (db.update as any).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            // Mock settings for messages
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockResolvedValue([
                    { userId: 'user-1', messageEscalationMinutes: null },
                ]),
            });

            // Mock stale messages - none
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            await runEscalationSweep();

            // Should use default 60 min for comments
            expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith(
                'user-1',
                'stale_comment',
                { count: '1', minutes: '60' },
                { deepLink: '/comments?filter=flagged' }
            );
        });

        it('should not throw on database error', async () => {
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockRejectedValue(new Error('DB connection lost')),
            });

            // Should not throw
            await expect(runEscalationSweep()).resolves.not.toThrow();
        });
    });

    describe('startEscalationCron / stopEscalationCron', () => {
        it('should start and stop the cron interval', () => {
            // Start
            startEscalationCron();

            // Should have set an interval (setInterval called once internally + immediate run)
            expect(vi.getTimerCount()).toBe(1);

            // Stop
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
