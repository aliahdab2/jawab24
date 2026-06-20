/**
 * Regression: the free trial is one-time per signup IDENTITY, not per account.
 *
 * The abuse this guards against: a user signs up (gets a 30-day trial + 1500
 * AI replies), deletes their account (a GDPR hard delete that wipes the user +
 * subscription rows), then signs up again with the SAME phone / Facebook id and
 * — before this fix — received a brand-new fresh trial every cycle, farmable for
 * unlimited free usage.
 *
 * After the fix, the `trial_grants` ledger survives the delete and the returnee's
 * subscription is created with an already-expired trial → zero free replies until
 * they subscribe. The account itself is brand-new (new id, new workspace).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { testDb } from './setup';
import { authService } from '../../src/services/auth';
import { subscriptionsService } from '../../src/services/subscriptions';

// A unique phone per test run so reruns against a shared DB don't collide.
function freshPhone() {
    return `+96650${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`;
}

describe('free trial is one-time per identity (delete → re-signup)', () => {
    beforeAll(async () => {
        // `plans` is intentionally NOT in the shared beforeEach truncate (other
        // files seed their own), so isolate ours: clean slate, seed exactly one
        // default trial plan, and tear it down in afterAll so no other file
        // inherits our default.
        await testDb.execute(sql`TRUNCATE TABLE plans CASCADE`);
        await testDb.insert(schema.plans).values({
            name: 'Starter (test)',
            slug: 'starter-trial-test',
            price: 1500,
            maxAiRepliesPerMonth: 1500,
            trialDays: 30,
            isActive: true,
            isDefault: true,
        });
    });

    afterAll(async () => {
        await testDb.execute(sql`TRUNCATE TABLE plans CASCADE`);
    });

    it('grants a fresh trial on first signup and records the identity', async () => {
        const phone = freshPhone();
        const user = await authService.findOrCreateUserByPhone(phone, 'First Timer');

        const sub = await subscriptionsService.getUserSubscription(user.id);
        expect(sub?.status).toBe('trialing');
        expect(new Date(sub!.trialEndsAt!).getTime()).toBeGreaterThan(Date.now()); // live trial
        expect((await subscriptionsService.canUseAiReplies(user.id)).allowed).toBe(true);

        const ledger = await testDb.select().from(schema.trialGrants).where(eq(schema.trialGrants.firstUserId, user.id));
        expect(ledger).toHaveLength(1);
        expect(ledger[0].identityType).toBe('phone');
    });

    it('a returning identity gets no fresh trial (zero free replies), only a canceled sub', async () => {
        const phone = freshPhone();

        // 1. First signup → live trial, ledger claim recorded.
        const first = await authService.findOrCreateUserByPhone(phone, 'Abuser');
        const firstSub = await subscriptionsService.getUserSubscription(first.id);
        expect(firstSub?.status).toBe('trialing');
        expect(new Date(firstSub!.trialEndsAt!).getTime()).toBeGreaterThan(Date.now());

        // 2. Hard-delete the account (GDPR delete). The ledger row must survive.
        await authService.deleteUser(first.id);
        const [survived] = await testDb.select().from(schema.trialGrants);
        expect(survived).toBeDefined();
        expect(survived.firstUserId).toBeNull(); // ON DELETE SET NULL — claim outlives the account

        // 3. Re-sign-up with the SAME phone → brand-new account, but no fresh trial.
        const second = await authService.findOrCreateUserByPhone(phone, 'Abuser Returns');
        expect(second.id).not.toBe(first.id); // genuinely a new account row

        const secondSub = await subscriptionsService.getUserSubscription(second.id);
        // No fresh trial: a 'canceled' subscription with no trial dates. (Not an
        // expired 'trialing' row — that would lazily become 'past_due' and re-open
        // a month-long grace window of free replies.)
        expect(secondSub?.status).toBe('canceled');
        expect(secondSub?.trialEndsAt).toBeNull();

        const gate = await subscriptionsService.canUseAiReplies(second.id);
        expect(gate.allowed).toBe(false); // zero free replies — must subscribe

        // Ledger is not duplicated — first writer wins, original claim preserved.
        const all = await testDb.select().from(schema.trialGrants);
        expect(all).toHaveLength(1);
    });

    it('a DIFFERENT identity is unaffected — gets its own fresh trial', async () => {
        const phoneA = freshPhone();
        const phoneB = freshPhone();

        const a = await authService.findOrCreateUserByPhone(phoneA, 'User A');
        await authService.deleteUser(a.id); // A consumes + abandons its trial

        // B is a different person — must still get a normal trial.
        const b = await authService.findOrCreateUserByPhone(phoneB, 'User B');
        const subB = await subscriptionsService.getUserSubscription(b.id);
        expect(subB?.status).toBe('trialing');
        expect(new Date(subB!.trialEndsAt!).getTime()).toBeGreaterThan(Date.now());
        expect((await subscriptionsService.canUseAiReplies(b.id)).allowed).toBe(true);
    });
});
