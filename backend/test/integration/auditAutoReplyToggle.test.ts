/**
 * Integration regression for the auto-reply audit trail.
 *
 * Guards the ONE thing unit tests can't: that a real toggle produces a row you
 * can actually query back. The first cut filtered on `metadata->>'entityId'`,
 * which silently returns NULL because postgres-js stores `logs.metadata` as a
 * double-encoded STRING scalar (same footgun as flagMeta.test.ts). This test
 * pins the robust contract: filter on the typed `page_id` column, and the
 * detail fields survive a JS read even though metadata is string-encoded.
 */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import './setup';
import { testDb, createTestUser, createTestWorkspace, createTestPage } from './setup';
import { logAutoReplyToggle } from '../../src/services/auditLog';

// logAutoReplyToggle is fire-and-forget; give the delegated insert a beat.
async function settle() {
    await new Promise((r) => setTimeout(r, 100));
}

describe('page.auto_reply_toggled audit trail (integration)', () => {
    it('is queryable by the typed page_id column (NOT metadata->>)', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });

        logAutoReplyToggle({
            pageId: page.id,
            workspaceId: workspace.id,
            userId: user.id,
            enabled: true,
            previous: false,
            reason: 'user',
        });
        await settle();

        // The query support/ops will actually run.
        const rows = await testDb.execute<{
            page_id: string;
            user_id: string;
            action: string;
            meta_shape: string;
            entity_via_arrow: string | null;
        }>(sql`
            SELECT page_id, user_id, action,
                   jsonb_typeof(metadata) AS meta_shape,
                   metadata->>'entityId' AS entity_via_arrow
            FROM logs
            WHERE action = 'page.auto_reply_toggled' AND page_id = ${page.id}
            ORDER BY created_at DESC
        `);

        expect(rows).toHaveLength(1);
        expect(rows[0].page_id).toBe(page.id);
        expect(rows[0].user_id).toBe(user.id); // actor is a typed column too

        // Documents the encoding reality this design works AROUND: metadata is a
        // string scalar, so the arrow operator yields NULL. If a future drizzle
        // upgrade fixes jsonb storage, meta_shape flips to 'object' and this
        // assertion will fail loudly — the cue to simplify back to metadata->>.
        expect(rows[0].meta_shape).toBe('string');
        expect(rows[0].entity_via_arrow).toBeNull();
    });

    it('preserves the detail fields on a JS read (string-encoded but usable)', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });

        // A system auto-pause: no userId → actor derives to 'system'.
        logAutoReplyToggle({
            pageId: page.id,
            workspaceId: workspace.id,
            enabled: false,
            previous: true,
            reason: 'auto_pause',
            extra: { bucket: 'our_fault' },
        });
        await settle();

        const rows = await testDb.execute<{ user_id: string | null; metadata: unknown }>(sql`
            SELECT user_id, metadata FROM logs
            WHERE action = 'page.auto_reply_toggled' AND page_id = ${page.id}
        `);
        expect(rows).toHaveLength(1);
        expect(rows[0].user_id).toBeNull(); // system event ⇒ no actor userId

        // postgres-js hands the string-scalar back as a JS string; parse to read.
        const meta = typeof rows[0].metadata === 'string'
            ? JSON.parse(rows[0].metadata)
            : rows[0].metadata;
        expect(meta).toMatchObject({
            enabled: false,
            previous: true,
            reason: 'auto_pause',
            actor: 'system',
            channel: 'page',
            bucket: 'our_fault',
        });
    });
});
