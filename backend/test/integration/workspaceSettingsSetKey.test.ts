/**
 * `workspaceSettingsService.setKey` — the SURGICAL single-key JSONB write.
 *
 * This runs against a real Postgres on purpose. `setKey` is hand-written
 * `jsonb_set` SQL, and every unit test that touches it mocks it away — so
 * without this file the statement is never executed by anything until a
 * merchant swipes a card in production.
 *
 * What it must guarantee, and why each one is load-bearing:
 *
 *  1. It writes the ONE key and leaves every sibling untouched. The method
 *     exists because `updateSettings` cannot promise that: it is a
 *     read-modify-write over `getSettings`, which returns
 *     `{ ...DEFAULTS, ...stored }`, so it materialises every read-time default
 *     as an explicit key — and `detectLegacyDrift` then finds nothing missing
 *     and stops healing that workspace from the legacy row, permanently.
 *  2. It stores a jsonb OBJECT, not a JSON-encoded string (see
 *     jsonbRoundTrip.test.ts — the drizzle/postgres-js double-encoding trap,
 *     which is invisible from TypeScript because reads decode symmetrically).
 *  3. It creates the key when the JSONB has never held it, and when the column
 *     is NULL outright.
 */
import { describe, it, expect } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { testDb, createTestUser, createTestWorkspace } from './setup';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';
import { workspaces } from '../../src/db/schema';

const KEY = 'postSuggestionHiddenOn';

async function rawSettings(workspaceId: string) {
    const rows = await testDb.execute<{ t: string | null; hidden: string | null; kind: string | null }>(sql`
        SELECT jsonb_typeof(settings)                    AS t,
               settings ->> ${KEY}                       AS hidden,
               jsonb_typeof(settings -> ${KEY})          AS kind
        FROM workspaces WHERE id = ${workspaceId}
    `);
    return rows[0];
}

describe('workspaceSettings.setKey — one key, nothing else', () => {
    it('creates the key on a workspace whose settings JSONB is empty', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);

        await workspaceSettingsService.setKey(ws.id, KEY, '2026-08-14');

        const raw = await rawSettings(ws.id);
        // An OBJECT, not a JSON-encoded string — the double-encoding trap would
        // make `settings ->> key` return nothing while TypeScript looked fine.
        expect(raw.t).toBe('object');
        expect(raw.hidden).toBe('2026-08-14');
    });

    it('survives a NULL settings column (COALESCE, not a no-op UPDATE)', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);
        await testDb.update(workspaces).set({ settings: sql`NULL` }).where(eq(workspaces.id, ws.id));

        await workspaceSettingsService.setKey(ws.id, KEY, '2026-08-14');

        expect((await rawSettings(ws.id)).hidden).toBe('2026-08-14');
    });

    it('⭐ leaves every SIBLING key exactly as it was — the whole reason this method exists', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);
        // A workspace mid-life: some pipeline settings explicitly stored, most
        // keys ABSENT and therefore still served from read-time defaults.
        await testDb.update(workspaces)
            .set({ settings: { commentsAutoReply: false, brandVoiceNotes: 'ودّي ومباشر' } })
            .where(eq(workspaces.id, ws.id));

        await workspaceSettingsService.setKey(ws.id, KEY, '2026-08-14');

        const rows = await testDb.execute<{ keys: string[] }>(sql`
            SELECT ARRAY(SELECT jsonb_object_keys(settings) ORDER BY 1) AS keys
            FROM workspaces WHERE id = ${ws.id}
        `);
        // EXACTLY the two that were there plus the one we wrote. If this ever
        // grows to the full DEFAULTS set, someone routed a gesture through
        // updateSettings again and the legacy drift-heal is now dead.
        expect(rows[0].keys.sort()).toEqual(['brandVoiceNotes', 'commentsAutoReply', KEY].sort());
    });

    it('null clears the key without disturbing its neighbours', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);
        await workspaceSettingsService.setKey(ws.id, KEY, '2026-08-14');

        await workspaceSettingsService.setKey(ws.id, KEY, null);

        const raw = await rawSettings(ws.id);
        // JSON null, which the `=== today` read treats as "showing" — the point
        // is that it is never a stale DATE that could hide the card again.
        expect(raw.kind).toBe('null');
        expect(raw.hidden).toBeNull();
    });

    it('a later write REPLACES the value rather than appending', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);

        await workspaceSettingsService.setKey(ws.id, KEY, '2026-08-14');
        await workspaceSettingsService.setKey(ws.id, KEY, '2026-08-15');

        expect((await rawSettings(ws.id)).hidden).toBe('2026-08-15');
    });
});
