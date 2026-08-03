/**
 * Regression test for the flag_meta storage shape.
 *
 * Bug context: a deploy on 2026-04-21 began storing flag_meta as a JSON STRING
 * scalar instead of a JSON OBJECT (e.g. `"\"{\\\"dm_failed\\\":...}\""` instead
 * of `{"dm_failed":...}`). Symptom in prod: `jsonb_typeof(flag_meta) = 'string'`
 * for every dm_failed write since the deploy, breaking every `flag_meta ? 'key'`
 * query the UI / analytics rely on. Root cause: drizzle-orm 0.29 pre-stringifies
 * jsonb and postgres-js serializes again (drizzle-orm#724).
 *
 * These tests were `it.fails` (documented-broken) until 2026-08-01, when
 * src/db/jsonbColumn.ts fixed the write path and migration 0148 repaired the
 * stored rows. They now pin the correct contract: a JS object written to a
 * jsonb column must be stored as a jsonb object, not a string. See also
 * jsonbRoundTrip.test.ts (messages side + legacy readback + backfill shape).
 */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import './setup';
import { testDb } from './setup';
import { createTestUser, createTestWorkspace, createTestPage, insertPost, insertComment } from './setup';
import { commentsService } from '../../src/services/comments';
import { comments } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

describe('flag_meta storage shape (regression for 2026-04-21 stringification bug)', () => {
    it('updateComment stores flagMeta as a jsonb object, not a string scalar', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });
        const post = await insertPost(page.id);
        const comment = await insertComment(post.id, { workspaceId: workspace.id });

        // Mirrors the exact shape commentProcessor builds on a DM failure.
        const flagMeta = {
            dm_failed: {
                bucket: 'customer_refused' as const,
                code: 10903,
                subcode: 1893062,
                fbMessage: "Facebook API error: This user can't reply to this activity",
            },
        };

        await commentsService.updateComment(comment.id, {
            needsAttention: false,
            resolved: true,
            flagReason: 'dm_failed',
            flagMeta,
        });

        // Assert the storage shape directly via SQL — the JS-side roundtrip will
        // happily deserialize a stringified value back into an object, hiding the bug.
        const result = await testDb.execute<{
            shape: string;
            has_dm_key: boolean;
            bucket: string | null;
        }>(sql`
            SELECT
                jsonb_typeof(flag_meta) AS shape,
                (flag_meta ? 'dm_failed') AS has_dm_key,
                flag_meta->'dm_failed'->>'bucket' AS bucket
            FROM comments
            WHERE id = ${comment.id}
        `);

        const row = result[0];
        expect(row.shape).toBe('object');
        expect(row.has_dm_key).toBe(true);
        expect(row.bucket).toBe('customer_refused');
    });

    it('isolates: direct Drizzle .update() — does it stringify too?', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });
        const post = await insertPost(page.id);
        const comment = await insertComment(post.id, { workspaceId: workspace.id });

        const flagMeta = { dm_failed: { bucket: 'customer_refused' as const, code: 10903 } };

        // Direct Drizzle write — bypass the service layer.
        await testDb.update(comments).set({ flagMeta }).where(eq(comments.id, comment.id));

        const result = await testDb.execute<{ shape: string }>(sql`
            SELECT jsonb_typeof(flag_meta) AS shape FROM comments WHERE id = ${comment.id}
        `);

        // If THIS fails too, the bug is in Drizzle/postgres-js, not commentsService.
        expect(result[0].shape).toBe('object');
    });

    it('compare: jsonb column WITH $type<> annotation (messageTags) works correctly', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });
        const post = await insertPost(page.id);
        const comment = await insertComment(post.id, { workspaceId: workspace.id });

        // messageTags has .$type<FacebookMessageTag[]>() — flagMeta does NOT.
        await testDb.update(comments)
            .set({ messageTags: [{ id: '123', name: 'X', type: 'user', offset: 0, length: 1 }] })
            .where(eq(comments.id, comment.id));

        const result = await testDb.execute<{ shape: string }>(sql`
            SELECT jsonb_typeof(message_tags) AS shape FROM comments WHERE id = ${comment.id}
        `);
        expect(result[0].shape).toBe('array');
    });
});
