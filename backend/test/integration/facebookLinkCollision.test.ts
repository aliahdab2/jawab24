/**
 * Integration coverage for the Facebook-identity collision on the connect/link path.
 *
 * `users.facebook_id` carries the UNIQUE index `users_facebook_id_key`. When a
 * merchant's Facebook identity already belongs to a DIFFERENT Jawab24 user — a direct
 * Facebook signup colliding with an embedded, auto-provisioned account — the connect's
 * link write (`linkFacebookToUser`, a blind UPDATE) raises a 23505.
 *
 * The controller's pre-check plus a belt-and-braces `isUniqueViolation` branch turn
 * that into an actionable 409 instead of an opaque 500. dbErrors.ts is explicit that a
 * mocked unit test cannot catch a real unique violation — cover it against Postgres —
 * so these do, and they also pin the index the whole scheme relies on.
 * (Prod: Zid dev-store walkthrough, 2026-08-31.)
 */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import './setup';
import { testDb, createTestUser } from './setup';
import { authService } from '../../src/services/auth';
import { isUniqueViolation } from '../../src/utils/dbErrors';

describe('Facebook-identity collision (users.facebook_id UNIQUE)', () => {
    it('getUserByFacebookId returns the owning user id, or null when unowned', async () => {
        const owner = await createTestUser({ facebookId: 'fb-collision-owner', email: 'owner@collision.test' });

        await expect(authService.getUserByFacebookId('fb-collision-owner')).resolves.toEqual({ id: owner.id });
        await expect(authService.getUserByFacebookId('fb-collision-nobody')).resolves.toBeNull();
    });

    it('linkFacebookToUser raises a unique violation isUniqueViolation() recognises when the identity is already owned', async () => {
        const owner = await createTestUser({ facebookId: 'fb-collision-shared', email: 'a@collision.test' });
        const other = await createTestUser({ facebookId: 'fb-collision-other', email: 'b@collision.test' });

        const err = await authService
            .linkFacebookToUser(other.id, 'fb-collision-shared', 'tok', undefined)
            .then(() => null)
            .catch((e: unknown) => e);

        expect(err, 'linking an already-owned Facebook identity must be rejected by the database').not.toBeNull();
        expect(isUniqueViolation(err)).toBe(true);

        // The failed write must not have stolen or cleared the owner's identity.
        await expect(authService.getUserByFacebookId('fb-collision-shared')).resolves.toEqual({ id: owner.id });
    });

    it('linkFacebookToUser succeeds when the target identity is unowned', async () => {
        const user = await createTestUser({ facebookId: 'fb-collision-initial', email: 'fresh@collision.test' });

        await authService.linkFacebookToUser(user.id, 'fb-collision-fresh', 'tok', undefined);

        await expect(authService.getUserByFacebookId('fb-collision-fresh')).resolves.toEqual({ id: user.id });
    });

    it('carries a UNIQUE index on facebook_id — the constraint the collision guard depends on', async () => {
        // Without it the link write never raises 23505, the pre-check race window is
        // unguarded, and two accounts could share an identity. Matched by shape, not
        // name — the name differs between prod (users_facebook_id_key) and a
        // drizzle-kit-push test DB, but the UNIQUE(facebook_id) shape is invariant.
        const rows = await testDb.execute<{ indexdef: string }>(sql`
            SELECT indexdef FROM pg_indexes
            WHERE tablename = 'users' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%(facebook_id)%'
        `);

        expect(rows.length, 'users must have a UNIQUE index on facebook_id').toBeGreaterThan(0);
    });
});
