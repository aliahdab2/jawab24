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
    comments: { id: 'id', postId: 'post_id', replied: 'replied', needsAttention: 'needs_attention', createdTime: 'created_time', flagReason: 'flag_reason', updatedAt: 'updated_at', fromName: 'from_name', message: 'message' },
    messages: { id: 'id', pageId: 'page_id', replied: 'replied', needsAttention: 'needs_attention', direction: 'direction', createdTime: 'created_time', flagReason: 'flag_reason', updatedAt: 'updated_at', senderName: 'sender_name', senderId: 'sender_id', message: 'message' },
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
 * Helper: mock the batch-query pattern used by escalateComments / escalateMessages.
 *
 * Each function issues:
 *   1. ONE db.select() batch query → staleRows
 *   2. Per-user db.update() calls
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

function mockDbUpdate() {
    (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        }),
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

        it('should send individual notification per stale comment with customer context', async () => {
            mockBatchSelect(
                [
                    { userId: 'user-1', itemId: 'c-1', pageName: 'My Page', pageId: 'page-1', fromName: 'Ahmad', messageText: 'كم سعر المنتج؟', thresholdMinutes: 60 },
                    { userId: 'user-1', itemId: 'c-2', pageName: 'My Page', pageId: 'page-1', fromName: 'Sara', messageText: 'Hello, is this available?', thresholdMinutes: 60 },
                ],
                []
            );
            mockDbUpdate();

            await runEscalationSweep();

            expect(db.update).toHaveBeenCalled();
            // One notification per comment
            expect(notificationService.sendNotification).toHaveBeenCalledTimes(2);
            expect(notificationService.sendNotification).toHaveBeenCalledWith(
                'user-1',
                expect.objectContaining({
                    type: 'stale_comment',
                    titles: { en: 'Ahmad — My Page', ar: 'Ahmad — My Page' },
                    bodies: { en: 'كم سعر المنتج؟', ar: 'كم سعر المنتج؟' },
                    data: { commentId: 'c-1' },
                })
            );
            expect(notificationService.sendNotification).toHaveBeenCalledWith(
                'user-1',
                expect.objectContaining({
                    type: 'stale_comment',
                    titles: { en: 'Sara — My Page', ar: 'Sara — My Page' },
                    bodies: { en: 'Hello, is this available?', ar: 'Hello, is this available?' },
                    data: { commentId: 'c-2' },
                })
            );
        });

        it('should send per-conversation notification for stale messages', async () => {
            mockBatchSelect(
                [],
                [
                    { userId: 'user-2', itemId: 'm-1', pageName: 'Shop', pageId: 'page-1', senderName: 'Omar', senderId: 'sender-1', messageText: 'مرحبا', thresholdMinutes: 30 },
                ]
            );
            mockDbUpdate();

            await runEscalationSweep();

            expect(notificationService.sendNotification).toHaveBeenCalledWith(
                'user-2',
                expect.objectContaining({
                    type: 'stale_message',
                    titles: { en: 'Omar — Shop', ar: 'Omar — Shop' },
                    bodies: { en: 'مرحبا', ar: 'مرحبا' },
                    data: expect.objectContaining({
                        type: 'message',
                        messageId: 'm-1',
                        senderId: 'sender-1',
                        pageId: 'page-1',
                    }),
                })
            );
        });

        it('should group messages by conversation (senderId + pageId)', async () => {
            // Two messages from same sender on same page = ONE notification
            mockBatchSelect(
                [],
                [
                    { userId: 'user-1', itemId: 'm-1', pageName: 'Shop', pageId: 'p1', senderName: 'Omar', senderId: 's1', messageText: 'مرحبا', thresholdMinutes: 30 },
                    { userId: 'user-1', itemId: 'm-2', pageName: 'Shop', pageId: 'p1', senderName: 'Omar', senderId: 's1', messageText: 'هل فيه خصم؟', thresholdMinutes: 30 },
                    // Different sender = separate notification
                    { userId: 'user-1', itemId: 'm-3', pageName: 'Shop', pageId: 'p1', senderName: 'Sara', senderId: 's2', messageText: 'Hi', thresholdMinutes: 30 },
                ]
            );
            mockDbUpdate();

            await runEscalationSweep();

            // 2 conversations = 2 notifications (not 3)
            expect(notificationService.sendNotification).toHaveBeenCalledTimes(2);
        });

        it('should handle multiple users independently', async () => {
            mockBatchSelect(
                [
                    { userId: 'user-a', itemId: 'c-a1', pageName: 'Page A', pageId: 'pa', fromName: 'Ahmad', messageText: 'test', thresholdMinutes: 60 },
                    { userId: 'user-b', itemId: 'c-b1', pageName: 'Page B', pageId: 'pb', fromName: 'Sara', messageText: 'hello', thresholdMinutes: 120 },
                ],
                []
            );
            mockDbUpdate();

            await runEscalationSweep();

            expect(notificationService.sendNotification).toHaveBeenCalledTimes(2);
            expect(notificationService.sendNotification).toHaveBeenCalledWith(
                'user-a',
                expect.objectContaining({ titles: { en: 'Ahmad — Page A', ar: 'Ahmad — Page A' } })
            );
            expect(notificationService.sendNotification).toHaveBeenCalledWith(
                'user-b',
                expect.objectContaining({ titles: { en: 'Sara — Page B', ar: 'Sara — Page B' } })
            );
        });

        it('should use "Unknown" when senderName is null', async () => {
            mockBatchSelect(
                [],
                [
                    { userId: 'user-1', itemId: 'm-1', pageName: 'Shop', pageId: 'p1', senderName: null, senderId: 's1', messageText: 'hi', thresholdMinutes: 30 },
                ]
            );
            mockDbUpdate();

            await runEscalationSweep();

            expect(notificationService.sendNotification).toHaveBeenCalledWith(
                'user-1',
                expect.objectContaining({
                    titles: { en: 'Unknown — Shop', ar: 'Unknown — Shop' },
                })
            );
        });

        it('should cap notifications at MAX_INDIVIDUAL_NOTIFICATIONS and send overflow', async () => {
            // 12 different senders = 12 conversations, should cap at 10 + 1 overflow
            const messageRows = Array.from({ length: 12 }, (_, i) => ({
                userId: 'user-1',
                itemId: `m-${i}`,
                pageName: 'Shop',
                pageId: 'p1',
                senderName: `Customer ${i}`,
                senderId: `s-${i}`,
                messageText: `Message ${i}`,
                thresholdMinutes: 30,
            }));

            mockBatchSelect([], messageRows);
            mockDbUpdate();

            await runEscalationSweep();

            // 10 individual + 1 overflow summary = 11
            expect(notificationService.sendNotification).toHaveBeenCalledTimes(11);

            // Last call should be overflow summary
            const lastCall = (notificationService.sendNotification as any).mock.calls[10];
            expect(lastCall[1].titles.en).toContain('more conversations need attention');
            expect(lastCall[1].data.deepLink).toBe('/messages?filter=needs_action');
        });

        it('should truncate long message previews', async () => {
            const longMessage = 'a'.repeat(120);
            mockBatchSelect(
                [],
                [
                    { userId: 'user-1', itemId: 'm-1', pageName: 'Shop', pageId: 'p1', senderName: 'Omar', senderId: 's1', messageText: longMessage, thresholdMinutes: 30 },
                ]
            );
            mockDbUpdate();

            await runEscalationSweep();

            const call = (notificationService.sendNotification as any).mock.calls[0];
            expect(call[1].bodies.en.length).toBeLessThanOrEqual(83); // 80 + "..."
            expect(call[1].bodies.en).toMatch(/\.\.\.$/);
        });

        it('should skip rows with null userId', async () => {
            mockBatchSelect(
                [{ userId: null, itemId: 'c-1', pageName: null, pageId: null, fromName: 'test', messageText: 'test', thresholdMinutes: 60 }],
                [{ userId: null, itemId: 'm-1', pageName: null, pageId: null, senderName: null, senderId: null, messageText: null, thresholdMinutes: 30 }]
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
         */
        it('should use exactly 2 SELECT queries regardless of user count (no N+1)', async () => {
            const commentRows = Array.from({ length: 5 }, (_, i) => ({
                userId: `u${i}`, itemId: `c${i}`, pageName: 'Page', pageId: 'p1', fromName: `User ${i}`, messageText: 'test', thresholdMinutes: 60,
            }));
            const messageRows = [
                { userId: 'u1', itemId: 'm1', pageName: 'Shop', pageId: 'p2', senderName: 'Omar', senderId: 's1', messageText: 'hi', thresholdMinutes: 30 },
                { userId: 'u3', itemId: 'm3', pageName: 'Shop', pageId: 'p2', senderName: 'Sara', senderId: 's2', messageText: 'hey', thresholdMinutes: 15 },
            ];

            mockBatchSelect(commentRows, messageRows);
            mockDbUpdate();

            await runEscalationSweep();

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
