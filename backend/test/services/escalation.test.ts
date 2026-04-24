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
        sendNotificationToWorkspace: vi.fn().mockResolvedValue(undefined),
        sendTemplateNotificationToWorkspace: vi.fn().mockResolvedValue(undefined),
    },
}));

// Mock schema exports (drizzle needs these for query building)
vi.mock('../../src/db/schema', () => ({
    comments: { id: 'id', postId: 'post_id', replied: 'replied', resolved: 'resolved', needsAttention: 'needs_attention', createdTime: 'created_time', createdAt: 'created_at', flagReason: 'flag_reason', updatedAt: 'updated_at', fromName: 'from_name', message: 'message' },
    instagramComments: { id: 'id', replied: 'replied', resolved: 'resolved', needsAttention: 'needs_attention', createdAt: 'created_at', flagReason: 'flag_reason', updatedAt: 'updated_at', fromName: 'from_name', message: 'message' },
    messages: { id: 'id', pageId: 'page_id', replied: 'replied', needsAttention: 'needs_attention', direction: 'direction', createdTime: 'created_time', flagReason: 'flag_reason', updatedAt: 'updated_at', senderName: 'sender_name', senderId: 'sender_id', message: 'message' },
    pages: { id: 'id', userId: 'user_id', workspaceId: 'workspace_id', name: 'name', autoReplyEnabled: 'auto_reply_enabled' },
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
import * as schema from '../../src/db/schema';
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

function mockDbUpdate(rowCount = 0) {
    const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount }),
    });
    (db.update as any).mockReturnValue({ set: setMock });
    return { setMock };
}

describe('Escalation Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        (notificationService.sendNotification as any).mockResolvedValue('notif-123');
        (notificationService.sendNotificationToWorkspace as any).mockResolvedValue(undefined);
    });

    afterEach(() => {
        stopEscalationCron();
        vi.useRealTimers();
        vi.resetAllMocks();
    });

    describe('runEscalationSweep', () => {
        it('should skip notifications when no stale items found', async () => {
            mockBatchSelect([], []);
            mockDbUpdate(0); // resolveStuckSpamComments runs but resolves 0 rows

            await runEscalationSweep();

            // resolveStuckSpamComments always issues 3 updates (FB comments + IG comments + messages)
            expect(db.update).toHaveBeenCalledTimes(3);
            // No escalation notifications because no stale real comments
            expect(notificationService.sendNotificationToWorkspace).not.toHaveBeenCalled();
        });

        it('should resolve stuck spam/punctuation comments before escalation runs', async () => {
            mockBatchSelect([], []);
            const { setMock } = mockDbUpdate(3); // 3 stuck spam items resolved per table

            await runEscalationSweep();

            // db.update must target all three surfaces: FB comments, IG comments, and
            // messages. Regression guard for the 2026-04-24 bug where punctuation-only
            // DMs (e.g. "..") weren't swept, then got flagged sla_no_reply after 15 min.
            const updatedTables = vi.mocked(db.update).mock.calls.map((c) => c[0]);
            expect(updatedTables).toContain(schema.comments);
            expect(updatedTables).toContain(schema.instagramComments);
            expect(updatedTables).toContain(schema.messages);

            // Each sweep must set resolved=true. Guards against someone flipping
            // the payload to needs_attention=false only — that would hide rows from
            // the SLA query but leave them visible as unreplied in the inbox.
            for (const call of setMock.mock.calls) {
                expect(call[0]).toMatchObject({ resolved: true });
            }

            // No escalation notifications — the resolved rows never reached escalation
            expect(notificationService.sendNotificationToWorkspace).not.toHaveBeenCalled();
        });

        it('should send individual notification per stale comment with customer context', async () => {
            mockBatchSelect(
                [
                    { workspaceId: 'ws-1', itemId: 'c-1', pageName: 'My Page', pageId: 'page-1', fromName: 'Ahmad', messageText: 'كم سعر المنتج؟', thresholdMinutes: 60 },
                    { workspaceId: 'ws-1', itemId: 'c-2', pageName: 'My Page', pageId: 'page-1', fromName: 'Sara', messageText: 'Hello, is this available?', thresholdMinutes: 60 },
                ],
                []
            );
            mockDbUpdate();

            await runEscalationSweep();

            expect(db.update).toHaveBeenCalled();
            // One notification per comment (fan-out to workspace members handled inside sendNotificationToWorkspace)
            expect(notificationService.sendNotificationToWorkspace).toHaveBeenCalledTimes(2);
            expect(notificationService.sendNotificationToWorkspace).toHaveBeenCalledWith(
                'ws-1',
                expect.objectContaining({
                    type: 'stale_comment',
                    titles: { en: 'Ahmad — My Page', ar: 'Ahmad — My Page' },
                    bodies: { en: 'كم سعر المنتج؟', ar: 'كم سعر المنتج؟' },
                    data: { commentId: 'c-1' },
                })
            );
            expect(notificationService.sendNotificationToWorkspace).toHaveBeenCalledWith(
                'ws-1',
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
                    { workspaceId: 'ws-2', itemId: 'm-1', pageName: 'Shop', pageId: 'page-1', senderName: 'Omar', senderId: 'sender-1', messageText: 'مرحبا', thresholdMinutes: 30 },
                ]
            );
            mockDbUpdate();

            await runEscalationSweep();

            expect(notificationService.sendNotificationToWorkspace).toHaveBeenCalledWith(
                'ws-2',
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
                    { workspaceId: 'ws-1', itemId: 'm-1', pageName: 'Shop', pageId: 'p1', senderName: 'Omar', senderId: 's1', messageText: 'مرحبا', thresholdMinutes: 30 },
                    { workspaceId: 'ws-1', itemId: 'm-2', pageName: 'Shop', pageId: 'p1', senderName: 'Omar', senderId: 's1', messageText: 'هل فيه خصم؟', thresholdMinutes: 30 },
                    // Different sender = separate notification
                    { workspaceId: 'ws-1', itemId: 'm-3', pageName: 'Shop', pageId: 'p1', senderName: 'Sara', senderId: 's2', messageText: 'Hi', thresholdMinutes: 30 },
                ]
            );
            mockDbUpdate();

            await runEscalationSweep();

            // 2 conversations = 2 workspace notifications (not 3)
            expect(notificationService.sendNotificationToWorkspace).toHaveBeenCalledTimes(2);
        });

        it('should handle multiple workspaces independently', async () => {
            mockBatchSelect(
                [
                    { workspaceId: 'ws-a', itemId: 'c-a1', pageName: 'Page A', pageId: 'pa', fromName: 'Ahmad', messageText: 'test', thresholdMinutes: 60 },
                    { workspaceId: 'ws-b', itemId: 'c-b1', pageName: 'Page B', pageId: 'pb', fromName: 'Sara', messageText: 'hello', thresholdMinutes: 120 },
                ],
                []
            );
            mockDbUpdate();

            await runEscalationSweep();

            expect(notificationService.sendNotificationToWorkspace).toHaveBeenCalledTimes(2);
            expect(notificationService.sendNotificationToWorkspace).toHaveBeenCalledWith(
                'ws-a',
                expect.objectContaining({ titles: { en: 'Ahmad — Page A', ar: 'Ahmad — Page A' } })
            );
            expect(notificationService.sendNotificationToWorkspace).toHaveBeenCalledWith(
                'ws-b',
                expect.objectContaining({ titles: { en: 'Sara — Page B', ar: 'Sara — Page B' } })
            );
        });

        it('should use "Unknown" when senderName is null', async () => {
            mockBatchSelect(
                [],
                [
                    { workspaceId: 'ws-1', itemId: 'm-1', pageName: 'Shop', pageId: 'p1', senderName: null, senderId: 's1', messageText: 'hi', thresholdMinutes: 30 },
                ]
            );
            mockDbUpdate();

            await runEscalationSweep();

            expect(notificationService.sendNotificationToWorkspace).toHaveBeenCalledWith(
                'ws-1',
                expect.objectContaining({
                    titles: { en: 'Unknown — Shop', ar: 'Unknown — Shop' },
                })
            );
        });

        it('should cap notifications at MAX_INDIVIDUAL_NOTIFICATIONS and send overflow', async () => {
            // 12 different senders = 12 conversations, should cap at 10 + 1 overflow
            const messageRows = Array.from({ length: 12 }, (_, i) => ({
                workspaceId: 'ws-1',
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

            // 10 individual + 1 overflow summary = 11 workspace notifications
            expect(notificationService.sendNotificationToWorkspace).toHaveBeenCalledTimes(11);

            // Last call should be overflow summary
            const lastCall = (notificationService.sendNotificationToWorkspace as any).mock.calls[10];
            expect(lastCall[1].titles.en).toContain('more conversations need attention');
            expect(lastCall[1].data.deepLink).toBe('/messages?filter=needs_action');
        });

        it('should truncate long message previews', async () => {
            const longMessage = 'a'.repeat(120);
            mockBatchSelect(
                [],
                [
                    { workspaceId: 'ws-1', itemId: 'm-1', pageName: 'Shop', pageId: 'p1', senderName: 'Omar', senderId: 's1', messageText: longMessage, thresholdMinutes: 30 },
                ]
            );
            mockDbUpdate();

            await runEscalationSweep();

            const call = (notificationService.sendNotificationToWorkspace as any).mock.calls[0];
            expect(call[1].bodies.en.length).toBeLessThanOrEqual(83); // 80 + "..."
            expect(call[1].bodies.en).toMatch(/\.\.\.$/);
        });

        it('should skip rows with null workspaceId', async () => {
            mockBatchSelect(
                [{ workspaceId: null, itemId: 'c-1', pageName: null, pageId: null, fromName: 'test', messageText: 'test', thresholdMinutes: 60 }],
                [{ workspaceId: null, itemId: 'm-1', pageName: null, pageId: null, senderName: null, senderId: null, messageText: null, thresholdMinutes: 30 }]
            );
            mockDbUpdate(0);

            await runEscalationSweep();

            // resolveStuckSpamComments still runs its 3 updates, but no escalation updates
            expect(db.update).toHaveBeenCalledTimes(3);
            expect(notificationService.sendNotificationToWorkspace).not.toHaveBeenCalled();
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
