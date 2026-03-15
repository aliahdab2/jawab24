import { describe, it, expect } from 'vitest';
import { messagesService } from '../../src/services/messages';
import { createTestUser, createTestPage, insertMessage, insertPause, testDb } from './setup';
import { eq, and } from 'drizzle-orm';
import { messages } from '../../src/db/schema';

describe('Messages Service — Integration (real Postgres)', () => {
    let pageId: string;
    const senderId = 'sender-123';

    beforeEach(async () => {
        // Truncation is handled by global setup; create fresh fixtures here
        const user = await createTestUser();
        const page = await createTestPage(user.id);
        pageId = page.id;
    });

    // =========================================================
    // Test 1: Debounce — hasNewerUnrepliedMessage
    // =========================================================
    describe('hasNewerUnrepliedMessage', () => {
        it('returns true when a newer unreplied message exists', async () => {
            // Insert 3 messages with increasing timestamps
            const msg1 = await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-oldest',
                message: 'Hello',
                createdAt: new Date('2026-01-01T10:00:00Z'),
            });
            await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-middle',
                message: 'Are you there?',
                createdAt: new Date('2026-01-01T10:00:01Z'),
            });
            const msg3 = await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-newest',
                message: 'Please reply',
                createdAt: new Date('2026-01-01T10:00:02Z'),
            });

            // Oldest message should be debounced (newer unreplied exists)
            const hasNewerForOldest = await messagesService.hasNewerUnrepliedMessage(
                pageId, senderId, 'dm-oldest',
            );
            expect(hasNewerForOldest).toBe(true);

            // Newest message should NOT be debounced (no newer unreplied)
            const hasNewerForNewest = await messagesService.hasNewerUnrepliedMessage(
                pageId, senderId, 'dm-newest',
            );
            expect(hasNewerForNewest).toBe(false);
        });

        it('ignores replied messages when checking for newer', async () => {
            // msg1 = unreplied, msg2 = replied (should be ignored)
            await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-first',
                message: 'Hello',
                createdAt: new Date('2026-01-01T10:00:00Z'),
            });
            await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-second-replied',
                message: 'Follow up',
                replied: true,
                createdAt: new Date('2026-01-01T10:00:01Z'),
            });

            // The only newer message is replied, so this should return false
            const hasNewer = await messagesService.hasNewerUnrepliedMessage(
                pageId, senderId, 'dm-first',
            );
            expect(hasNewer).toBe(false);
        });
    });

    // =========================================================
    // Test 2: Consolidation — getUnrepliedFromSender
    // =========================================================
    describe('getUnrepliedFromSender', () => {
        it('returns only unreplied messages ordered by createdAt ASC', async () => {
            // Insert 3 unreplied + 1 replied
            await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-a',
                message: 'First message',
                createdAt: new Date('2026-01-01T10:00:00Z'),
            });
            await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-b',
                message: 'Second message',
                createdAt: new Date('2026-01-01T10:00:01Z'),
            });
            // This one is replied — should be excluded
            await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-replied',
                message: 'Already handled',
                replied: true,
                createdAt: new Date('2026-01-01T10:00:02Z'),
            });
            await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-c',
                message: 'Third message',
                createdAt: new Date('2026-01-01T10:00:03Z'),
            });

            const unreplied = await messagesService.getUnrepliedFromSender(pageId, senderId);

            expect(unreplied).toHaveLength(3);
            expect(unreplied[0].message).toBe('First message');
            expect(unreplied[1].message).toBe('Second message');
            expect(unreplied[2].message).toBe('Third message');
        });

        it('returns empty array when all messages are replied', async () => {
            await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-done',
                message: 'Done',
                replied: true,
            });

            const unreplied = await messagesService.getUnrepliedFromSender(pageId, senderId);
            expect(unreplied).toHaveLength(0);
        });
    });

    // =========================================================
    // Test 3: Bulk mark — markOlderMessagesAsReplied
    // =========================================================
    describe('markOlderMessagesAsReplied', () => {
        it('marks all unreplied messages except the excluded one', async () => {
            const msg1 = await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-bulk-1',
                message: 'Msg 1',
                createdAt: new Date('2026-01-01T10:00:00Z'),
            });
            const msg2 = await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-bulk-2',
                message: 'Msg 2',
                createdAt: new Date('2026-01-01T10:00:01Z'),
            });
            const msg3 = await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-bulk-3',
                message: 'Msg 3',
                createdAt: new Date('2026-01-01T10:00:02Z'),
            });

            // Mark older messages as replied, excluding msg3 (the latest / primary)
            const markedCount = await messagesService.markOlderMessagesAsReplied(
                pageId, senderId, msg3.id, 'Consolidated reply', 'ai',
            );

            expect(markedCount).toBe(2);

            // Verify msg1 and msg2 are now replied
            const [updated1] = await testDb
                .select()
                .from(messages)
                .where(eq(messages.id, msg1.id));
            expect(updated1.replied).toBe(true);
            expect(updated1.replyText).toBe('Consolidated reply');
            expect(updated1.replyMethod).toBe('ai');

            const [updated2] = await testDb
                .select()
                .from(messages)
                .where(eq(messages.id, msg2.id));
            expect(updated2.replied).toBe(true);

            // Verify msg3 is still unreplied (excluded)
            const [updated3] = await testDb
                .select()
                .from(messages)
                .where(eq(messages.id, msg3.id));
            expect(updated3.replied).toBe(false);
        });

        it('returns 0 when no other unreplied messages exist', async () => {
            const msg = await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-only',
                message: 'Only message',
            });

            const markedCount = await messagesService.markOlderMessagesAsReplied(
                pageId, senderId, msg.id, 'Reply', 'template',
            );

            expect(markedCount).toBe(0);
        });
    });

    // =========================================================
    // Test 4: Handoff pause — isPaused (timestamp comparison)
    // =========================================================
    describe('isPaused', () => {
        it('returns true when an explicit pause is active (pausedUntil in the future)', async () => {
            const futureDate = new Date(Date.now() + 30 * 60 * 1000); // 30 min from now
            await insertPause(pageId, senderId, futureDate);

            const paused = await messagesService.isPaused(pageId, senderId);
            expect(paused).toBe(true);
        });

        it('returns false when the explicit pause has expired', async () => {
            const pastDate = new Date(Date.now() - 1000); // 1 second ago
            await insertPause(pageId, senderId, pastDate);

            const paused = await messagesService.isPaused(pageId, senderId);
            expect(paused).toBe(false);
        });

        it('returns true when a recent manual reply exists (implicit pause)', async () => {
            // Insert a manual outgoing reply from 5 minutes ago
            await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-manual-reply',
                message: 'I will handle this personally',
                direction: 'outgoing',
                replyMethod: 'manual',
                createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
            });

            // Default pause window is 30 min, so 5 min ago should still be paused
            const paused = await messagesService.isPaused(pageId, senderId);
            expect(paused).toBe(true);
        });

        it('returns false when manual reply is outside the pause window', async () => {
            // Insert a manual outgoing reply from 60 minutes ago
            await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-old-manual',
                message: 'Old manual reply',
                direction: 'outgoing',
                replyMethod: 'manual',
                createdAt: new Date(Date.now() - 60 * 60 * 1000), // 60 min ago
            });

            // Default window is 30 min, so 60 min ago should NOT be paused
            const paused = await messagesService.isPaused(pageId, senderId, 30);
            expect(paused).toBe(false);
        });

        it('does not trigger on non-manual outgoing messages', async () => {
            // AI-generated reply should NOT trigger implicit pause
            await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-ai-reply',
                message: 'Auto-generated reply',
                direction: 'outgoing',
                replyMethod: 'ai',
                createdAt: new Date(Date.now() - 5 * 60 * 1000),
            });

            const paused = await messagesService.isPaused(pageId, senderId);
            expect(paused).toBe(false);
        });
    });

    // =========================================================
    // Test 5: Pause/Resume lifecycle
    // =========================================================
    describe('pauseConversation / resumeConversation', () => {
        it('pause then resume returns not paused', async () => {
            await messagesService.pauseConversation(pageId, senderId, 30);
            expect(await messagesService.isPaused(pageId, senderId)).toBe(true);

            await messagesService.resumeConversation(pageId, senderId);
            expect(await messagesService.isPaused(pageId, senderId)).toBe(false);
        });
    });

    // =========================================================
    // Test 6: resolveConversation / unresolveConversation
    // =========================================================
    describe('resolveConversation', () => {
        it('resolves both replied and unreplied incoming messages', async () => {
            // Unreplied message
            const msg1 = await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-unreplied',
                message: 'Need help',
                replied: false,
            });
            // Replied message with needsAttention (e.g., "Information not in knowledge base")
            const msg2 = await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-flagged',
                message: 'How much does it cost?',
                replied: true,
                needsAttention: true,
            });
            // Outgoing reply (should NOT be resolved)
            const msg3 = await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-outgoing',
                message: 'Auto reply',
                direction: 'outgoing',
                replied: true,
            });

            const count = await messagesService.resolveConversation(pageId, senderId);

            // Both incoming messages resolved (unreplied + flagged-replied)
            expect(count).toBe(2);

            const [updated1] = await testDb.select().from(messages).where(eq(messages.id, msg1.id));
            expect(updated1.resolved).toBe(true);

            const [updated2] = await testDb.select().from(messages).where(eq(messages.id, msg2.id));
            expect(updated2.resolved).toBe(true);

            // Outgoing message should NOT be touched
            const [updated3] = await testDb.select().from(messages).where(eq(messages.id, msg3.id));
            expect(updated3.resolved).toBeFalsy();
        });

        it('returns 0 when all messages are already resolved', async () => {
            await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-already-resolved',
                message: 'Old message',
                resolved: true,
            });

            const count = await messagesService.resolveConversation(pageId, senderId);
            expect(count).toBe(0);
        });

        it('does not resolve messages from a different sender', async () => {
            await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-target',
                message: 'Target sender',
            });
            await insertMessage(pageId, 'other-sender', {
                facebookMessageId: 'dm-other',
                message: 'Other sender',
            });

            const count = await messagesService.resolveConversation(pageId, senderId);
            expect(count).toBe(1);

            // Other sender's message should remain unresolved
            const [otherMsg] = await testDb.select().from(messages)
                .where(and(eq(messages.senderId, 'other-sender'), eq(messages.pageId, pageId)));
            expect(otherMsg.resolved).toBeFalsy();
        });
    });

    describe('unresolveConversation', () => {
        it('unresolves all resolved incoming messages', async () => {
            const msg = await insertMessage(pageId, senderId, {
                facebookMessageId: 'dm-resolved',
                message: 'Was resolved',
                resolved: true,
                replied: true,
            });

            const count = await messagesService.unresolveConversation(pageId, senderId);
            expect(count).toBe(1);

            const [updated] = await testDb.select().from(messages).where(eq(messages.id, msg.id));
            expect(updated.resolved).toBe(false);
        });
    });
});
