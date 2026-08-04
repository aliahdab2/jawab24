import { describe, it, expect } from 'vitest';
import { createTestUser, createTestWorkspace, createTestPage, insertPost, testDb } from './setup';
import { comments, messages } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { commentsService } from '../../src/services/comments';
import { messagesService } from '../../src/services/messages';

/**
 * The webhook dedupe races, exercised against a REAL unique index.
 *
 * Both `findOrCreateFromWebhook` implementations recover from a lost insert race by
 * catching the unique violation and refetching the winner. That recovery was dead code:
 * it tested `err.code === '23505'`, but drizzle wraps driver errors so the SQLSTATE sits
 * on `.cause` and the branch never ran — the error propagated instead, failing the job.
 *
 * Unit tests could not catch it (they construct the error themselves, in a shape the
 * driver never produces), so the recovery is pinned here where Postgres raises it. Both
 * of these paths are per-message/per-comment, so a rethrow here is a lost reply.
 */
describe('webhook dedupe — unique-violation recovery (real Postgres)', () => {
    // Both calls are issued CONCURRENTLY, so both complete their "does it exist?" lookup
    // before either insert lands, and one genuinely loses on the unique index. Doing them
    // in sequence would only exercise the early `existing` return and prove nothing about
    // the recovery — the trap this whole file exists for.
    it('comments: concurrent duplicate deliveries converge on one row, neither throws', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: ws.id });
        const post = await insertPost(page.id, { facebookPostId: 'fb_post_race' });

        const [a, b] = await Promise.all([
            commentsService.findOrCreateFromWebhook(post.id, ws.id, 'fb_cmt_race', 'delivery A'),
            commentsService.findOrCreateFromWebhook(post.id, ws.id, 'fb_cmt_race', 'delivery B'),
        ]);

        // Same row for both callers — the loser refetched the winner rather than failing.
        expect(a.comment.id).toBe(b.comment.id);
        // Exactly one of them created it.
        expect([a.isNew, b.isNew].filter(Boolean)).toHaveLength(1);
        const all = await testDb.select().from(comments).where(eq(comments.facebookCommentId, 'fb_cmt_race'));
        expect(all).toHaveLength(1);
    });

    it('messages: concurrent duplicate deliveries converge on one row, neither throws', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: ws.id });

        const [a, b] = await Promise.all([
            messagesService.findOrCreateFromWebhook(page.id, ws.id, 'mid_race_1', 'sender_1', 'delivery A'),
            messagesService.findOrCreateFromWebhook(page.id, ws.id, 'mid_race_1', 'sender_1', 'delivery B'),
        ]);

        expect(a.message.id).toBe(b.message.id);
        expect([a.isNew, b.isNew].filter(Boolean)).toHaveLength(1);
        const all = await testDb.select().from(messages).where(eq(messages.platformMessageId, 'mid_race_1'));
        expect(all).toHaveLength(1);
    });
});
