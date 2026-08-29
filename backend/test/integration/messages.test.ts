import { describe, it, expect } from 'vitest';
import { messagesService } from '../../src/services/messages';
import { createTestUser, createTestWorkspace, createTestPage, insertMessage, insertPause, testDb } from './setup';
import { eq, and } from 'drizzle-orm';
import { messages, conversations } from '../../src/db/schema';

describe('Messages Service — Integration (real Postgres)', () => {
    let pageId: string;
    let workspaceId: string;
    const senderId = 'sender-123';

    beforeEach(async () => {
        // Truncation is handled by global setup; create fresh fixtures here
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        workspaceId = workspace.id;
        const page = await createTestPage(user.id, { workspaceId });
        pageId = page.id;
    });

    // =========================================================
    // Test 1: Debounce — hasNewerUnrepliedMessage
    // =========================================================
    describe('hasNewerUnrepliedMessage', () => {
        it('returns true when a newer unreplied message exists', async () => {
            // Insert 3 messages with increasing timestamps
            const msg1 = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-oldest',
                message: 'Hello',
                createdAt: new Date('2026-01-01T10:00:00Z'),
            });
            await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-middle',
                message: 'Are you there?',
                createdAt: new Date('2026-01-01T10:00:01Z'),
            });
            const msg3 = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-newest',
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
                platformMessageId: 'dm-first',
                message: 'Hello',
                createdAt: new Date('2026-01-01T10:00:00Z'),
            });
            await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-second-replied',
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
                platformMessageId: 'dm-a',
                message: 'First message',
                createdAt: new Date('2026-01-01T10:00:00Z'),
            });
            await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-b',
                message: 'Second message',
                createdAt: new Date('2026-01-01T10:00:01Z'),
            });
            // This one is replied — should be excluded
            await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-replied',
                message: 'Already handled',
                replied: true,
                createdAt: new Date('2026-01-01T10:00:02Z'),
            });
            await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-c',
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
                platformMessageId: 'dm-done',
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
        it('marks the consolidated messages except the excluded one', async () => {
            const msg1 = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-bulk-1',
                message: 'Msg 1',
                createdAt: new Date('2026-01-01T10:00:00Z'),
            });
            const msg2 = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-bulk-2',
                message: 'Msg 2',
                createdAt: new Date('2026-01-01T10:00:01Z'),
            });
            const msg3 = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-bulk-3',
                message: 'Msg 3',
                createdAt: new Date('2026-01-01T10:00:02Z'),
            });

            // Mark the consolidated set as replied, excluding msg3 (the latest / primary)
            const markedCount = await messagesService.markOlderMessagesAsReplied(
                pageId, senderId, [msg1.id, msg2.id, msg3.id], msg3.id, 'Consolidated reply', 'ai',
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

        // Regression (silent-drop guard): a row that was NOT in the consolidated set —
        // e.g. an attachment stub whose enrichment finished mid-generation — must NOT be
        // swept replied by the id-scoped UPDATE.
        it('does NOT touch an unreplied row outside the consolidated id list', async () => {
            const consolidated1 = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-c1', message: 'C1', createdAt: new Date('2026-01-01T10:00:00Z'),
            });
            const primary = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-primary', message: 'Primary', createdAt: new Date('2026-01-01T10:00:01Z'),
            });
            // Landed after consolidation — outside the id list.
            const lateArrival = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-late', message: 'Late', createdAt: new Date('2026-01-01T10:00:02Z'),
            });

            const markedCount = await messagesService.markOlderMessagesAsReplied(
                pageId, senderId, [consolidated1.id, primary.id], primary.id, 'Reply', 'ai',
            );

            expect(markedCount).toBe(1); // only consolidated1
            const [late] = await testDb.select().from(messages).where(eq(messages.id, lateArrival.id));
            expect(late.replied).toBe(false); // survives — will be answered by its own job / recheck
        });

        it('returns 0 when the id list contains only the excluded message', async () => {
            const msg = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-only',
                message: 'Only message',
            });

            const markedCount = await messagesService.markOlderMessagesAsReplied(
                pageId, senderId, [msg.id], msg.id, 'Reply', 'template',
            );

            expect(markedCount).toBe(0);
        });
    });

    // =========================================================
    // Test 3b: Store-then-enrich — finalizeEnrichment + pending filters
    // =========================================================
    describe('finalizeEnrichment', () => {
        it("replaces the placeholder text and flips 'pending' → 'done' atomically", async () => {
            const stub = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-stub', message: '[صورة]', attachmentType: 'image', enrichmentStatus: 'pending',
            });

            const ok = await messagesService.finalizeEnrichment(stub.id, 'done', '[صورة: وصف الصورة]');
            expect(ok).toBe(true);

            const [row] = await testDb.select().from(messages).where(eq(messages.id, stub.id));
            expect(row.enrichmentStatus).toBe('done');
            expect(row.message).toBe('[صورة: وصف الصورة]');
        });

        it("on 'failed' keeps the placeholder text and only flips the status", async () => {
            const stub = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-stub-f', message: '[صورة]', attachmentType: 'image', enrichmentStatus: 'pending',
            });

            const ok = await messagesService.finalizeEnrichment(stub.id, 'failed');
            expect(ok).toBe(true);

            const [row] = await testDb.select().from(messages).where(eq(messages.id, stub.id));
            expect(row.enrichmentStatus).toBe('failed');
            expect(row.message).toBe('[صورة]');
        });

        it("is a no-op (returns false) on a row that is not 'pending' — guards against double-finalize", async () => {
            const stub = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-stub-done', message: '[صورة: first]', attachmentType: 'image', enrichmentStatus: 'done',
            });

            const ok = await messagesService.finalizeEnrichment(stub.id, 'done', '[صورة: SECOND]');
            expect(ok).toBe(false);

            const [row] = await testDb.select().from(messages).where(eq(messages.id, stub.id));
            expect(row.message).toBe('[صورة: first]'); // not clobbered
        });
    });

    describe('enrichment-aware debounce/consolidation', () => {
        it("hasNewerUnrepliedMessage ignores a newer 'pending' stub but counts a 'done' one", async () => {
            const text = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-text', message: 'q', createdAt: new Date('2026-01-01T10:00:00Z'),
            });
            // A newer stub still enriching — the text job must NOT defer to it.
            await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-pending', message: '[صورة]', attachmentType: 'image',
                enrichmentStatus: 'pending', createdAt: new Date('2026-01-01T10:00:01Z'),
            });
            expect(await messagesService.hasNewerUnrepliedMessage(pageId, senderId, 'dm-text')).toBe(false);

            // Once that stub is 'done', its reply job is guaranteed → debounce applies.
            await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-done', message: '[صورة: وصف]', attachmentType: 'image',
                enrichmentStatus: 'done', createdAt: new Date('2026-01-01T10:00:02Z'),
            });
            expect(await messagesService.hasNewerUnrepliedMessage(pageId, senderId, 'dm-text')).toBe(true);
            expect(text).toBeTruthy();
        });

        it('getUnrepliedFromSender returns enrichmentStatus for park decisions', async () => {
            await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-p', message: '[صورة]', attachmentType: 'image', enrichmentStatus: 'pending',
            });
            const rows = await messagesService.getUnrepliedFromSender(pageId, senderId);
            expect(rows.find(r => r.platformMessageId === 'dm-p')?.enrichmentStatus).toBe('pending');
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
                platformMessageId: 'dm-manual-reply',
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
                platformMessageId: 'dm-old-manual',
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
                platformMessageId: 'dm-ai-reply',
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
                platformMessageId: 'dm-unreplied',
                message: 'Need help',
                replied: false,
            });
            // Replied message with needsAttention (e.g., "Information not in knowledge base")
            const msg2 = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-flagged',
                message: 'How much does it cost?',
                replied: true,
                needsAttention: true,
            });
            // Outgoing reply (should NOT be resolved)
            const msg3 = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-outgoing',
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
                platformMessageId: 'dm-already-resolved',
                message: 'Old message',
                resolved: true,
            });

            const count = await messagesService.resolveConversation(pageId, senderId);
            expect(count).toBe(0);
        });

        it('does not resolve messages from a different sender', async () => {
            await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-target',
                message: 'Target sender',
            });
            await insertMessage(pageId, 'other-sender', {
                platformMessageId: 'dm-other',
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
                platformMessageId: 'dm-resolved',
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

    // Regression: comment-triggered DM path used to create conversations with null
    // senderName because fromName wasn't propagated. End-to-end via real Postgres.
    describe('storeOutgoingMessage — canonical senderName wiring', () => {
        it('creates a conversation with the caller-supplied senderName (first contact)', async () => {
            // No prior message for this sender — simulate a customer who only commented
            // and never DM'd us first. Caller supplies fromName from the comment webhook.
            await messagesService.storeOutgoingMessage(
                pageId, workspaceId, senderId, 'Welcome aboard!', 'ai', undefined, 'Ali Ahdab',
            );

            const [conv] = await testDb
                .select()
                .from(conversations)
                .where(and(
                    eq(conversations.pageId, pageId),
                    eq(conversations.senderId, senderId),
                ));
            expect(conv).toBeDefined();
            expect(conv.senderName).toBe('Ali Ahdab');
        });

        it('links the outgoing message to the newly-created conversation', async () => {
            const outgoing = await messagesService.storeOutgoingMessage(
                pageId, workspaceId, senderId, 'Details sent', 'ai', undefined, 'Nahed Hasan',
            );

            const [row] = await testDb.select().from(messages).where(eq(messages.id, outgoing.id));
            expect(row.conversationId).not.toBeNull();
            expect(row.senderName).toBe('Nahed Hasan'); // legacy column also written
            // Denormalized workspace_id must be populated on outgoing messages too.
            expect(row.workspaceId).toBe(workspaceId);

            // The conversation_id points at the conversations row for this sender
            const [conv] = await testDb
                .select()
                .from(conversations)
                .where(eq(conversations.id, row.conversationId!));
            expect(conv.senderName).toBe('Nahed Hasan');
        });

        it('does NOT overwrite an existing conversation name with an empty/undefined one', async () => {
            // Seed a named conversation via a prior incoming message
            await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-in',
                senderName: 'Original Name',
                direction: 'incoming',
            });

            // Store outgoing without supplying a name — should keep Original Name
            await messagesService.storeOutgoingMessage(pageId, workspaceId, senderId, 'Reply', 'ai');

            const [conv] = await testDb
                .select()
                .from(conversations)
                .where(and(
                    eq(conversations.pageId, pageId),
                    eq(conversations.senderId, senderId),
                ));
            expect(conv.senderName).toBe('Original Name');
        });
    });

    // =========================================================
    // getConversation chat ordering — regression guard for the
    // image-appears-after-its-own-nudge bug (screenshots 2026-05-20).
    //
    // The non-text handler does network calls (fetch_sender_name) BEFORE
    // inserting the image row, while the outgoing nudge it sends right
    // after gets inserted on a faster path. Sorting purely by `created_at`
    // (DB insert time) therefore puts the nudge above the image in the
    // chat UI, even though the customer sent the image first. The fix
    // sorts by `COALESCE(created_time, created_at)` — `created_time` is
    // the platform-reported send time (FB/IG webhook `timestamp`), which
    // can't be skewed by our processing latency.
    //
    // This test fails if anyone reverts the COALESCE in getConversation
    // or stops calling messagesService.setCreatedTime in the webhook /
    // non-text handler paths.
    // =========================================================
    describe('getConversation — ordering by platform send time', () => {
        it('orders by created_time (platform send time), not created_at (DB insert time)', async () => {
            // Real-world ordering of events from FB/IG's perspective:
            //   T=0  customer sends image
            //   T=1  bot sends auto-reply nudge
            //
            // What actually happens to our DB rows:
            //   image row     created_time=T=0   created_at=T=2.0  (slow non-text handler path)
            //   nudge row     created_time=T=1   created_at=T=1.5  (fast outgoing insert)
            //
            // created_at order would render nudge above image — that's the bug.
            // created_time order renders image above nudge — that's correct.
            const sendT0 = new Date('2026-05-20T10:00:00.000Z');
            const sendT1 = new Date('2026-05-20T10:00:01.000Z');
            const insertImage = new Date('2026-05-20T10:00:02.000Z');
            const insertNudge = new Date('2026-05-20T10:00:01.500Z');

            await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-image',
                message: '[Image]',
                direction: 'incoming',
                attachmentType: 'image',
                createdTime: sendT0,
                createdAt: insertImage,
            });
            await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-nudge',
                message: 'Please send text or voice',
                direction: 'outgoing',
                replied: true,
                createdTime: sendT1,
                createdAt: insertNudge,
            });

            const result = await messagesService.getConversation(pageId, senderId);

            // `getConversation` returns DESC (most recent first). With correct
            // ordering: nudge (sendT1) before image (sendT0).
            expect(result).toHaveLength(2);
            expect(result[0].platformMessageId).toBe('dm-nudge');
            expect(result[1].platformMessageId).toBe('dm-image');
        });

        it('falls back to created_at when created_time is null (legacy rows)', async () => {
            // Defends the COALESCE fallback: pre-fix rows that never got
            // created_time populated must still sort correctly by created_at.
            const t0 = new Date('2026-05-20T10:00:00.000Z');
            const t1 = new Date('2026-05-20T10:00:01.000Z');

            await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-legacy-old',
                message: 'older legacy',
                direction: 'incoming',
                createdTime: null,
                createdAt: t0,
            });
            await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-legacy-new',
                message: 'newer legacy',
                direction: 'incoming',
                createdTime: null,
                createdAt: t1,
            });

            const result = await messagesService.getConversation(pageId, senderId);

            expect(result).toHaveLength(2);
            expect(result[0].platformMessageId).toBe('dm-legacy-new');
            expect(result[1].platformMessageId).toBe('dm-legacy-old');
        });
    });

    // =========================================================
    // setCreatedTime — webhook layer stamps platform send time
    // =========================================================
    describe('setCreatedTime', () => {
        it('updates created_time without touching other columns', async () => {
            const insertAt = new Date('2026-05-20T10:00:02.000Z');
            const platformSendAt = new Date('2026-05-20T10:00:00.000Z');

            const inserted = await insertMessage(pageId, senderId, {
                platformMessageId: 'dm-stamp',
                message: 'hello',
                direction: 'incoming',
                createdTime: insertAt,
                createdAt: insertAt,
            });

            await messagesService.setCreatedTime(inserted.id, platformSendAt);

            const [row] = await testDb
                .select()
                .from(messages)
                .where(eq(messages.id, inserted.id));

            expect(row.createdTime?.getTime()).toBe(platformSendAt.getTime());
            // Other columns must be untouched
            expect(row.message).toBe('hello');
            expect(row.platformMessageId).toBe('dm-stamp');
            expect(row.direction).toBe('incoming');
        });
    });

    // =========================================================
    // storeOutgoingMessage — platform stamping
    // =========================================================
    // Regression: the outgoing insert omitted `platform`, so the column default
    // ('facebook') mislabeled every WhatsApp/Instagram reply (2026-07-08 pilot).
    describe('storeOutgoingMessage platform stamping', () => {
        it('stamps the conversation platform on the outgoing row (whatsapp)', async () => {
            await testDb.insert(conversations).values({
                pageId, senderId, platform: 'whatsapp', senderName: 'Pilot Customer',
            });

            const saved = await messagesService.storeOutgoingMessage(
                pageId, workspaceId, senderId, 'أهلاً! كيف أقدر أساعدك؟', 'ai',
            );

            const [row] = await testDb.select().from(messages).where(eq(messages.id, saved.id));
            expect(row.platform).toBe('whatsapp');
            expect(row.direction).toBe('outgoing');
        });

        it('defaults to facebook when no prior conversation exists', async () => {
            const saved = await messagesService.storeOutgoingMessage(
                pageId, workspaceId, 'fresh-sender-no-convo', 'Hello!', 'ai',
            );

            const [row] = await testDb.select().from(messages).where(eq(messages.id, saved.id));
            expect(row.platform).toBe('facebook');
        });

        // A WhatsApp Coexistence echo can be the FIRST row for a customer. Without
        // the caller's platform the row AND its new conversation were stamped
        // `facebook` on a WhatsApp page — permanently, since findOrCreate never
        // rewrites platform (2 of the first 5 production echoes, 2026-08-29).
        it('uses the caller\'s platform when no prior conversation exists', async () => {
            const saved = await messagesService.storeOutgoingMessage(
                pageId, workspaceId, 'fresh-wa-customer', 'شكرا لتواصلك', 'app_auto', undefined,
                undefined, undefined, undefined, undefined, 'wamid.first', 'whatsapp',
            );

            const [row] = await testDb.select().from(messages).where(eq(messages.id, saved.id));
            expect(row.platform).toBe('whatsapp');
            expect(row.replyMethod).toBe('app_auto');
            const [conv] = await testDb.select().from(conversations)
                .where(and(eq(conversations.pageId, pageId), eq(conversations.senderId, 'fresh-wa-customer')));
            expect(conv.platform).toBe('whatsapp');
        });

        it('an existing conversation keeps its platform even when the caller passes another', async () => {
            await insertMessage(pageId, 'ig-customer', { platform: 'instagram', platformMessageId: 'ig-in-1' });

            const saved = await messagesService.storeOutgoingMessage(
                pageId, workspaceId, 'ig-customer', 'Hi', 'manual', undefined,
                undefined, undefined, undefined, undefined, undefined, 'whatsapp',
            );

            const [row] = await testDb.select().from(messages).where(eq(messages.id, saved.id));
            expect(row.platform).toBe('instagram');
        });
    });

    // =========================================================
    // WhatsApp Coexistence — app automation echoes vs the handoff pause (D-109)
    // =========================================================
    describe('handoff pause vs app_auto echoes', () => {
        const PAUSE_MINUTES = 15;

        it('a manual outgoing inside the window pauses the AI', async () => {
            await insertMessage(pageId, senderId, {
                platform: 'whatsapp', direction: 'outgoing', replied: true,
                replyMethod: 'manual', platformMessageId: 'wamid.typed',
                createdAt: new Date(Date.now() - 60_000),
            });
            expect(await messagesService.isPaused(pageId, senderId, PAUSE_MINUTES)).toBe(true);
        });

        // The merchant's app greeting must not read as a human handoff — that
        // silenced the AI for the whole window in every conversation (2026-08-29).
        it('an app_auto outgoing inside the window does NOT pause the AI', async () => {
            await insertMessage(pageId, senderId, {
                platform: 'whatsapp', direction: 'outgoing', replied: true,
                replyMethod: 'app_auto', platformMessageId: 'wamid.greeting',
                createdAt: new Date(Date.now() - 4_000),
            });
            expect(await messagesService.isPaused(pageId, senderId, PAUSE_MINUTES)).toBe(false);
        });
    });

    describe('getInboundRecency', () => {
        const WINDOW_MS = 10_000;
        const IDLE_DAYS = 14;

        it('reports no inbound for a customer who never wrote in', async () => {
            const r = await messagesService.getInboundRecency(pageId, 'nobody', WINDOW_MS, IDLE_DAYS);
            expect(r).toEqual({ lastAt: null, priorInboundBeforeWindow: false });
        });

        it('a conversation opener: recent lastAt, nothing before the window', async () => {
            const at = new Date(Date.now() - 3_000);
            await insertMessage(pageId, senderId, { platformMessageId: 'in-opener', createdAt: at });

            const r = await messagesService.getInboundRecency(pageId, senderId, WINDOW_MS, IDLE_DAYS);
            expect(r.lastAt?.getTime()).toBe(at.getTime());
            expect(r.priorInboundBeforeWindow).toBe(false);
        });

        // A 2–3-message burst is still an opener: "prior" is measured from the
        // window EDGE, not from the latest message.
        it('an opener sent as a burst is still not an active thread', async () => {
            await insertMessage(pageId, senderId, { platformMessageId: 'in-b1', createdAt: new Date(Date.now() - 6_000) });
            await insertMessage(pageId, senderId, { platformMessageId: 'in-b2', createdAt: new Date(Date.now() - 4_000) });
            await insertMessage(pageId, senderId, { platformMessageId: 'in-b3', createdAt: new Date(Date.now() - 2_000) });

            const r = await messagesService.getInboundRecency(pageId, senderId, WINDOW_MS, IDLE_DAYS);
            expect(r.priorInboundBeforeWindow).toBe(false);
        });

        it('an active thread: an inbound older than the window but inside 14 days', async () => {
            await insertMessage(pageId, senderId, { platformMessageId: 'in-yday', createdAt: new Date(Date.now() - 24 * 3_600_000) });
            await insertMessage(pageId, senderId, { platformMessageId: 'in-now', createdAt: new Date(Date.now() - 2_000) });

            const r = await messagesService.getInboundRecency(pageId, senderId, WINDOW_MS, IDLE_DAYS);
            expect(r.priorInboundBeforeWindow).toBe(true);
        });

        // WhatsApp re-sends its greeting after 14 days of silence, so a customer
        // returning after 15 days is an opener again.
        it('a customer back after 14+ days of silence is an opener again', async () => {
            await insertMessage(pageId, senderId, { platformMessageId: 'in-old', createdAt: new Date(Date.now() - 15 * 24 * 3_600_000) });
            await insertMessage(pageId, senderId, { platformMessageId: 'in-now', createdAt: new Date(Date.now() - 2_000) });

            const r = await messagesService.getInboundRecency(pageId, senderId, WINDOW_MS, IDLE_DAYS);
            expect(r.priorInboundBeforeWindow).toBe(false);
        });

        it('ignores outgoing rows and other customers', async () => {
            await insertMessage(pageId, senderId, { platformMessageId: 'out-1', direction: 'outgoing', replied: true, replyMethod: 'ai', createdAt: new Date(Date.now() - 3_600_000) });
            await insertMessage(pageId, 'someone-else', { platformMessageId: 'in-other', createdAt: new Date(Date.now() - 3_600_000) });
            await insertMessage(pageId, senderId, { platformMessageId: 'in-now', createdAt: new Date(Date.now() - 2_000) });

            const r = await messagesService.getInboundRecency(pageId, senderId, WINDOW_MS, IDLE_DAYS);
            expect(r.priorInboundBeforeWindow).toBe(false);
        });
    });
});
