/**
 * Auto-provisioning an e-commerce merchant — Integration Tests (real Postgres)
 *
 * Backs the fix for Zid's 2026-08-11 rejection ("direct merchant access, no
 * sign-in prompt"): an App Market install arrives with no Jawab24 session, so
 * the account is created from the store profile the platform itself returned.
 *
 * The security-critical half is the REFUSAL. The store email is attacker-
 * controlled — a merchant can set their Zid store's email to anyone's address —
 * so an email match must never be treated as proof of identity. These run
 * against a real database because the guard IS a database uniqueness question,
 * and a mocked `select` would prove nothing about it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestUser, createTestWorkspace, testDb } from './setup';
import { AuthService } from '../../src/services/auth';
import { users, workspaces, workspaceMembers, workspaceInvites, subscriptions, plans } from '../../src/db/schema';

const authService = new AuthService();

// `plans` is reference data: production seeds it, and the per-test TRUNCATE in
// setup.ts does NOT cover it. Without a default plan createSubscription finds
// none, fails into its captureError, and the subscription assertion below would
// pass for the wrong reason.
//
// Seeded by SLUG, idempotently — the row outlives a crashed run (nothing
// truncates it), so an insert that assumes a clean table fails the whole suite
// on the next run with a unique-constraint error.
const PLAN_SLUG = 'zid-provisioning-default';

async function removeSeedPlan() {
    await testDb.delete(plans).where(eq(plans.slug, PLAN_SLUG)).catch(() => {});
}

beforeAll(async () => {
    // Idempotent by slug: the row outlives a crashed run (nothing truncates
    // `plans`), so tolerate an existing one rather than delete-then-insert,
    // which races a prior run's leftover and fails on the unique constraint.
    await testDb.insert(plans).values({
        name: 'Trial', slug: PLAN_SLUG, price: 0, isDefault: true, isActive: true,
    }).onConflictDoNothing({ target: plans.slug });
});

afterAll(removeSeedPlan);

describe('provisionEcommerceMerchantUser', () => {
    it('creates a usable account — user, workspace membership as owner, and a subscription', async () => {
        const email = `fresh-merchant-${Date.now()}@zid.store`;

        const user = await authService.provisionEcommerceMerchantUser(email, 'متجر التجربة', 'zid');

        expect(user).not.toBeNull();
        expect(user!.email).toBe(email);
        expect(user!.name).toBe('متجر التجربة');

        // No facebookId and no phone: the merchant's way in is the platform's
        // embedded entry, not either of our login methods.
        expect(user!.facebookId).toBeNull();
        expect(user!.phone).toBeNull();

        const memberships = await testDb.select().from(workspaceMembers)
            .where(eq(workspaceMembers.userId, user!.id));
        expect(memberships).toHaveLength(1);
        expect(memberships[0].role).toBe('owner');

        const [workspace] = await testDb.select().from(workspaces)
            .where(eq(workspaces.id, memberships[0].workspaceId));
        expect(workspace.ownerId).toBe(user!.id);
        expect(workspace.name).toBe('متجر التجربة');

        // Without this the merchant installs successfully and then cannot reply.
        const subs = await testDb.select().from(subscriptions)
            .where(eq(subscriptions.userId, user!.id));
        expect(subs).toHaveLength(1);
    });

    it('REFUSES when the email already belongs to an account — account-takeover guard', async () => {
        const victimEmail = `victim-${Date.now()}@example.com`;
        const victim = await createTestUser({ email: victimEmail, name: 'Victim' });

        const result = await authService.provisionEcommerceMerchantUser(victimEmail, 'Attacker Store', 'zid');

        // Null sends the caller down the claim-after-login path, where the real
        // owner must authenticate before the store is attached.
        expect(result).toBeNull();

        // The victim's record is untouched — not renamed, not re-pointed.
        const [after] = await testDb.select().from(users).where(eq(users.id, victim.id));
        expect(after.name).toBe('Victim');

        const created = await testDb.select().from(users).where(eq(users.email, victimEmail));
        expect(created).toHaveLength(1);
    });

    it('matches the existing account case-insensitively — casing must not defeat the guard', async () => {
        const email = `MixedCase-${Date.now()}@Example.com`;
        await createTestUser({ email: email.toLowerCase(), name: 'Existing' });

        const result = await authService.provisionEcommerceMerchantUser(email, 'Attacker Store', 'zid');

        expect(result).toBeNull();
    });

    it('normalizes the stored email so a later install cannot create a case-variant duplicate', async () => {
        const raw = `  Merchant-${Date.now()}@ZID.STORE `;
        const user = await authService.provisionEcommerceMerchantUser(raw, 'Store', 'zid');

        expect(user!.email).toBe(raw.trim().toLowerCase());

        const second = await authService.provisionEcommerceMerchantUser(raw.toUpperCase(), 'Store', 'zid');
        expect(second).toBeNull();
    });

    it('returns null for a blank email rather than creating an identity-less account', async () => {
        expect(await authService.provisionEcommerceMerchantUser('   ', 'Store', 'zid')).toBeNull();
    });

    it('GUARANTEES a workspace even when a pending invite matches the email (no-login self-heal is impossible here)', async () => {
        // The ordinary provisionUserWorkspace path SKIPS creation when a pending
        // invite exists, expecting the user to accept it on their next login.
        // An auto-provisioned merchant has no login, so a skip would strand them
        // with a NULL-workspace store forever. Set the trap, then prove it holds.
        const email = `invited-${Date.now()}@zid.store`;

        const inviter = await createTestUser({ email: `inviter-${Date.now()}@x.com`, name: 'Inviter' });
        const inviterWs = await createTestWorkspace(inviter.id);
        await testDb.insert(workspaceInvites).values({
            workspaceId: inviterWs.id,
            email,
            tokenHash: `hash-${Date.now()}`,
            status: 'pending',
            createdBy: inviter.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const user = await authService.provisionEcommerceMerchantUser(email, 'Invited Store', 'zid');

        expect(user).not.toBeNull();
        const memberships = await testDb.select().from(workspaceMembers)
            .where(eq(workspaceMembers.userId, user!.id));
        expect(memberships).toHaveLength(1);
        expect(memberships[0].role).toBe('owner');
    });

    it('records the signup activation event attributed to the platform', async () => {
        const email = `funnel-${Date.now()}@zid.store`;
        const user = await authService.provisionEcommerceMerchantUser(email, 'Store', 'zid');

        // recordActivationEvent is fire-and-forget (void) — let the microtask run.
        await new Promise(resolve => setTimeout(resolve, 50));

        const events = await testDb.query.activationEvents.findMany({
            where: (t, { eq: eqOp }) => eqOp(t.userId, user!.id),
        });
        expect(events.map(e => e.event)).toContain('signup');
        expect(events.find(e => e.event === 'signup')?.metadata).toMatchObject({ method: 'zid' });
    });
});
