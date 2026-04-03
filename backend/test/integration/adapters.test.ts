import { describe, it, expect } from 'vitest';
import { FacebookMessageAdapter } from '../../src/services/reply/adapters/facebookAdapter';
import { InstagramMessageAdapter } from '../../src/services/reply/adapters/instagramAdapter';
import { messagesService } from '../../src/services/messages';
import { createTestUser, createTestPage, insertMessage, testDb } from './setup';
import { eq } from 'drizzle-orm';
import { messages } from '../../src/db/schema';

describe('Platform Adapters — Integration (real Postgres)', () => {
    let pageId: string;
    const senderId = 'sender-adapter-test';

    beforeEach(async () => {
        const user = await createTestUser();
        const page = await createTestPage(user.id);
        pageId = page.id;
    });

    // =========================================================
    // Facebook Adapter
    // =========================================================
    describe('FacebookMessageAdapter.storeIncomingMessage', () => {
        const adapter = new FacebookMessageAdapter();

        it('creates a message with correct fields', async () => {
            const { message, isNew } = await adapter.storeIncomingMessage(
                pageId, 'fb-msg-001', senderId, 'Hello from Facebook', 'Ali',
            );

            expect(isNew).toBe(true);
            expect(message.id).toBeDefined();
            expect(message.replied).toBe(false);

            // Verify all fields in DB
            const [row] = await testDb.select().from(messages).where(eq(messages.id, message.id));
            expect(row.pageId).toBe(pageId);
            expect(row.senderId).toBe(senderId);
            expect(row.senderName).toBe('Ali');
            expect(row.message).toBe('Hello from Facebook');
            expect(row.direction).toBe('incoming');
            expect(row.platformMessageId).toBe('fb-msg-001');
        });

        it('returns existing message on duplicate (isNew=false)', async () => {
            const first = await adapter.storeIncomingMessage(
                pageId, 'fb-msg-dup', senderId, 'First', 'Ali',
            );
            const second = await adapter.storeIncomingMessage(
                pageId, 'fb-msg-dup', senderId, 'First', 'Ali',
            );

            expect(first.isNew).toBe(true);
            expect(second.isNew).toBe(false);
            expect(second.message.id).toBe(first.message.id);
        });

        it('updates senderName on duplicate when original was null', async () => {
            // First store without senderName
            await adapter.storeIncomingMessage(
                pageId, 'fb-msg-name', senderId, 'Hi', undefined,
            );

            // Second store with senderName
            await adapter.storeIncomingMessage(
                pageId, 'fb-msg-name', senderId, 'Hi', 'Ali Ahdab',
            );

            // Verify senderName was updated
            const [row] = await testDb
                .select()
                .from(messages)
                .where(eq(messages.platformMessageId, 'fb-msg-name'));
            expect(row.senderName).toBe('Ali Ahdab');
        });

        it('does NOT overwrite existing senderName with a different value', async () => {
            await adapter.storeIncomingMessage(
                pageId, 'fb-msg-keep', senderId, 'Hi', 'Original Name',
            );

            // Try to overwrite with different name
            await adapter.storeIncomingMessage(
                pageId, 'fb-msg-keep', senderId, 'Hi', 'New Name',
            );

            const [row] = await testDb
                .select()
                .from(messages)
                .where(eq(messages.platformMessageId, 'fb-msg-keep'));
            // Should keep the original name (upsert only fills null)
            expect(row.senderName).toBe('Original Name');
        });
    });

    describe('FacebookMessageAdapter.fetchSenderName — DB cache', () => {
        const adapter = new FacebookMessageAdapter();

        it('returns cached name from DB when available', async () => {
            // Pre-populate a message with a senderName
            await insertMessage(pageId, senderId, {
                platformMessageId: 'fb-cached-name',
                senderName: 'Cached Ali',
            });

            // fetchSenderName should return the cached name without calling the API
            // (the API call would fail since there's no real access token)
            const name = await adapter.fetchSenderName(senderId, 'fake-token', pageId);
            expect(name).toBe('Cached Ali');
        });
    });

    // =========================================================
    // Instagram Adapter
    // =========================================================
    describe('InstagramMessageAdapter.storeIncomingMessage', () => {
        const adapter = new InstagramMessageAdapter();

        it('creates a message with Instagram-specific fields', async () => {
            const { message, isNew } = await adapter.storeIncomingMessage(
                pageId, 'ig-msg-001', senderId, 'Hello from Instagram',
            );

            expect(isNew).toBe(true);
            expect(message.replied).toBe(false);

            const [row] = await testDb.select().from(messages).where(eq(messages.id, message.id));
            expect(row.platformMessageId).toBe('ig-msg-001');
            expect(row.platform).toBe('instagram');
            expect(row.direction).toBe('incoming');
            expect(row.message).toBe('Hello from Instagram');
        });

        it('returns existing message on duplicate Instagram message ID', async () => {
            const first = await adapter.storeIncomingMessage(
                pageId, 'ig-msg-dup', senderId, 'Hello',
            );
            const second = await adapter.storeIncomingMessage(
                pageId, 'ig-msg-dup', senderId, 'Hello',
            );

            expect(first.isNew).toBe(true);
            expect(second.isNew).toBe(false);
            expect(second.message.id).toBe(first.message.id);
        });
    });

    describe('InstagramMessageAdapter.getInternalMessageId', () => {
        const adapter = new InstagramMessageAdapter();

        it('returns raw Instagram message ID without prefix', () => {
            expect(adapter.getInternalMessageId('abc123')).toBe('abc123');
        });
    });

    // =========================================================
    // markAsReplied — shared by both adapters (uses messagesService)
    // =========================================================
    describe('markAsReplied state transition', () => {
        it('sets replied=true, replyText, replyMethod, and repliedAt', async () => {
            const msg = await insertMessage(pageId, senderId, {
                platformMessageId: 'fb-mark-test',
                message: 'Need help',
            });

            await messagesService.markAsReplied(
                msg.id, 'Here is your help', 'ai', false, undefined, 'QUESTION',
            );

            const [updated] = await testDb.select().from(messages).where(eq(messages.id, msg.id));
            expect(updated.replied).toBe(true);
            expect(updated.replyText).toBe('Here is your help');
            expect(updated.replyMethod).toBe('ai');
            expect(updated.needsAttention).toBe(false);
            expect(updated.aiIntent).toBe('QUESTION');
            expect(updated.repliedAt).toBeTruthy();
        });

        it('stores needsAttention and flagReason when flagged', async () => {
            const msg = await insertMessage(pageId, senderId, {
                platformMessageId: 'fb-flag-test',
                message: 'I am angry',
            });

            await messagesService.markAsReplied(
                msg.id, 'Sorry to hear that', 'ai', true, 'angry_customer', 'COMPLAINT',
            );

            const [updated] = await testDb.select().from(messages).where(eq(messages.id, msg.id));
            expect(updated.needsAttention).toBe(true);
            expect(updated.flagReason).toBe('angry_customer');
            expect(updated.aiIntent).toBe('COMPLAINT');
        });
    });
});
