/**
 * Offline (Sham Cash) payment claims, against a real database.
 *
 * Properties that only Postgres can prove:
 *  1. ANTI-REPLAY — a PARTIAL unique index on (rail, transfer_reference_normalized)
 *     while the claim is not rejected: a second account claiming the same
 *     transfer is refused; the same merchant resending the same transfer gets
 *     the existing claim back (a lost response is not fraud); a rejected
 *     claim releases its reference.
 *  2. THE PENDING CAP UNDER CONCURRENCY — a per-user advisory lock inside the
 *     transaction. A plain count-then-insert let 10 concurrent submits store 10
 *     rows against a cap of 3 (measured during review).
 *  3. APPROVE = GRANT, atomically — the subscription row, the granted_* stamp
 *     and the audit row commit together; the CHECK makes approved ⇔ granted.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import './setup';
import { testDb, createTestUser } from './setup';
import { adminAuditLogs, offlinePayments, offlinePaymentReceipts, plans, subscriptions } from '../../src/db/schema';
import { offlinePaymentsService } from '../../src/services/offlinePayments';
import { OFFLINE_PAYMENT_MAX_PENDING_PER_USER } from '@jawab24/shared';

const PLAN_SLUG = 'offline-test-plan';
const MONTHLY_ONLY_SLUG = 'offline-test-monthly-only';
const FREE_SLUG = 'offline-test-free';
let planId: string;

beforeAll(async () => {
    await testDb.insert(plans).values({
        name: 'Offline Test', slug: PLAN_SLUG, price: 2900, yearlyPrice: 29000, isActive: true,
    }).onConflictDoNothing({ target: plans.slug });
    const [row] = await testDb.select({ id: plans.id }).from(plans).where(eq(plans.slug, PLAN_SLUG)).limit(1);
    planId = row.id;
});

afterAll(async () => {
    // The per-test TRUNCATE of `users` cascades to claims and receipts; `plans`
    // is never truncated, so this suite drops the plans it created (claims
    // first: the plan FK is RESTRICT on purpose).
    for (const slug of [PLAN_SLUG, MONTHLY_ONLY_SLUG, FREE_SLUG]) {
        const [row] = await testDb.select({ id: plans.id }).from(plans).where(eq(plans.slug, slug)).limit(1);
        if (!row) continue;
        await testDb.delete(offlinePayments).where(eq(offlinePayments.planId, row.id));
        await testDb.delete(plans).where(eq(plans.id, row.id));
    }
});

function submission(userId: string, transferReference: string, overrides: Record<string, unknown> = {}) {
    return { userId, rail: 'sham_cash' as const, planId, billingInterval: 'month' as const, transferReference, ...overrides };
}

async function submitOk(userId: string, ref: string, overrides: Record<string, unknown> = {}) {
    const result = await offlinePaymentsService.submit(submission(userId, ref, overrides));
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.failure)}`);
    return result;
}

describe('offlinePaymentsService.submit', () => {
    it('records a claim awaiting review, with the amount taken from the plan', async () => {
        const user = await createTestUser();
        const result = await submitOk(user.id, `REF-${Date.now()}-A`);
        expect(result.replayed).toBe(false);
        expect(result.claim.status).toBe('pending_review');
        expect(result.claim.amountCents).toBe(2900);
        expect(result.claim.planSlug).toBe(PLAN_SLUG);
        // The merchant shape carries no reviewer-only fields.
        expect(result.claim).not.toHaveProperty('reviewNote');
        expect(result.claim).not.toHaveProperty('userId');
    });

    it('charges the YEARLY price for a yearly claim', async () => {
        const user = await createTestUser();
        const result = await submitOk(user.id, `REF-${Date.now()}-Y`, { billingInterval: 'year' });
        expect(result.claim.amountCents).toBe(29000);
    });

    it('returns the EXISTING claim when the same merchant resends the same transfer (a lost response is not fraud)', async () => {
        const user = await createTestUser();
        const ref = `REF-${Date.now()}-R`;
        const first = await submitOk(user.id, ref);
        const again = await offlinePaymentsService.submit(submission(user.id, ref));
        expect(again.ok).toBe(true);
        if (!again.ok) return;
        expect(again.replayed).toBe(true);
        expect(again.claim.id).toBe(first.claim.id);
        const rows = await testDb.select().from(offlinePayments).where(eq(offlinePayments.userId, user.id));
        expect(rows).toHaveLength(1);
    });

    it('REFUSES the same reference from the same merchant against a DIFFERENT plan/interval — that is a real conflict', async () => {
        const user = await createTestUser();
        const ref = `REF-${Date.now()}-RI`;
        await submitOk(user.id, ref);
        const other = await offlinePaymentsService.submit(submission(user.id, ref, { billingInterval: 'year' }));
        expect(other).toEqual({ ok: false, failure: { reason: 'duplicate_reference' } });
    });

    it('REFUSES a reference already claimed by a DIFFERENT account — however the digits were typed', async () => {
        const owner = await createTestUser();
        const thief = await createTestUser();
        const ref = `84719203`;
        await submitOk(owner.id, ref);
        // Respellings a phone keyboard produces — separators, Arabic-Indic digits,
        // and the invisible characters that defeated the first normalizer.
        for (const spelling of ['8471-9203', '٨٤٧١٩٢٠٣', '8471​9203', '84719203‏', '８４７１９２０３']) {
            const stolen = await offlinePaymentsService.submit(submission(thief.id, spelling));
            expect(stolen, spelling).toEqual({ ok: false, failure: { reason: 'duplicate_reference' } });
        }
    });

    it('enforces the pending cap under CONCURRENCY — exactly the cap succeeds, the rest are refused', async () => {
        const user = await createTestUser();
        const N = OFFLINE_PAYMENT_MAX_PENDING_PER_USER + 7;
        const results = await Promise.all(
            Array.from({ length: N }, (_, i) => offlinePaymentsService.submit(submission(user.id, `RACE-${Date.now()}-${i}`))),
        );
        const ok = results.filter((r) => r.ok).length;
        const capped = results.filter((r) => !r.ok && r.failure.reason === 'too_many_pending').length;
        expect(ok).toBe(OFFLINE_PAYMENT_MAX_PENDING_PER_USER);
        expect(capped).toBe(N - OFFLINE_PAYMENT_MAX_PENDING_PER_USER);
        const rows = await testDb.select().from(offlinePayments).where(eq(offlinePayments.userId, user.id));
        expect(rows).toHaveLength(OFFLINE_PAYMENT_MAX_PENDING_PER_USER);
    });

    it('stores the receipt with the claim and deletes it with the claim', async () => {
        const user = await createTestUser();
        const result = await submitOk(user.id, `REF-${Date.now()}-IMG`, {
            receipt: { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]), mimeType: 'image/jpeg' },
        });
        expect(result.claim.hasReceipt).toBe(true);
        await testDb.delete(offlinePayments).where(eq(offlinePayments.id, result.claim.id));
        const orphans = await testDb.select().from(offlinePaymentReceipts).where(eq(offlinePaymentReceipts.offlinePaymentId, result.claim.id));
        expect(orphans).toHaveLength(0);
    });

    it('REFUSES a yearly claim on a plan with no yearly price, instead of inventing one', async () => {
        await testDb.insert(plans).values({ name: 'Monthly only', slug: MONTHLY_ONLY_SLUG, price: 1500, yearlyPrice: null, isActive: true })
            .onConflictDoNothing({ target: plans.slug });
        const [monthly] = await testDb.select({ id: plans.id }).from(plans).where(eq(plans.slug, MONTHLY_ONLY_SLUG)).limit(1);
        const user = await createTestUser();
        const result = await offlinePaymentsService.submit(submission(user.id, `REF-${Date.now()}-MO`, { planId: monthly.id, billingInterval: 'year' }));
        expect(result).toEqual({ ok: false, failure: { reason: 'plan_not_purchasable' } });
    });

    it('refuses a free plan and an unknown plan', async () => {
        await testDb.insert(plans).values({ name: 'Free', slug: FREE_SLUG, price: 0, isActive: true }).onConflictDoNothing({ target: plans.slug });
        const [free] = await testDb.select({ id: plans.id }).from(plans).where(eq(plans.slug, FREE_SLUG)).limit(1);
        const user = await createTestUser();
        expect(await offlinePaymentsService.submit(submission(user.id, `REF-${Date.now()}-F`, { planId: free.id })))
            .toEqual({ ok: false, failure: { reason: 'plan_not_purchasable' } });
        expect(await offlinePaymentsService.submit(submission(user.id, `REF-${Date.now()}-U`, { planId: '00000000-0000-4000-8000-000000000000' })))
            .toEqual({ ok: false, failure: { reason: 'plan_not_found' } });
    });
});

describe('offlinePaymentsService.review', () => {
    it('APPROVE grants the plan for the claimed period in the same transaction, and stamps what it granted', async () => {
        const merchant = await createTestUser();
        const reviewer = await createTestUser({ isAdmin: true });
        const { claim } = await submitOk(merchant.id, `REF-${Date.now()}-AP`, { billingInterval: 'year' });

        const result = await offlinePaymentsService.review(claim.id, 'approved', reviewer.id, 'matched statement line 12');

        expect(result.outcome).toBe('updated');
        if (result.outcome !== 'updated') return;
        expect(result.claim.status).toBe('approved');
        expect(result.claim.grantedAt).not.toBeNull();
        expect(result.claim.reviewNote).toBe('matched statement line 12');

        const [sub] = await testDb.select().from(subscriptions).where(eq(subscriptions.userId, merchant.id));
        expect(sub.status).toBe('active');
        expect(sub.planId).toBe(planId);
        expect(sub.paymentMethod).toBe('sham_cash');
        expect(result.claim.grantedSubscriptionId).toBe(sub.id);
        const months = (sub.currentPeriodEnd!.getFullYear() - sub.currentPeriodStart!.getFullYear()) * 12
            + (sub.currentPeriodEnd!.getMonth() - sub.currentPeriodStart!.getMonth());
        expect(months).toBe(12);

        const audits = await testDb.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetUserId, merchant.id));
        expect(audits.map((a) => a.action).sort()).toEqual(['manual_upgrade', 'offline_payment_review']);
        const review = audits.find((a) => a.action === 'offline_payment_review')!;
        expect(review.adminUserId).toBe(reviewer.id);
        expect(review.paymentReference).toBe(claim.transferReference);
        expect((review.newValue as { grantedSubscriptionId: string }).grantedSubscriptionId).toBe(sub.id);
    });

    it('decides exactly once — a second decision gets the current row back, not a second grant', async () => {
        const merchant = await createTestUser();
        const reviewer = await createTestUser({ isAdmin: true });
        const { claim } = await submitOk(merchant.id, `REF-${Date.now()}-TW`);
        await offlinePaymentsService.review(claim.id, 'approved', reviewer.id);
        const second = await offlinePaymentsService.review(claim.id, 'rejected', reviewer.id);
        expect(second.outcome).toBe('already_reviewed');
        if (second.outcome !== 'already_reviewed') return;
        expect(second.claim.status).toBe('approved');
        const audits = await testDb.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetUserId, merchant.id));
        expect(audits.filter((a) => a.action === 'offline_payment_review')).toHaveLength(1);
    });

    it('answers not_found for an unknown id', async () => {
        const reviewer = await createTestUser({ isAdmin: true });
        expect(await offlinePaymentsService.review('00000000-0000-4000-8000-000000000000', 'approved', reviewer.id))
            .toEqual({ outcome: 'not_found' });
    });

    it('REJECT grants nothing, frees the pending slot, and RELEASES the reference for a corrected re-file', async () => {
        const merchant = await createTestUser();
        const reviewer = await createTestUser({ isAdmin: true });
        const ref = `REF-${Date.now()}-RJ`;
        const { claim } = await submitOk(merchant.id, ref);
        const result = await offlinePaymentsService.review(claim.id, 'rejected', reviewer.id, 'wrong amount');
        expect(result.outcome).toBe('updated');
        if (result.outcome !== 'updated') return;
        expect(result.claim.grantedAt).toBeNull();
        expect(await testDb.select().from(subscriptions).where(eq(subscriptions.userId, merchant.id))).toHaveLength(0);

        const refiled = await offlinePaymentsService.submit(submission(merchant.id, ref));
        expect(refiled.ok).toBe(true);
        if (!refiled.ok) return;
        expect(refiled.replayed).toBe(false);
        expect(refiled.claim.id).not.toBe(claim.id);
    });
});

describe('offlinePaymentsService.list', () => {
    it('pages the pending queue OLDEST first with a keyset cursor and a total', async () => {
        const merchant = await createTestUser();
        const ids: string[] = [];
        for (let i = 0; i < 3; i++) {
            const { claim } = await submitOk(merchant.id, `REF-${Date.now()}-L${i}`);
            ids.push(claim.id);
        }
        const page1 = await offlinePaymentsService.list({ status: 'pending_review', limit: 2 });
        expect(page1.total).toBe(3);
        expect(page1.claims.map((c) => c.id)).toEqual(ids.slice(0, 2));
        expect(page1.nextCursor).not.toBeNull();
        const page2 = await offlinePaymentsService.list({ status: 'pending_review', limit: 2, cursor: page1.nextCursor });
        expect(page2.claims.map((c) => c.id)).toEqual([ids[2]]);
        expect(page2.nextCursor).toBeNull();
        // The reviewer's view carries the fields the merchant's does not.
        expect(page1.claims[0]).toMatchObject({ userId: merchant.id, reviewNote: null, grantedAt: null });
    });
});
