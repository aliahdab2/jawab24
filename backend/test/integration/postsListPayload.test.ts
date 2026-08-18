import { describe, it, expect } from 'vitest';
import { createTestUser, createTestWorkspace, createTestPage, testDb } from './setup';
import { posts } from '../../src/db/schema';
import { postsService } from '../../src/services/posts';

/**
 * The `GET /posts` wire contract, against real Postgres.
 *
 * This endpoint exists ONLY to drive the ⚡ trigger badge on the comments screen,
 * which reads `{ id → { triggerKeyword, triggerReply } }` and nothing else. It used
 * to `select` the full post `message` for all 200 rows: measured on real
 * workspaces, up to **445 kB of post text per page load** against 0–2.7 kB of
 * `triggerReply` actually read. For scale, the whole dashboard API burst is 39 kB,
 * so this one endpoint could outweigh it tenfold on a slow connection.
 *
 * Asserted against the database rather than a mock because the regression is a
 * change to the `select` projection — a mocked row would happily return whatever
 * shape the test invented, proving nothing about what Postgres is asked for.
 */
describe('posts list payload — GET /posts (real Postgres)', () => {
    it('returns only the trigger fields, never the post body', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        // getPostsByWorkspace joins pages on workspaceId, so the page must carry it.
        const page = await createTestPage(user.id, { workspaceId: workspace.id });

        const longBody = 'ه'.repeat(4000);
        await testDb.insert(posts).values({
            pageId: page.id,
            facebookPostId: 'fb-post-payload-1',
            message: longBody,
            triggerKeyword: 'سعر',
            triggerReply: 'تم إرسال السعر في رسالة خاصة',
            autoReplyEnabled: true,
        } as typeof posts.$inferInsert);

        const rows = await postsService.getPostsByWorkspace(workspace.id);
        expect(rows).toHaveLength(1);
        const row = rows[0] as Record<string, unknown>;

        // The whole point of the endpoint.
        expect(row.triggerKeyword).toBe('سعر');
        expect(row.triggerReply).toBe('تم إرسال السعر في رسالة خاصة');

        // The bytes that made it heavy. `message` is the big one; the others are
        // simply unread by the only consumer.
        expect(row).not.toHaveProperty('message');
        expect(row).not.toHaveProperty('pageName');
        expect(row).not.toHaveProperty('createdTime');
        expect(row).not.toHaveProperty('autoReplyEnabled');

        // Pin the shape so a re-widened projection fails here rather than shipping
        // silently — the failure mode is "merely slow", which no other test sees.
        expect(Object.keys(row).sort()).toEqual([
            'id', 'pageId', 'triggerKeyword', 'triggerReply',
        ]);

        // And prove the body really was in the row we just read past, so this is
        // not a vacuous pass on a post that never had one.
        const [stored] = await testDb.select().from(posts);
        expect(stored.message).toHaveLength(4000);
    });
});
