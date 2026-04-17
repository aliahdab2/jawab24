import { describe, it, expect, vi, beforeEach } from 'vitest';
import { messagesService } from '../../src/services/messages';
import { db } from '../../src/db';

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        query: {
            pages: { findMany: vi.fn() },
            messages: { findMany: vi.fn(), findFirst: vi.fn() },
            conversationPauses: { findFirst: vi.fn() },
        },
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        execute: vi.fn(),
    }
}));

// Helper: build a mock DB message row
function mockDbRow(overrides: Record<string, any> = {}) {
    return {
        id: 'msg-1',
        pageId: 'page-1',
        platformMessageId: 'fb-msg-1',
        senderId: 'sender-1',
        senderName: 'John',
        message: 'Hello',
        direction: 'incoming',
        replied: false,
        replyText: null,
        replyMethod: null,
        createdTime: new Date('2026-02-01'),
        repliedAt: null,
        createdAt: new Date('2026-02-01'),
        updatedAt: null,
        needsAttention: false,
        flagReason: null,
        aiIntent: null,
        platform: 'facebook',
        ...overrides,
    };
}

describe('MessagesService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ───────────────────────────────────────────
    // getMessages
    // ───────────────────────────────────────────
    describe('getMessages', () => {
        it('should return empty when user has no pages', async () => {
            vi.mocked(db.query.pages.findMany).mockResolvedValue([]);

            const result = await messagesService.getMessages('user-1');

            expect(result.data).toEqual([]);
            expect(result.pagination).toEqual({ hasMore: false, nextCursor: null, limit: 50 });
        });

        it('should return messages with pagination', async () => {
            vi.mocked(db.query.pages.findMany).mockResolvedValue([{ id: 'page-1' }] as any);
            const rows = [mockDbRow({ id: 'msg-1' }), mockDbRow({ id: 'msg-2' })];
            vi.mocked(db.query.messages.findMany).mockResolvedValue(rows as any);

            const result = await messagesService.getMessages('user-1', { limit: 10 });

            expect(result.data).toHaveLength(2);
            expect(result.pagination.hasMore).toBe(false);
            expect(result.data[0].id).toBe('msg-1');
        });

        it('should detect hasMore when results exceed limit', async () => {
            vi.mocked(db.query.pages.findMany).mockResolvedValue([{ id: 'page-1' }] as any);
            // Return 3 rows when limit is 2 (service fetches limit+1)
            const rows = [
                mockDbRow({ id: 'msg-1' }),
                mockDbRow({ id: 'msg-2' }),
                mockDbRow({ id: 'msg-3' }),
            ];
            vi.mocked(db.query.messages.findMany).mockResolvedValue(rows as any);

            const result = await messagesService.getMessages('user-1', { limit: 2 });

            expect(result.data).toHaveLength(2);
            expect(result.pagination.hasMore).toBe(true);
            expect(result.pagination.nextCursor).toBe('msg-2');
        });

        it('should resolve cursor to timestamp for pagination', async () => {
            vi.mocked(db.query.pages.findMany).mockResolvedValue([{ id: 'page-1' }] as any);
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(
                mockDbRow({ id: 'msg-cursor', createdAt: new Date('2026-01-15') }) as any
            );
            vi.mocked(db.query.messages.findMany).mockResolvedValue([]);

            await messagesService.getMessages('user-1', { cursor: 'msg-cursor' });

            expect(db.query.messages.findFirst).toHaveBeenCalled();
            expect(db.query.messages.findMany).toHaveBeenCalled();
        });
    });

    // ───────────────────────────────────────────
    // getMessagesByPage
    // ───────────────────────────────────────────
    describe('getMessagesByPage', () => {
        it('should return messages for a page', async () => {
            const rows = [mockDbRow(), mockDbRow({ id: 'msg-2' })];
            vi.mocked(db.query.messages.findMany).mockResolvedValue(rows as any);

            const result = await messagesService.getMessagesByPage('page-1');

            expect(result).toHaveLength(2);
            expect(result[0].pageId).toBe('page-1');
        });

        it('should return empty array when no messages', async () => {
            vi.mocked(db.query.messages.findMany).mockResolvedValue([]);

            const result = await messagesService.getMessagesByPage('page-empty');

            expect(result).toEqual([]);
        });
    });

    // ───────────────────────────────────────────
    // getConversation
    // ───────────────────────────────────────────
    describe('getConversation', () => {
        it('should return messages between page and sender', async () => {
            const rows = [
                mockDbRow({ direction: 'incoming' }),
                mockDbRow({ id: 'msg-2', direction: 'outgoing', senderId: 'sender-1' }),
            ];
            vi.mocked(db.query.messages.findMany).mockResolvedValue(rows as any);

            const result = await messagesService.getConversation('page-1', 'sender-1');

            expect(result).toHaveLength(2);
        });
    });

    // ───────────────────────────────────────────
    // createMessage
    // ───────────────────────────────────────────
    describe('createMessage', () => {
        it('should insert and return the new message', async () => {
            const inserted = mockDbRow({ id: 'new-msg' });
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([inserted]),
                }),
            } as any);

            const result = await messagesService.createMessage({
                pageId: 'page-1',
                platformMessageId: 'fb-new',
                senderId: 'sender-1',
                senderName: 'John',
                message: 'Hi there',
            });

            expect(result.id).toBe('new-msg');
            expect(db.insert).toHaveBeenCalled();
        });
    });

    // ───────────────────────────────────────────
    // findOrCreateFromWebhook
    // ───────────────────────────────────────────
    describe('findOrCreateFromWebhook', () => {
        it('should return existing message when found', async () => {
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(mockDbRow() as any);

            const result = await messagesService.findOrCreateFromWebhook(
                'page-1', 'fb-msg-1', 'sender-1', 'Hello'
            );

            expect(result.isNew).toBe(false);
            expect(result.message.platformMessageId).toBe('fb-msg-1');
            expect(db.insert).not.toHaveBeenCalled();
        });

        it('should update senderName when existing record has null name', async () => {
            const existingNoName = mockDbRow({ senderName: null });
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(existingNoName as any);
            const mockSet = vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            const result = await messagesService.findOrCreateFromWebhook(
                'page-1', 'fb-msg-1', 'sender-1', 'Hello', 'Jane'
            );

            expect(result.isNew).toBe(false);
            expect(db.update).toHaveBeenCalled();
            expect(mockSet).toHaveBeenCalledWith({ senderName: 'Jane' });
        });

        it('should NOT update senderName when existing record already has a name', async () => {
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(mockDbRow({ senderName: 'John' }) as any);

            const result = await messagesService.findOrCreateFromWebhook(
                'page-1', 'fb-msg-1', 'sender-1', 'Hello', 'Jane'
            );

            expect(result.isNew).toBe(false);
            expect(db.update).not.toHaveBeenCalled();
        });

        it('should create new message when not found', async () => {
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(null as any);
            const inserted = mockDbRow({ id: 'new-msg', platformMessageId: 'fb-new' });
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([inserted]),
                }),
            } as any);

            const result = await messagesService.findOrCreateFromWebhook(
                'page-1', 'fb-new', 'sender-1', 'Hello', 'John'
            );

            expect(result.isNew).toBe(true);
            expect(result.message.id).toBe('new-msg');
        });
    });

    // ───────────────────────────────────────────
    // getSenderNameBySenderId
    // ───────────────────────────────────────────
    describe('getSenderNameBySenderId', () => {
        it('should return sender name when found in previous messages', async () => {
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(
                { senderName: 'Alice' } as any
            );

            const result = await messagesService.getSenderNameBySenderId('page-1', 'sender-1');

            expect(result).toBe('Alice');
        });

        it('should return null when no message has a sender name', async () => {
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(null as any);

            const result = await messagesService.getSenderNameBySenderId('page-1', 'sender-1');

            expect(result).toBeNull();
        });
    });

    // ───────────────────────────────────────────
    // markAsReplied
    // ───────────────────────────────────────────
    describe('markAsReplied', () => {
        it('should update message with reply details', async () => {
            const mockSet = vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            await messagesService.markAsReplied('msg-1', 'Thanks!', 'ai', true, 'low_confidence', 'QUESTION');

            expect(db.update).toHaveBeenCalled();
            expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
                replied: true,
                replyText: 'Thanks!',
                replyMethod: 'ai',
                needsAttention: true,
                flagReason: 'low_confidence',
                aiIntent: 'QUESTION',
            }));
        });

        it('should default needsAttention to false and flags to null', async () => {
            const mockSet = vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            await messagesService.markAsReplied('msg-1', 'Thanks!', 'template');

            expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
                needsAttention: false,
                flagReason: null,
                aiIntent: null,
            }));
        });
    });

    // ───────────────────────────────────────────
    // storeOutgoingMessage
    // ───────────────────────────────────────────
    describe('storeOutgoingMessage', () => {
        it('should insert an outgoing message record', async () => {
            const inserted = mockDbRow({ id: 'out-1', direction: 'outgoing', replied: true });
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([inserted]),
                }),
            } as any);

            const result = await messagesService.storeOutgoingMessage('page-1', 'sender-1', 'You are welcome', 'ai');

            expect(result.id).toBe('out-1');
            expect(db.insert).toHaveBeenCalled();
        });

        it('should set createdTime close to now', async () => {
            const inserted = mockDbRow({ id: 'out-2', direction: 'outgoing', replied: true });
            let capturedValues: Record<string, unknown> = {};
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockImplementation((vals) => {
                    capturedValues = vals;
                    return { returning: vi.fn().mockResolvedValue([inserted]) };
                }),
            } as any);

            const before = Date.now();
            await messagesService.storeOutgoingMessage('page-1', 'sender-1', 'Reply', 'ai');
            const after = Date.now();

            const stored = capturedValues.createdTime as Date;
            expect(stored.getTime()).toBeGreaterThanOrEqual(before);
            expect(stored.getTime()).toBeLessThanOrEqual(after);
        });

        // Regression: without this, UI shows "Unknown User" for conversations whose
        // latest messages are all outgoing. The frontend groups messages by senderId
        // and picks the first senderName it finds — so if the recent outgoing row is
        // null-named, the whole conversation displays nameless.
        it('should copy last known senderName onto the outgoing row', async () => {
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(
                { senderName: 'Nahed Hasan Allaw' } as any,
            );
            const inserted = mockDbRow({ id: 'out-3', direction: 'outgoing', replied: true });
            let capturedValues: Record<string, unknown> = {};
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockImplementation((vals) => {
                    capturedValues = vals;
                    return { returning: vi.fn().mockResolvedValue([inserted]) };
                }),
            } as any);

            await messagesService.storeOutgoingMessage('page-1', 'sender-1', 'Reply', 'ai');

            expect(capturedValues.senderName).toBe('Nahed Hasan Allaw');
        });

        it('should omit senderName field when no prior name is known', async () => {
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(null as any);
            const inserted = mockDbRow({ id: 'out-4', direction: 'outgoing', replied: true });
            let capturedValues: Record<string, unknown> = {};
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockImplementation((vals) => {
                    capturedValues = vals;
                    return { returning: vi.fn().mockResolvedValue([inserted]) };
                }),
            } as any);

            await messagesService.storeOutgoingMessage('page-1', 'sender-1', 'Reply', 'ai');

            expect(capturedValues).not.toHaveProperty('senderName');
        });
    });

    // ───────────────────────────────────────────
    // getUnrepliedMessages
    // ───────────────────────────────────────────
    describe('getUnrepliedMessages', () => {
        it('should return empty when user has no pages', async () => {
            vi.mocked(db.query.pages.findMany).mockResolvedValue([]);

            const result = await messagesService.getUnrepliedMessages('user-1');

            expect(result).toEqual([]);
        });

        it('should return unreplied incoming messages', async () => {
            vi.mocked(db.query.pages.findMany).mockResolvedValue([{ id: 'page-1' }] as any);
            const rows = [mockDbRow({ replied: false, direction: 'incoming' })];
            vi.mocked(db.query.messages.findMany).mockResolvedValue(rows as any);

            const result = await messagesService.getUnrepliedMessages('user-1');

            expect(result).toHaveLength(1);
            expect(result[0].replied).toBe(false);
        });
    });

    // ───────────────────────────────────────────
    // getConversationHistory
    // ───────────────────────────────────────────
    describe('getConversationHistory', () => {
        it('should return messages in chronological order with role mapping', async () => {
            const rows = [
                mockDbRow({ id: 'msg-2', direction: 'outgoing', message: 'Reply', createdAt: new Date('2026-02-02') }),
                mockDbRow({ id: 'msg-1', direction: 'incoming', message: 'Hello', createdAt: new Date('2026-02-01') }),
            ];
            vi.mocked(db.query.messages.findMany).mockResolvedValue(rows as any);

            const result = await messagesService.getConversationHistory('page-1', 'sender-1', 6);

            // Should be reversed to chronological
            expect(result[0].role).toBe('user');
            expect(result[0].content).toBe('Hello');
            expect(result[1].role).toBe('assistant');
            expect(result[1].content).toBe('Reply');
        });

        it('should return empty array when no conversation', async () => {
            vi.mocked(db.query.messages.findMany).mockResolvedValue([]);

            const result = await messagesService.getConversationHistory('page-1', 'sender-x');

            expect(result).toEqual([]);
        });
    });

    // ───────────────────────────────────────────
    // hasNewerUnrepliedMessage
    // ───────────────────────────────────────────
    describe('hasNewerUnrepliedMessage', () => {
        it('should return false when current message not found', async () => {
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(null as any);

            const result = await messagesService.hasNewerUnrepliedMessage('page-1', 'sender-1', 'fb-msg-1');

            expect(result).toBe(false);
        });

        it('should return false when current message has no createdAt', async () => {
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(
                mockDbRow({ createdAt: null }) as any
            );

            const result = await messagesService.hasNewerUnrepliedMessage('page-1', 'sender-1', 'fb-msg-1');

            expect(result).toBe(false);
        });

        it('should return true when newer unreplied message exists', async () => {
            vi.mocked(db.query.messages.findFirst)
                .mockResolvedValueOnce(mockDbRow({ createdAt: new Date('2026-02-01') }) as any)  // current
                .mockResolvedValueOnce(mockDbRow({ id: 'msg-newer' }) as any);  // newer exists

            const result = await messagesService.hasNewerUnrepliedMessage('page-1', 'sender-1', 'fb-msg-1');

            expect(result).toBe(true);
        });

        it('should return false when no newer unreplied message', async () => {
            vi.mocked(db.query.messages.findFirst)
                .mockResolvedValueOnce(mockDbRow({ createdAt: new Date('2026-02-01') }) as any)
                .mockResolvedValueOnce(null as any);  // no newer

            const result = await messagesService.hasNewerUnrepliedMessage('page-1', 'sender-1', 'fb-msg-1');

            expect(result).toBe(false);
        });

        it('should exclude the current message by ID to prevent microsecond precision self-matching', async () => {
            // BUG REGRESSION: PostgreSQL stores timestamps with μs precision
            // (e.g., 20:45:48.484573) but JS Date truncates to ms (20:45:48.484000).
            // Without excluding the current message by ID, the comparison
            // `created_at > '20:45:48.484'` would match the row itself
            // (484573μs > 484000μs), making every message skip itself as "newer pending".
            const currentMsg = mockDbRow({
                id: 'msg-current',
                platformMessageId: 'fb-msg-1',
                createdAt: new Date('2026-02-01T12:00:00.500Z'),
            });

            vi.mocked(db.query.messages.findFirst)
                .mockResolvedValueOnce(currentMsg as any)  // lookup current message
                .mockResolvedValueOnce(null as any);        // no truly newer message (self excluded by ne())

            const result = await messagesService.hasNewerUnrepliedMessage('page-1', 'sender-1', 'fb-msg-1');

            // Must return false: the only potential "newer" candidate was itself,
            // which is excluded via ne(messages.id, currentMsg.id)
            expect(result).toBe(false);
            expect(db.query.messages.findFirst).toHaveBeenCalledTimes(2);
        });

        it('should detect a genuinely newer message even with same-second timestamps', async () => {
            // Two messages arrive within the same second. The second call returns
            // a different message ID, proving the query doesn't accidentally
            // exclude legitimate newer messages.
            const currentMsg = mockDbRow({
                id: 'msg-1',
                platformMessageId: 'fb-msg-1',
                createdAt: new Date('2026-02-01T12:00:00.500Z'),
            });
            const newerMsg = mockDbRow({
                id: 'msg-2',
                platformMessageId: 'fb-msg-2',
                createdAt: new Date('2026-02-01T12:00:00.800Z'),
            });

            vi.mocked(db.query.messages.findFirst)
                .mockResolvedValueOnce(currentMsg as any)
                .mockResolvedValueOnce(newerMsg as any);  // genuinely newer message

            const result = await messagesService.hasNewerUnrepliedMessage('page-1', 'sender-1', 'fb-msg-1');

            expect(result).toBe(true);
        });
    });

    // ───────────────────────────────────────────
    // getUnrepliedFromSender
    // ───────────────────────────────────────────
    describe('getUnrepliedFromSender', () => {
        it('should return unreplied messages from sender in chronological order', async () => {
            const rows = [
                mockDbRow({ id: 'msg-1', message: 'Hello' }),
                mockDbRow({ id: 'msg-2', message: 'Are you there?' }),
            ];
            vi.mocked(db.query.messages.findMany).mockResolvedValue(rows as any);

            const result = await messagesService.getUnrepliedFromSender('page-1', 'sender-1');

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ id: 'msg-1', message: 'Hello' });
            expect(result[1]).toEqual({ id: 'msg-2', message: 'Are you there?' });
        });

        it('should return empty array when no unreplied messages', async () => {
            vi.mocked(db.query.messages.findMany).mockResolvedValue([]);

            const result = await messagesService.getUnrepliedFromSender('page-1', 'sender-1');

            expect(result).toEqual([]);
        });

        it('should pass limit:50 to prevent unbounded queries', async () => {
            vi.mocked(db.query.messages.findMany).mockResolvedValue([]);

            await messagesService.getUnrepliedFromSender('page-1', 'sender-1');

            expect(db.query.messages.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 50 }),
            );
        });
    });

    // ───────────────────────────────────────────
    // markOlderMessagesAsReplied
    // ───────────────────────────────────────────
    describe('markOlderMessagesAsReplied', () => {
        it('should mark older unreplied messages and exclude the current message', async () => {
            const mockSet = vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([
                        { id: 'msg-1' },
                        { id: 'msg-2' },
                    ]),
                }),
            });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            const count = await messagesService.markOlderMessagesAsReplied(
                'page-1', 'sender-1', 'msg-3', 'Consolidated reply', 'ai'
            );

            expect(count).toBe(2);
            expect(db.update).toHaveBeenCalled();
            expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
                replied: true,
                replyText: 'Consolidated reply',
                replyMethod: 'ai',
            }));
        });

        it('should return 0 when no older messages to mark', async () => {
            const mockSet = vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([]),
                }),
            });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            const count = await messagesService.markOlderMessagesAsReplied(
                'page-1', 'sender-1', 'msg-1', 'Reply', 'template'
            );

            expect(count).toBe(0);
        });
    });

    // ───────────────────────────────────────────
    // getStats — now uses a single query with FILTER
    // ───────────────────────────────────────────
    describe('getStats', () => {
        it('should return correct stats from aggregated query', async () => {
            // Single query returns all counts via FILTER (WHERE ...)
            const mockStatsQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{
                            total: 50,
                            replied: 30,
                            needsAttention: 3,
                            resolved: 0,
                            actionRequired: 23,  // 20 unreplied + 3 flagged
                            repliedToday: 8,
                            ai: 15,
                            template: 10,
                            manual: 5,
                            convTotal: 12,
                            convActionRequired: 5,
                            convAutoReplied: 8,
                            convHandled: 0,
                        }])
                    })
                })
            };

            vi.mocked(db.select).mockReturnValueOnce(mockStatsQuery as any);

            const stats = await messagesService.getStats('user-123');

            expect(stats).toEqual({
                total: 50,
                replied: 30,
                pending: 20,
                needsAttention: 3,
                actionRequired: 23,
                resolved: 0,
                autoReplied: 25,
                repliedToday: 8,
                byMethod: { template: 10, ai: 15, manual: 5 },
                convTotal: 12,
                convActionRequired: 5,
                convAutoReplied: 8,
                convHandled: 0,
            });
        });

        it('should handle zero messages', async () => {
            const mockStatsQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{
                            total: 0,
                            replied: 0,
                            needsAttention: 0,
                            resolved: 0,
                            actionRequired: 0,
                            repliedToday: 0,
                            ai: 0,
                            template: 0,
                            manual: 0,
                            convTotal: 0,
                            convActionRequired: 0,
                            convAutoReplied: 0,
                            convHandled: 0,
                        }])
                    })
                })
            };

            vi.mocked(db.select).mockReturnValue(mockStatsQuery as any);

            const stats = await messagesService.getStats('user-empty');

            expect(stats).toEqual({
                total: 0,
                replied: 0,
                pending: 0,
                needsAttention: 0,
                actionRequired: 0,
                resolved: 0,
                autoReplied: 0,
                repliedToday: 0,
                byMethod: { template: 0, ai: 0, manual: 0 },
                convTotal: 0,
                convActionRequired: 0,
                convAutoReplied: 0,
                convHandled: 0,
            });
        });
    });

    // ───────────────────────────────────────────
    // getMessageById
    // ───────────────────────────────────────────
    describe('getMessageById', () => {
        it('should return message with platform when found', async () => {
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(
                mockDbRow({ id: 'msg-1', platform: 'instagram' }) as any
            );

            const result = await messagesService.getMessageById('msg-1');

            expect(result).not.toBeNull();
            expect(result!.id).toBe('msg-1');
            expect(result!.platform).toBe('instagram');
        });

        it('should default platform to facebook', async () => {
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(
                mockDbRow({ id: 'msg-1', platform: null }) as any
            );

            const result = await messagesService.getMessageById('msg-1');

            expect(result!.platform).toBe('facebook');
        });

        it('should return null when not found', async () => {
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(null as any);

            const result = await messagesService.getMessageById('non-existent');

            expect(result).toBeNull();
        });
    });

    // ───────────────────────────────────────────
    // flagMessage
    // ───────────────────────────────────────────
    describe('flagMessage', () => {
        it('should set needsAttention=true without setting replied=true', async () => {
            const mockSet = vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            await messagesService.flagMessage('msg-1', 'offensive_or_abusive', 'OFFENSIVE');

            expect(db.update).toHaveBeenCalled();
            expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
                needsAttention: true,
                flagReason: 'offensive_or_abusive',
                aiIntent: 'OFFENSIVE',
            }));
            // Verify replied is NOT set
            expect(mockSet).not.toHaveBeenCalledWith(expect.objectContaining({
                replied: true,
            }));
        });

        it('should default flagReason and aiIntent to null when not provided', async () => {
            const mockSet = vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            await messagesService.flagMessage('msg-1');

            expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
                needsAttention: true,
                flagReason: null,
                aiIntent: null,
            }));
        });
    });

    // ───────────────────────────────────────────
    // isPaused (replaces isManuallyPaused)
    // ───────────────────────────────────────────
    describe('isPaused', () => {
        it('should return true when explicit pause is active', async () => {
            // Mock explicit pause found
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue({
                id: 'pause-1',
                pageId: 'page-1',
                senderId: 'sender-1',
                pausedUntil: new Date(Date.now() + 60000),
                createdAt: new Date(),
            } as any);

            const result = await messagesService.isPaused('page-1', 'sender-1');
            expect(result).toBe(true);
        });

        it('should return true when implicit manual reply pause is active (fallback)', async () => {
            // No explicit pause
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue(null as any);
            // But recent manual reply exists
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(
                mockDbRow({ direction: 'outgoing', replyMethod: 'manual' }) as any
            );

            const result = await messagesService.isPaused('page-1', 'sender-1');
            expect(result).toBe(true);
        });

        it('should return false when neither pause is active', async () => {
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue(null as any);
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(null as any);

            const result = await messagesService.isPaused('page-1', 'sender-1');
            expect(result).toBe(false);
        });
    });

    // ───────────────────────────────────────────
    // getRemainingPauseMs
    // ───────────────────────────────────────────
    describe('getRemainingPauseMs', () => {
        it('should return remaining ms from explicit pause', async () => {
            const tenMinFromNow = new Date(Date.now() + 10 * 60 * 1000);
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue({
                id: 'pause-1',
                pageId: 'page-1',
                senderId: 'sender-1',
                pausedUntil: tenMinFromNow,
                createdAt: new Date(),
            } as any);

            const remaining = await messagesService.getRemainingPauseMs('page-1', 'sender-1');

            // Should be close to 10 minutes (allow 2s tolerance for test execution)
            expect(remaining).toBeGreaterThan(9 * 60 * 1000);
            expect(remaining).toBeLessThanOrEqual(10 * 60 * 1000);
        });

        it('should return 0 when explicit pause has expired', async () => {
            const pastDate = new Date(Date.now() - 1000);
            // getExplicitPause uses gt(pausedUntil, now), so expired pause returns null
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue(null as any);
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(null as any);

            const remaining = await messagesService.getRemainingPauseMs('page-1', 'sender-1');

            expect(remaining).toBe(0);
        });

        it('should fall back to implicit pause from manual reply', async () => {
            // No explicit pause
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue(null as any);
            // Manual reply sent 5 minutes ago
            const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(
                mockDbRow({ direction: 'outgoing', replyMethod: 'manual', createdAt: fiveMinAgo }) as any
            );

            // With 15-min pause, 10 min should remain
            const remaining = await messagesService.getRemainingPauseMs('page-1', 'sender-1', 15);

            expect(remaining).toBeGreaterThan(9 * 60 * 1000);
            expect(remaining).toBeLessThanOrEqual(10 * 60 * 1000);
        });

        it('should return 0 when no pause of any kind is active', async () => {
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue(null as any);
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(null as any);

            const remaining = await messagesService.getRemainingPauseMs('page-1', 'sender-1');

            expect(remaining).toBe(0);
        });

        it('should prioritize explicit pause over implicit pause', async () => {
            // Explicit pause: 2 min remaining
            const twoMinFromNow = new Date(Date.now() + 2 * 60 * 1000);
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue({
                id: 'pause-1',
                pageId: 'page-1',
                senderId: 'sender-1',
                pausedUntil: twoMinFromNow,
                createdAt: new Date(),
            } as any);

            const remaining = await messagesService.getRemainingPauseMs('page-1', 'sender-1');

            // Should use explicit pause (~2 min), not implicit
            expect(remaining).toBeGreaterThan(1 * 60 * 1000);
            expect(remaining).toBeLessThanOrEqual(2 * 60 * 1000);
            // Should NOT query messages (explicit took precedence)
            expect(db.query.messages.findFirst).not.toHaveBeenCalled();
        });
    });

    // ───────────────────────────────────────────
    // pauseConversation / resumeConversation / getPauseStatus
    // ───────────────────────────────────────────
    describe('pauseConversation', () => {
        it('should delete existing pause and insert new one', async () => {
            vi.mocked(db.delete).mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            } as any);
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockResolvedValue(undefined),
            } as any);

            const result = await messagesService.pauseConversation('page-1', 'sender-1', 30);
            expect(result).toBeDefined();
            expect(result.pausedUntil).toBeDefined();
            expect(result.pausedUntil.getTime()).toBeGreaterThan(Date.now());
            expect(db.delete).toHaveBeenCalled();
            expect(db.insert).toHaveBeenCalled();
        });
    });

    describe('resumeConversation', () => {
        it('should delete the pause record', async () => {
            vi.mocked(db.delete).mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            } as any);

            await messagesService.resumeConversation('page-1', 'sender-1');
            expect(db.delete).toHaveBeenCalled();
        });
    });

    describe('getPauseStatus', () => {
        it('should return paused status when explicit pause is active', async () => {
            const futureDate = new Date(Date.now() + 15 * 60000);
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue({
                id: 'pause-1',
                pageId: 'page-1',
                senderId: 'sender-1',
                pausedUntil: futureDate,
                createdAt: new Date(),
            } as any);

            const result = await messagesService.getPauseStatus('page-1', 'sender-1');
            expect(result.paused).toBe(true);
            expect(result.pausedUntil).toEqual(futureDate);
            expect(result.reason).toBe('explicit');
        });

        it('should return paused via manual reply when no explicit pause exists', async () => {
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue(null as any);
            // Recent manual reply exists
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(
                mockDbRow({ direction: 'outgoing', replyMethod: 'manual' }) as any
            );

            const result = await messagesService.getPauseStatus('page-1', 'sender-1');
            expect(result.paused).toBe(true);
            expect(result.pausedUntil).toBeNull();
            expect(result.reason).toBe('manual_reply');
        });

        it('should return not paused when no active pause exists', async () => {
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue(null as any);
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(null as any);

            const result = await messagesService.getPauseStatus('page-1', 'sender-1');
            expect(result.paused).toBe(false);
            expect(result.pausedUntil).toBeNull();
            expect(result.reason).toBeNull();
        });
    });

    // ───────────────────────────────────────────
    // isFirstIncomingMessage
    // ───────────────────────────────────────────
    describe('isFirstIncomingMessage', () => {
        function mockSelectChain(rows: Record<string, unknown>[]) {
            const chain = {
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue(rows),
                    }),
                }),
            };
            vi.mocked(db.select).mockReturnValueOnce(chain as any);
        }

        it('should return true when no prior incoming messages exist', async () => {
            mockSelectChain([]);
            const result = await messagesService.isFirstIncomingMessage('page-1', 'sender-1');
            expect(result).toBe(true);
        });

        it('should return true when only 1 incoming message exists (current)', async () => {
            mockSelectChain([{ id: 'msg-1' }]);
            const result = await messagesService.isFirstIncomingMessage('page-1', 'sender-1');
            expect(result).toBe(true);
        });

        it('should return false when 2+ incoming messages exist', async () => {
            mockSelectChain([{ id: 'msg-1' }, { id: 'msg-2' }]);
            const result = await messagesService.isFirstIncomingMessage('page-1', 'sender-1');
            expect(result).toBe(false);
        });

        it('should return true when only outgoing messages exist (no incoming)', async () => {
            // The query filters direction='incoming', so outgoing-only returns empty
            mockSelectChain([]);
            const result = await messagesService.isFirstIncomingMessage('page-1', 'sender-1');
            expect(result).toBe(true);
        });
    });

    // ───────────────────────────────────────────
    // isRepeatQuestion
    // ───────────────────────────────────────────
    describe('isRepeatQuestion', () => {
        const now = Date.now();

        it('should return true when customer repeats same question within 5 min of AI reply', async () => {
            vi.mocked(db.query.messages.findMany).mockResolvedValue([
                // Most recent first (orderBy desc)
                { id: 'msg-3', message: 'What is the price?', direction: 'incoming', replyMethod: null, createdAt: new Date(now) },
                { id: 'msg-2', message: 'The price is 100 SAR.', direction: 'outgoing', replyMethod: 'ai', createdAt: new Date(now - 60_000) },
                { id: 'msg-1', message: 'What is the price?', direction: 'incoming', replyMethod: null, createdAt: new Date(now - 120_000) },
            ] as any);
            vi.mocked(db.execute).mockResolvedValue([{ sim: 0.9 }] as any);

            const result = await messagesService.isRepeatQuestion('page-1', 'sender-1', 'What is the price?');
            expect(result).toBe(true);
        });

        it('should return false when fewer than 2 messages exist', async () => {
            vi.mocked(db.query.messages.findMany).mockResolvedValue([
                { id: 'msg-1', message: 'Hello', direction: 'incoming', replyMethod: null, createdAt: new Date(now) },
            ] as any);

            const result = await messagesService.isRepeatQuestion('page-1', 'sender-1', 'Hello');
            expect(result).toBe(false);
        });

        it('should return false when no outgoing AI reply exists', async () => {
            vi.mocked(db.query.messages.findMany).mockResolvedValue([
                { id: 'msg-2', message: 'Hi again', direction: 'incoming', replyMethod: null, createdAt: new Date(now) },
                { id: 'msg-1', message: 'Hi', direction: 'incoming', replyMethod: null, createdAt: new Date(now - 60_000) },
            ] as any);

            const result = await messagesService.isRepeatQuestion('page-1', 'sender-1', 'Hi again');
            expect(result).toBe(false);
        });

        it('should return false when AI reply is older than 5 minutes', async () => {
            vi.mocked(db.query.messages.findMany).mockResolvedValue([
                { id: 'msg-3', message: 'What is the price?', direction: 'incoming', replyMethod: null, createdAt: new Date(now) },
                { id: 'msg-2', message: 'The price is 100 SAR.', direction: 'outgoing', replyMethod: 'ai', createdAt: new Date(now - 6 * 60_000) },
                { id: 'msg-1', message: 'What is the price?', direction: 'incoming', replyMethod: null, createdAt: new Date(now - 7 * 60_000) },
            ] as any);

            const result = await messagesService.isRepeatQuestion('page-1', 'sender-1', 'What is the price?');
            expect(result).toBe(false);
        });

        it('should return false when similarity is below threshold', async () => {
            vi.mocked(db.query.messages.findMany).mockResolvedValue([
                { id: 'msg-3', message: 'Something completely different', direction: 'incoming', replyMethod: null, createdAt: new Date(now) },
                { id: 'msg-2', message: 'The price is 100 SAR.', direction: 'outgoing', replyMethod: 'ai', createdAt: new Date(now - 60_000) },
                { id: 'msg-1', message: 'What is the price?', direction: 'incoming', replyMethod: null, createdAt: new Date(now - 120_000) },
            ] as any);
            vi.mocked(db.execute).mockResolvedValue([{ sim: 0.1 }] as any);

            const result = await messagesService.isRepeatQuestion('page-1', 'sender-1', 'Something completely different');
            expect(result).toBe(false);
        });

        it('should return false when preceding incoming message has no text', async () => {
            vi.mocked(db.query.messages.findMany).mockResolvedValue([
                { id: 'msg-3', message: 'Hello?', direction: 'incoming', replyMethod: null, createdAt: new Date(now) },
                { id: 'msg-2', message: 'Reply', direction: 'outgoing', replyMethod: 'ai', createdAt: new Date(now - 60_000) },
                { id: 'msg-1', message: null, direction: 'incoming', replyMethod: null, createdAt: new Date(now - 120_000) },
            ] as any);

            const result = await messagesService.isRepeatQuestion('page-1', 'sender-1', 'Hello?');
            expect(result).toBe(false);
        });

        it('should return false gracefully on DB error', async () => {
            vi.mocked(db.query.messages.findMany).mockRejectedValue(new Error('DB down'));

            const result = await messagesService.isRepeatQuestion('page-1', 'sender-1', 'Hello');
            expect(result).toBe(false);
        });
    });
});
