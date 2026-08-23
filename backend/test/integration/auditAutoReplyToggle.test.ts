/**
 * Integration regression for the auto-reply audit trail.
 *
 * Guards the ONE thing unit tests can't: that a real toggle produces a row you
 * can actually query back. The typed `page_id` column remains the sanctioned
 * filter (indexed, type-safe). Historically `metadata->>'entityId'` returned
 * NULL because drizzle double-encoded `logs.metadata` into a STRING scalar
 * (same footgun as flagMeta.test.ts) — fixed 2026-08-01 by src/db/jsonbColumn.ts
 * + migration 0148, so the arrow operator now works too and this test asserts
 * both access paths.
 */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import './setup';
import { testDb, createTestUser, createTestWorkspace, createTestPage } from './setup';
import { logAutoReplyToggle } from '../../src/services/auditLog';

describe('page.auto_reply_toggled audit trail (integration)', () => {
    it('is queryable by the typed page_id column (NOT metadata->>)', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });

        await logAutoReplyToggle({
            pageId: page.id,
            workspaceId: workspace.id,
            userId: user.id,
            enabled: true,
            previous: false,
            reason: 'user',
        });

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

        // Since the jsonbColumn.ts fix, metadata is a real jsonb object, so the
        // arrow operator works. The typed page_id column stays the primary
        // filter (indexed); the arrow path is asserted so a storage-shape
        // regression is caught here as well as in flagMeta.test.ts.
        expect(rows[0].meta_shape).toBe('object');
        expect(rows[0].entity_via_arrow).toBe(page.id);
    });

    it('preserves the detail fields on a JS read (tolerant of legacy string-encoded rows)', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });

        // A system auto-pause: no userId → actor derives to 'system'.
        await logAutoReplyToggle({
            pageId: page.id,
            workspaceId: workspace.id,
            enabled: false,
            previous: true,
            reason: 'auto_pause',
            extra: { bucket: 'our_fault' },
        });

        const rows = await testDb.execute<{ user_id: string | null; metadata: unknown }>(sql`
            SELECT user_id, metadata FROM logs
            WHERE action = 'page.auto_reply_toggled' AND page_id = ${page.id}
        `);
        expect(rows).toHaveLength(1);
        expect(rows[0].user_id).toBeNull(); // system event ⇒ no actor userId

        // Post-fix rows arrive as objects; the string branch keeps the read
        // tolerant of legacy double-encoded rows (pre-0148 backups/replicas).
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
