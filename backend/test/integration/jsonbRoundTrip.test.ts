/**
 * jsonb round-trip — regression pin for the drizzle/postgres-js double-encoding
 * (drizzle-orm#724; found live 2026-08-01 when every grounding-verifier shadow
 * flag was invisible to `flag_meta ? '...'`).
 *
 * The contract under test is SQL-side, which is exactly what unit tests and app
 * code cannot see: drizzle reads double-decode symmetrically, so a value stored
 * as a jsonb *string* looks healthy from TypeScript while the `?` / `->`
 * operators, GIN indexes, and every analytics query silently match nothing.
 *
 * If this file starts failing after a drizzle-orm upgrade, the shim in
 * src/db/jsonbColumn.ts and the upstream driver disagree again — do NOT relax
 * these assertions; fix the column type.
 */
import { describe, it, expect } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { testDb, createTestUser, createTestWorkspace, createTestPage, insertMessage } from './setup';
import * as schema from '../../src/db/schema';

const SHADOW_KEY = 'reply_not_grounded_shadow';

async function rawMeta(messageId: string) {
    const rows = await testDb.execute<{ t: string | null; key_visible: boolean }>(sql`
        SELECT jsonb_typeof(flag_meta) AS t,
               flag_meta ? ${SHADOW_KEY} AS key_visible
        FROM messages WHERE id = ${messageId}
    `);
    return rows[0];
}

describe('jsonb columns store objects, not JSON-encoded strings', () => {
    it('INSERT via drizzle lands as a jsonb object visible to the ? operator', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });
        const msg = await insertMessage(page.id, 'sender-jsonb-1', {
            flagMeta: { [SHADOW_KEY]: { claims: [{ text: 'x', kind: 'price', why: 'y' }] } },
        });

        const raw = await rawMeta(msg.id);
        expect(raw.t).toBe('object');
        expect(raw.key_visible).toBe(true);
    });

    it('UPDATE .set via drizzle (the flagSource pattern) lands as a jsonb object', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });
        const msg = await insertMessage(page.id, 'sender-jsonb-2');

        await testDb.update(schema.messages)
            .set({ flagMeta: { [SHADOW_KEY]: { claims: [] } } })
            .where(eq(schema.messages.id, msg.id));

        const raw = await rawMeta(msg.id);
        expect(raw.t).toBe('object');
        expect(raw.key_visible).toBe(true);
    });

    it('legacy double-encoded rows still read back as objects through drizzle', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });
        const msg = await insertMessage(page.id, 'sender-jsonb-3');

        // Plant the pre-migration shape: a jsonb STRING holding the JSON text.
        await testDb.execute(sql`
            UPDATE messages
            SET flag_meta = ${JSON.stringify({ legacy: true })}::jsonb
            WHERE id = ${msg.id}
        `);
        const planted = await rawMeta(msg.id);
        expect(planted.t).toBe('string'); // precondition: the row is really legacy-shaped

        const [row] = await testDb.select({ flagMeta: schema.messages.flagMeta })
            .from(schema.messages)
            .where(eq(schema.messages.id, msg.id));
        expect(row.flagMeta).toEqual({ legacy: true });
    });

    it('the 0148 backfill normalizes a legacy row so the ? operator sees it', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });
        const msg = await insertMessage(page.id, 'sender-jsonb-4');

        await testDb.execute(sql`
            UPDATE messages
            SET flag_meta = ${JSON.stringify({ [SHADOW_KEY]: { claims: [] } })}::jsonb
            WHERE id = ${msg.id}
        `);
        expect((await rawMeta(msg.id)).key_visible).toBe(false); // invisible while string

        // The exact repair the migration applies, scoped to this row.
        await testDb.execute(sql`
            UPDATE messages
            SET flag_meta = (flag_meta #>> '{}')::jsonb
            WHERE id = ${msg.id}
              AND jsonb_typeof(flag_meta) = 'string'
              AND (flag_meta #>> '{}') ~ '^[[:space:]]*[\[{]'
        `);

        const repaired = await rawMeta(msg.id);
        expect(repaired.t).toBe('object');
        expect(repaired.key_visible).toBe(true);
    });
});
