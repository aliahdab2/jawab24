import { describe, it, expect, vi, beforeEach } from 'vitest';

// getStats wraps its query in withStatsCache, and test/setup.ts mocks the db but
// NOT redis — so without this the suite read and wrote a real local Redis. A
// workspace-wide getStats caches under a fixed key for 60s, so a second run inside
// that window was served from the cache, never called db.select, and left this
// file's queued mockReturnValueOnce unconsumed — shifting every later mock by one
// and failing unrelated tests (isFirstIncomingMessage among them). Order- and
// clock-dependent, and green in isolation.
//
// Same shape as src/__tests__/statsCache.test.ts, which is where the caching itself
// (including the epoch CAS) is asserted. Here `get` always misses, so every call
// computes and these tests can assert the QUERY they were written to assert.
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        eval: vi.fn().mockResolvedValue(1),
        del: vi.fn().mockResolvedValue(1),
        incr: vi.fn().mockResolvedValue(1),
    },
}));

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        query: {
            pages: { findMany: vi.fn() },
            messages: { findMany: vi.fn(), findFirst: vi.fn() },
            conversations: { findFirst: vi.fn() },
            conversationPauses: { findFirst: vi.fn() },
        },
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        execute: vi.fn(),
    }
}));

// Stub the conversations service — messages.ts delegates to it for the canonical
// sender_name + upsert. Returning a stable fake conversation lets us assert the
// message side of the write without testing conversations internals here.
vi.mock('../../src/services/conversations', () => ({
    conversationsService: {
        findOrCreate: vi.fn(async (pageId: string, senderId: string, platform: string, senderName?: string | null) => ({
            id: 'conv-fixture',
            pageId,
            senderId,
            platform,
            senderName: senderName ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
        })),
        findByPageAndSender: vi.fn(async () => null),
        getSenderName: vi.fn(async () => null),
        setSenderName: vi.fn(async () => undefined),
    },
}));

import { messagesService } from '../../src/services/messages';
import { db } from '../../src/db';
import { conversationsService } from '../../src/services/conversations';
import { collectSqlValues } from '../helpers/sqlInspect';

// Helper: stub the db.select().from().innerJoin().leftJoin().where().orderBy().limit() chain.
// Returns rows in the { msg, convSenderName } shape the service now expects.
// (innerJoin was added when getMessages switched to filter on messages.workspace_id +
//  enforce per-page autoReplyEnabled via a JOIN.)
function stubSelectJoin(rows: Array<Record<string, any>>, convName: string | null = null): void {
    const finalAwait = Promise.resolve(rows.map(r => ({ msg: r, convSenderName: convName })));
    const chain: any = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        leftJoin: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn(() => finalAwait),
    };
    vi.mocked(db.select).mockReturnValue(chain as any);
}

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
        it('should return empty when no messages match the workspace filter', async () => {
            // After workspace_id denormalization, getMessages filters directly on
            // messages.workspace_id — no separate page lookup. Empty workspace = empty rows.
            stubSelectJoin([]);

            const result = await messagesService.getMessages('user-1');

            expect(result.data).toEqual([]);
            expect(result.pagination).toEqual({ hasMore: false, nextCursor: null, limit: 50 });
        });

        it('should return messages with pagination', async () => {
            const rows = [mockDbRow({ id: 'msg-1' }), mockDbRow({ id: 'msg-2' })];
            stubSelectJoin(rows);

            const result = await messagesService.getMessages('user-1', { limit: 10 });

            expect(result.data).toHaveLength(2);
            expect(result.pagination.hasMore).toBe(false);
            expect(result.data[0].id).toBe('msg-1');
        });

        it('should detect hasMore when results exceed limit', async () => {
            const rows = [
                mockDbRow({ id: 'msg-1' }),
                mockDbRow({ id: 'msg-2' }),
                mockDbRow({ id: 'msg-3' }),
            ];
            stubSelectJoin(rows);

            const result = await messagesService.getMessages('user-1', { limit: 2 });

            expect(result.data).toHaveLength(2);
            expect(result.pagination.hasMore).toBe(true);
            expect(result.pagination.nextCursor).toBe('msg-2');
        });

        it('should resolve cursor to timestamp for pagination', async () => {
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(
                mockDbRow({ id: 'msg-cursor', createdAt: new Date('2026-01-15') }) as any
            );
            stubSelectJoin([]);

            await messagesService.getMessages('user-1', { cursor: 'msg-cursor' });

            expect(db.query.messages.findFirst).toHaveBeenCalled();
            expect(db.select).toHaveBeenCalled();
        });

        it('should prefer conversations.sender_name over messages.sender_name', async () => {
            // message.sender_name is the stale legacy value; conversation.sender_name is canonical
            const rows = [mockDbRow({ id: 'msg-1', senderName: 'Old Name' })];
            stubSelectJoin(rows, 'New Canonical Name');

            const result = await messagesService.getMessages('user-1');

            expect(result.data[0].senderName).toBe('New Canonical Name');
        });

        it('should fall back to messages.sender_name when no conversation is linked', async () => {
            const rows = [mockDbRow({ id: 'msg-1', senderName: 'Legacy Name' })];
            stubSelectJoin(rows, null);

            const result = await messagesService.getMessages('user-1');

            expect(result.data[0].senderName).toBe('Legacy Name');
        });
    });

    // ───────────────────────────────────────────
    // getMessagesByPage
    // ───────────────────────────────────────────
    describe('getMessagesByPage', () => {
        it('should return messages for a page', async () => {
            const rows = [mockDbRow(), mockDbRow({ id: 'msg-2' })];
            stubSelectJoin(rows);

            const result = await messagesService.getMessagesByPage('page-1');

            expect(result).toHaveLength(2);
            expect(result[0].pageId).toBe('page-1');
        });

        it('should return empty array when no messages', async () => {
            stubSelectJoin([]);

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
            stubSelectJoin(rows);

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
                'page-1', 'ws-1', 'fb-msg-1', 'sender-1', 'Hello'
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
                'page-1', 'ws-1', 'fb-msg-1', 'sender-1', 'Hello', 'Jane'
            );

            expect(result.isNew).toBe(false);
            expect(db.update).toHaveBeenCalled();
            expect(mockSet).toHaveBeenCalledWith({ senderName: 'Jane' });
        });

        it('should NOT update senderName when existing record already has a name', async () => {
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(mockDbRow({ senderName: 'John' }) as any);

            const result = await messagesService.findOrCreateFromWebhook(
                'page-1', 'ws-1', 'fb-msg-1', 'sender-1', 'Hello', 'Jane'
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
                'page-1', 'ws-1', 'fb-new', 'sender-1', 'Hello', 'John'
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

            const result = await messagesService.storeOutgoingMessage('page-1', 'ws-1', 'sender-1', 'You are welcome', 'ai');

            expect(result.id).toBe('out-1');
            expect(db.insert).toHaveBeenCalled();
        });

        /**
         * WhatsApp Coexistence groundwork: Meta echoes EVERY outbound message on a
         * coexistence number back to us — including the ones we sent via the API. The
         * echo handler tells "the merchant answered from their phone" apart from "we
         * answered" by looking the echoed wamid up among our stored outgoing rows.
         *
         * If our own wamid isn't stored, our replies come back looking like human
         * replies and the bot pauses itself after every message it sends.
         */
        it('stores the platform message id when the channel returns one', async () => {
            const inserted = mockDbRow({ id: 'out-wamid', direction: 'outgoing', replied: true });
            let capturedValues: Record<string, unknown> = {};
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockImplementation((vals) => {
                    capturedValues = vals;
                    return { returning: vi.fn().mockResolvedValue([inserted]) };
                }),
            } as any);

            await messagesService.storeOutgoingMessage(
                'page-1', 'ws-1', 'sender-1', 'Reply', 'ai',
                undefined, undefined, undefined, undefined, undefined,
                'wamid.HBgLOTY2NTAwMDAwMDAVAgARGBI5QTNDMkYzM0E1QjcyM0Q0RjIA',
            );

            expect(capturedValues.platformMessageId)
                .toBe('wamid.HBgLOTY2NTAwMDAwMDAVAgARGBI5QTNDMkYzM0E1QjcyM0Q0RjIA');
        });

        it('falls back to a synthetic id when the channel returns none (FB/IG)', async () => {
            const inserted = mockDbRow({ id: 'out-synth', direction: 'outgoing', replied: true });
            let capturedValues: Record<string, unknown> = {};
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockImplementation((vals) => {
                    capturedValues = vals;
                    return { returning: vi.fn().mockResolvedValue([inserted]) };
                }),
            } as any);

            await messagesService.storeOutgoingMessage('page-1', 'ws-1', 'sender-1', 'Reply', 'ai');

            // The column is NOT NULL + UNIQUE and predates any channel returning an id,
            // so the synthetic value must survive untouched for Messenger/Instagram.
            expect(capturedValues.platformMessageId).toMatch(/^reply_\d+_/);
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
            await messagesService.storeOutgoingMessage('page-1', 'ws-1', 'sender-1', 'Reply', 'ai');
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

            await messagesService.storeOutgoingMessage('page-1', 'ws-1', 'sender-1', 'Reply', 'ai');

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

            await messagesService.storeOutgoingMessage('page-1', 'ws-1', 'sender-1', 'Reply', 'ai');

            expect(capturedValues).not.toHaveProperty('senderName');
        });

        // Regression: comment-triggered DMs used to create conversations with null
        // senderName because the commenter's fromName (known at webhook time) was
        // never propagated. Surfaced as "Unknown User" in the dashboard.
        it('uses caller-supplied senderName (comment fromName) for conversation + legacy row', async () => {
            // No prior name in the DB — simulate a first-contact comment-triggered DM
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(null as any);
            const inserted = mockDbRow({ id: 'out-5', direction: 'outgoing', replied: true });
            let capturedValues: Record<string, unknown> = {};
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockImplementation((vals) => {
                    capturedValues = vals;
                    return { returning: vi.fn().mockResolvedValue([inserted]) };
                }),
            } as any);
            // conversationsService.findOrCreate should be called with the supplied name
            const { conversationsService } = await import('../../src/services/conversations');

            await messagesService.storeOutgoingMessage(
                'page-1', 'ws-1', 'sender-1', 'Reply', 'ai', undefined, 'Ali Ahdab',
            );

            expect(conversationsService.findOrCreate).toHaveBeenCalledWith(
                'page-1', 'sender-1', 'facebook', 'Ali Ahdab', undefined,
            );
            // Legacy messages.sender_name is also written
            expect(capturedValues.senderName).toBe('Ali Ahdab');
            expect(capturedValues.workspaceId).toBe('ws-1');
        });

        it('prefers caller-supplied senderName over existing conversation name', async () => {
            // Existing conversation has a stale name; caller has the freshest one (from FB webhook)
            const { conversationsService } = await import('../../src/services/conversations');
            vi.mocked(conversationsService.findByPageAndSender).mockResolvedValueOnce({
                id: 'c1', pageId: 'page-1', senderId: 'sender-1', platform: 'facebook',
                senderName: 'Old Name', createdAt: new Date(), updatedAt: new Date(),
            } as any);
            const inserted = mockDbRow({ id: 'out-6', direction: 'outgoing', replied: true });
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([inserted]) }),
            } as any);

            await messagesService.storeOutgoingMessage(
                'page-1', 'ws-1', 'sender-1', 'Reply', 'ai', undefined, 'Fresh Name',
            );

            expect(conversationsService.findOrCreate).toHaveBeenCalledWith(
                'page-1', 'sender-1', 'facebook', 'Fresh Name', undefined,
            );
        });

        it('forwards originContentId to findOrCreate (comment→DM origin linking)', async () => {
            const { conversationsService } = await import('../../src/services/conversations');
            vi.mocked(conversationsService.findByPageAndSender).mockResolvedValueOnce(null);
            const inserted = mockDbRow({ id: 'out-7', direction: 'outgoing', replied: true });
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([inserted]) }),
            } as any);

            await messagesService.storeOutgoingMessage(
                'page-1', 'ws-1', 'sender-1', 'Reply', 'ai', undefined, 'Ali', 'post-42',
            );

            expect(conversationsService.findOrCreate).toHaveBeenCalledWith(
                'page-1', 'sender-1', 'facebook', 'Ali', 'post-42',
            );
        });
    });

    // ───────────────────────────────────────────
    // getUnrepliedMessages
    // ───────────────────────────────────────────
    describe('getUnrepliedMessages', () => {
        it('should return empty when no rows match the workspace filter', async () => {
            // After denormalization, getUnrepliedMessages filters directly on
            // messages.workspace_id — no separate page lookup.
            vi.mocked(db.query.messages.findMany).mockResolvedValue([]);

            const result = await messagesService.getUnrepliedMessages('user-1');

            expect(result).toEqual([]);
        });

        it('should return unreplied incoming messages', async () => {
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
                mockDbRow({ id: 'msg-1', message: 'Hello', platformMessageId: 'fb-msg-1' }),
                mockDbRow({ id: 'msg-2', message: 'Are you there?', platformMessageId: 'fb-msg-2' }),
            ];
            vi.mocked(db.query.messages.findMany).mockResolvedValue(rows as any);

            const result = await messagesService.getUnrepliedFromSender('page-1', 'sender-1');

            expect(result).toHaveLength(2);
            // enrichmentStatus + createdAt are also returned now (used by the park check).
            expect(result[0]).toEqual(expect.objectContaining({ id: 'msg-1', message: 'Hello', platformMessageId: 'fb-msg-1', enrichmentStatus: null }));
            expect(result[1]).toEqual(expect.objectContaining({ id: 'msg-2', message: 'Are you there?', platformMessageId: 'fb-msg-2', enrichmentStatus: null }));
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
        it('should mark the consolidated messages (id-scoped) and exclude the current one', async () => {
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
                'page-1', 'sender-1', ['msg-1', 'msg-2', 'msg-3'], 'msg-3', 'Consolidated reply', 'ai'
            );

            expect(count).toBe(2);
            expect(db.update).toHaveBeenCalled();
            expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
                replied: true,
                replyText: 'Consolidated reply',
                replyMethod: 'ai',
            }));
        });

        it('should short-circuit (no UPDATE) when the id list is empty or only the excluded id', async () => {
            vi.mocked(db.update).mockClear();

            const count = await messagesService.markOlderMessagesAsReplied(
                'page-1', 'sender-1', ['msg-3'], 'msg-3', 'Reply', 'template'
            );

            expect(count).toBe(0);
            // Nothing to mark → no DB round-trip.
            expect(db.update).not.toHaveBeenCalled();
        });

        it('should return 0 when the UPDATE matches no rows', async () => {
            const mockSet = vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([]),
                }),
            });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            const count = await messagesService.markOlderMessagesAsReplied(
                'page-1', 'sender-1', ['msg-1', 'msg-2'], 'msg-2', 'Reply', 'template'
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
                            aiToday: 6,
                            postReplyToday: 2,
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
                byMethod: { template: 10, ai: 15, manual: 5, postReply: 0 },
                repliedTodayByMethod: { ai: 6, postReply: 2 },
                convTotal: 12,
                convActionRequired: 5,
                convAutoReplied: 8,
                convHandled: 0,
            });
        });

        it('should push pageId into the WHERE clause when stats are scoped to a page', async () => {
            // The chip counts on the messages page must reflect the active page filter,
            // otherwise the badges drift from the list and users see "0 results / 2 needs attention".
            const where = vi.fn().mockResolvedValue([{
                total: 0, replied: 0, needsAttention: 0, resolved: 0, actionRequired: 0,
                repliedToday: 0, ai: 0, template: 0, manual: 0,
                convTotal: 0, convActionRequired: 0, convAutoReplied: 0, convHandled: 0,
            }]);
            const mockChain = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({ where }),
                }),
            };
            vi.mocked(db.select).mockReturnValueOnce(mockChain as any);

            await messagesService.getStats('user-scoped', { pageId: 'page_42' });

            expect(where).toHaveBeenCalledTimes(1);
            // Drizzle serializes the param literal into the SQL chunks.
            expect(collectSqlValues(where.mock.calls[0][0])).toContain('page_42');
        });

        it('should NOT include any pageId predicate when scope is workspace-wide', async () => {
            const where = vi.fn().mockResolvedValue([{
                total: 0, replied: 0, needsAttention: 0, resolved: 0, actionRequired: 0,
                repliedToday: 0, ai: 0, template: 0, manual: 0,
                convTotal: 0, convActionRequired: 0, convAutoReplied: 0, convHandled: 0,
            }]);
            const mockChain = {
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({ where }),
                }),
            };
            vi.mocked(db.select).mockReturnValueOnce(mockChain as any);

            await messagesService.getStats('user-unscoped');

            expect(collectSqlValues(where.mock.calls[0][0])).not.toContain('page_42');
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
                byMethod: { template: 0, ai: 0, manual: 0, postReply: 0 },
                repliedTodayByMethod: { ai: 0, postReply: 0 },
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
            // Recent manual reply exists at 2026-02-01T00:00:00Z
            const manualReplyAt = new Date('2026-02-01');
            vi.mocked(db.query.messages.findFirst).mockResolvedValue(
                mockDbRow({ direction: 'outgoing', replyMethod: 'manual', createdAt: manualReplyAt }) as any
            );

            const result = await messagesService.getPauseStatus('page-1', 'sender-1');
            expect(result.paused).toBe(true);
            expect(result.reason).toBe('manual_reply');
            // The implicit handoff pause auto-resumes DEFAULT_HANDOFF_PAUSE_MINUTES (15)
            // after the manual reply, so the banner can show the resume countdown.
            expect(result.pausedUntil).toEqual(new Date(manualReplyAt.getTime() + 15 * 60 * 1000));
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
