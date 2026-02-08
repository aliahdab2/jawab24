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
    }
}));

// Helper: build a mock DB message row
function mockDbRow(overrides: Record<string, any> = {}) {
    return {
        id: 'msg-1',
        pageId: 'page-1',
        facebookMessageId: 'fb-msg-1',
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
                facebookMessageId: 'fb-new',
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
            expect(result.message.facebookMessageId).toBe('fb-msg-1');
            expect(db.insert).not.toHaveBeenCalled();
        });

        it('should create new message when not found', async () => {
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(null as any);
            const inserted = mockDbRow({ id: 'new-msg', facebookMessageId: 'fb-new' });
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
    });

    // ───────────────────────────────────────────
    // getStats (existing 2 tests preserved)
    // ───────────────────────────────────────────
    describe('getStats', () => {
        it('should return correct stats from aggregated query', async () => {
            const mockTotalQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{ count: 50 }])
                    })
                })
            };
            const mockRepliedQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{ count: 30 }])
                    })
                })
            };
            const mockNeedsAttentionQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{ count: 3 }])
                    })
                })
            };
            const mockByMethodQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            groupBy: vi.fn().mockResolvedValue([
                                { method: 'ai', count: 15 },
                                { method: 'template', count: 10 },
                                { method: 'manual', count: 5 },
                            ])
                        })
                    })
                })
            };

            vi.mocked(db.select)
                .mockReturnValueOnce(mockTotalQuery as any)
                .mockReturnValueOnce(mockRepliedQuery as any)
                .mockReturnValueOnce(mockNeedsAttentionQuery as any)
                .mockReturnValueOnce(mockByMethodQuery as any);

            const stats = await messagesService.getStats('user-123');

            expect(stats).toEqual({
                total: 50,
                replied: 30,
                pending: 17,
                needsAttention: 3,
                byMethod: { template: 10, ai: 15, manual: 5 }
            });
        });

        it('should handle zero messages', async () => {
            const mockTotalQuery = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{ count: 0 }])
                    })
                })
            };

            vi.mocked(db.select).mockReturnValue(mockTotalQuery as any);

            const stats = await messagesService.getStats('user-empty');

            expect(stats).toEqual({
                total: 0,
                replied: 0,
                pending: 0,
                needsAttention: 0,
                byMethod: { template: 0, ai: 0, manual: 0 }
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
    // isPaused (replaces isManuallyPaused)
    // ───────────────────────────────────────────
    describe('isPaused', () => {
        it('should return true when explicit pause is active', async () => {
            const futureDate = new Date(Date.now() + 30 * 60 * 1000);
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue(
                { id: 'pause-1', pageId: 'page-1', senderId: 'sender-1', pausedUntil: futureDate, createdAt: new Date() } as any
            );

            const result = await messagesService.isPaused('page-1', 'sender-1');

            expect(result).toBe(true);
        });

        it('should return true when implicit pause is active (recent manual reply)', async () => {
            // No explicit pause
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue(null as any);
            // But there is a recent manual reply
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

        it('should accept custom implicit pause duration', async () => {
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue(null as any);
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(null as any);

            const result = await messagesService.isPaused('page-1', 'sender-1', 60);

            expect(result).toBe(false);
            expect(db.query.conversationPauses.findFirst).toHaveBeenCalled();
            expect(db.query.messages.findFirst).toHaveBeenCalled();
        });
    });

    // ───────────────────────────────────────────
    // Conversation Pause (explicit pause/resume)
    // ───────────────────────────────────────────
    describe('pauseConversation', () => {
        it('should insert a pause with correct pausedUntil', async () => {
            const mockWhere = vi.fn().mockResolvedValue(undefined);
            vi.mocked(db.delete).mockReturnValue({
                where: mockWhere,
            } as any);
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockResolvedValue(undefined),
            } as any);

            const result = await messagesService.pauseConversation('page-1', 'sender-1', 45);

            expect(db.delete).toHaveBeenCalled();
            expect(db.insert).toHaveBeenCalled();
            expect(result.pausedUntil).toBeInstanceOf(Date);
            // Should be ~45 minutes in the future
            const diffMinutes = (result.pausedUntil.getTime() - Date.now()) / 60000;
            expect(diffMinutes).toBeGreaterThan(44);
            expect(diffMinutes).toBeLessThan(46);
        });

        it('should default to 30 minutes when no duration specified', async () => {
            vi.mocked(db.delete).mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            } as any);
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockResolvedValue(undefined),
            } as any);

            const result = await messagesService.pauseConversation('page-1', 'sender-1');

            const diffMinutes = (result.pausedUntil.getTime() - Date.now()) / 60000;
            expect(diffMinutes).toBeGreaterThan(29);
            expect(diffMinutes).toBeLessThan(31);
        });
    });

    describe('resumeConversation', () => {
        it('should delete the pause record', async () => {
            const mockWhere = vi.fn().mockResolvedValue(undefined);
            vi.mocked(db.delete).mockReturnValue({
                where: mockWhere,
            } as any);

            await messagesService.resumeConversation('page-1', 'sender-1');

            expect(db.delete).toHaveBeenCalled();
            expect(mockWhere).toHaveBeenCalled();
        });
    });

    describe('getPauseStatus', () => {
        it('should return paused=true with remaining minutes when explicit pause is active', async () => {
            const futureDate = new Date(Date.now() + 20 * 60 * 1000); // 20 min from now
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue(
                { id: 'pause-1', pageId: 'page-1', senderId: 'sender-1', pausedUntil: futureDate, createdAt: new Date() } as any
            );

            const result = await messagesService.getPauseStatus('page-1', 'sender-1');

            expect(result.paused).toBe(true);
            expect(result.pausedUntil).toEqual(futureDate);
            expect(result.remainingMinutes).toBeGreaterThan(18);
            expect(result.remainingMinutes).toBeLessThanOrEqual(20);
        });

        it('should return paused=false when no active pause', async () => {
            vi.mocked(db.query.conversationPauses.findFirst).mockResolvedValue(null as any);

            const result = await messagesService.getPauseStatus('page-1', 'sender-1');

            expect(result.paused).toBe(false);
            expect(result.pausedUntil).toBeNull();
            expect(result.remainingMinutes).toBeNull();
        });
    });
});
