/**
 * GA4 client id — first-touch storage (real Postgres).
 *
 * The claim: `users.ga_client_id` records the EARLIEST attribution id we ever
 * see for a user and is never overwritten afterwards. It matters because the
 * `_ga` cookie is per-browser: the first id we observe is the one most likely to
 * belong to the session that carried the ad click, and a later login from a
 * second browser (or after a cookie reset) must not repoint a conversion away
 * from the click that paid for it.
 *
 * This is asserted against a real database rather than a mocked update chain
 * because the guarantee IS the SQL — `UPDATE … WHERE id = ? AND ga_client_id IS
 * NULL`. A mock can only confirm that some condition object was passed; only
 * Postgres can confirm the second write actually did nothing.
 *
 * Covers:
 *   1. a fresh user starts with no attribution id
 *   2. the first write lands — and reports that it did
 *   3. a second write with a different id is a no-op — the first value survives,
 *      and the call reports that it wrote nothing (that verdict is what gates the
 *      signup-session replay, so it must never be true twice for one user)
 *   4. the guard is scoped per user: another user's write is unaffected
 */

import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestUser, testDb } from './setup';
import { users } from '../../src/db/schema';
// The PRODUCTION function, not a restatement of its SQL. authController's
// setAnalyticsClientId calls this same one, so the predicate under test cannot
// drift away from the predicate that ships.
import { storeGaClientIdFirstTouch } from '../../src/services/ga4';

async function readClientId(userId: string): Promise<string | null> {
    const [row] = await testDb
        .select({ gaClientId: users.gaClientId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    return row?.gaClientId ?? null;
}

describe('users.ga_client_id first-touch', () => {
    it('starts null, accepts the first id, and refuses every later one', async () => {
        const user = await createTestUser({ facebookId: 'ga-first-touch' });

        expect(await readClientId(user.id)).toBeNull();

        expect(await storeGaClientIdFirstTouch(user.id, '1111111111.1700000000')).toBe(true);
        expect(await readClientId(user.id)).toBe('1111111111.1700000000');

        // A later session on another browser reports a different cookie.
        expect(await storeGaClientIdFirstTouch(user.id, '2222222222.1800000000')).toBe(false);
        expect(await readClientId(user.id)).toBe('1111111111.1700000000');

        // And repeatedly — the guard is not a one-shot.
        expect(await storeGaClientIdFirstTouch(user.id, '3333333333.1900000000')).toBe(false);
        expect(await readClientId(user.id)).toBe('1111111111.1700000000');
    });

    it('scopes the guard per user — a filled row never blocks an empty one', async () => {
        const filled = await createTestUser({ facebookId: 'ga-scope-filled' });
        const empty = await createTestUser({ facebookId: 'ga-scope-empty' });

        await storeGaClientIdFirstTouch(filled.id, '4444444444.1700000000');
        await storeGaClientIdFirstTouch(empty.id, '5555555555.1700000000');

        expect(await readClientId(filled.id)).toBe('4444444444.1700000000');
        expect(await readClientId(empty.id)).toBe('5555555555.1700000000');
    });
});
