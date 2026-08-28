/**
 * Offline (Sham Cash) payment claims, against a real database.
 *
 * Two properties can only be proven here, because both live in Postgres and not
 * in the service's control flow:
 *
 *  1. ANTI-REPLAY. The claim's uniqueness is a unique index on
 *     (rail, transfer_reference_normalized). A mocked test would only prove that
 *     the service calls insert; it takes a real index to prove that the SECOND
 *     submission of the same transfer — by the same merchant or by a different
 *     account, and however the digits were typed — is refused. Without that, one
 *     receipt renews a subscription forever.
 *  2. The amount is resolved SERVER-side from the plan. A claim is reviewed
 *     against a wallet statement, so the number on it must be the number we
 *     asked for, not one a client sent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import './setup';
import { testDb, createTestUser } from './setup';
import { offlinePayments, offlinePaymentReceipts, plans } from '../../src/db/schema';
import { offlinePaymentsService } from '../../src/services/offlinePayments';
import { OFFLINE_PAYMENT_MAX_PENDING_PER_USER } from '@jawab24/shared';

const PLAN_SLUG = 'offline-test-plan';
const MONTHLY_ONLY_SLUG = 'offline-test-monthly-only';
const FREE_SLUG = 'offline-test-free';
let planId: string;

beforeAll(async () => {
    // Idempotent by slug — nothing truncates `plans`, so a crashed prior run
    // leaves the row behind (same reasoning as the zid provisioning suite).
    await testDb.insert(plans).values({
        name: 'Offline Test', slug: PLAN_SLUG, price: 2900, yearlyPrice: 29000, isActive: true,
    }).onConflictDoNothing({ target: plans.slug });
    const [row] = await testDb.select({ id: plans.id }).from(plans).where(eq(plans.slug, PLAN_SLUG)).limit(1);
    planId = row.id;
});

afterAll(async () => {
    // Claims first: the plan FK is RESTRICT on purpose — a plan must not vanish
    // from under an unreviewed claim — so the plan cannot be dropped while its
    // rows exist. `offline_payments` is not in the per-test TRUNCATE list, so
    // this suite owns its own cleanup.
    for (const slug of [PLAN_SLUG, MONTHLY_ONLY_SLUG, FREE_SLUG]) {
        const [row] = await testDb.select({ id: plans.id }).from(plans).where(eq(plans.slug, slug)).limit(1);
        if (!row) continue;
        await testDb.delete(offlinePayments).where(eq(offlinePayments.planId, row.id));
        await testDb.delete(plans).where(eq(plans.id, row.id));
    }
});

function submission(userId: string, transferReference: string, overrides: Record<string, unknown> = {}) {
    return {
        userId,
        rail: 'sham_cash' as const,
        planId,
        billingInterval: 'month' as const,
        transferReference,
        ...overrides,
    };
}

describe('offlinePaymentsService.submit', () => {
    it('records a claim awaiting review, with the amount taken from the plan', async () => {
        const user = await createTestUser();

        const result = await offlinePaymentsService.submit(submission(user.id, `REF-${Date.now()}-A`));

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.row.status).toBe('pending_review');
        expect(result.row.amountCents).toBe(2900);
        expect(result.row.planSlug).toBe(PLAN_SLUG);
    });

    it('charges the YEARLY price for a yearly claim', async () => {
        const user = await createTestUser();

        const result = await offlinePaymentsService.submit(
            submission(user.id, `REF-${Date.now()}-Y`, { billingInterval: 'year' }),
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.row.amountCents).toBe(29000);
    });

    it('REFUSES the same transfer reference twice', async () => {
        const user = await createTestUser();
        const reference = `REF-${Date.now()}-DUP`;

        const first = await offlinePaymentsService.submit(submission(user.id, reference));
        const second = await offlinePaymentsService.submit(submission(user.id, reference));

        expect(first.ok).toBe(true);
        expect(second.ok).toBe(false);
        if (second.ok) return;
        expect(second.reason).toBe('duplicate_reference');
    });

    it('REFUSES a reference already claimed by a DIFFERENT account', async () => {
        // The abuse the cross-user scope exists for: a reference names one real
        // transfer, so a second account claiming it is claiming someone else's
        // money. Scoping uniqueness per user would let that through.
        const first = await createTestUser();
        const second = await createTestUser();
        const reference = `REF-${Date.now()}-XUSER`;

        expect((await offlinePaymentsService.submit(submission(first.id, reference))).ok).toBe(true);
        const stolen = await offlinePaymentsService.submit(submission(second.id, reference));

        expect(stolen.ok).toBe(false);
        if (stolen.ok) return;
        expect(stolen.reason).toBe('duplicate_reference');
    });

    it('REFUSES the same reference respelled with spaces, dashes, or Arabic-Indic digits', async () => {
        // A merchant retyping off their phone will not reproduce the spacing.
        // If any of these spellings got through, the receipt would be reusable.
        const user = await createTestUser();
        const stamp = String(Date.now()).slice(-6);
        const base = `84${stamp}`;
        const arabicIndic = base.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));

        expect((await offlinePaymentsService.submit(submission(user.id, base))).ok).toBe(true);

        for (const respelling of [` ${base} `, `84-${stamp}`, `84 ${stamp}`, arabicIndic]) {
            const again = await offlinePaymentsService.submit(submission(user.id, respelling));
            expect(again.ok, `respelling "${respelling}" was accepted`).toBe(false);
        }
    });

    it('stores an optional receipt in its own table, keyed to the claim', async () => {
        const user = await createTestUser();
        const bytes = Buffer.from('fake-image-bytes');

        const result = await offlinePaymentsService.submit(
            submission(user.id, `REF-${Date.now()}-IMG`, { receipt: { bytes, mimeType: 'image/png' } }),
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.row.hasReceipt).toBe(true);

        const stored = await offlinePaymentsService.getReceipt(result.row.id);
        expect(stored?.mimeType).toBe('image/png');
        expect(stored?.bytes.equals(bytes)).toBe(true);
    });

    it('deletes the receipt with the claim (no orphaned financial documents)', async () => {
        const user = await createTestUser();
        const result = await offlinePaymentsService.submit(
            submission(user.id, `REF-${Date.now()}-CASCADE`, {
                receipt: { bytes: Buffer.from('x'), mimeType: 'image/png' },
            }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        await testDb.delete(offlinePayments).where(eq(offlinePayments.id, result.row.id));

        const receipts = await testDb
            .select()
            .from(offlinePaymentReceipts)
            .where(eq(offlinePaymentReceipts.offlinePaymentId, result.row.id));
        expect(receipts).toHaveLength(0);
    });

    it('caps how many claims one account may leave awaiting review', async () => {
        const user = await createTestUser();
        for (let i = 0; i < OFFLINE_PAYMENT_MAX_PENDING_PER_USER; i++) {
            const ok = await offlinePaymentsService.submit(submission(user.id, `REF-${Date.now()}-CAP${i}`));
            expect(ok.ok).toBe(true);
        }

        const overflow = await offlinePaymentsService.submit(submission(user.id, `REF-${Date.now()}-CAPX`));
        expect(overflow.ok).toBe(false);
        if (overflow.ok) return;
        expect(overflow.reason).toBe('too_many_pending');
    });

    it('REFUSES a yearly claim on a plan with no yearly price, instead of inventing one', async () => {
        // The frontend's display helper would quote monthly × 10 here so the
        // pricing grid still renders. A claim is money that gets matched against
        // a wallet statement, so an invented figure is worse than a refusal.
        await testDb.insert(plans).values({
            name: 'Monthly Only', slug: MONTHLY_ONLY_SLUG, price: 2900, yearlyPrice: null, isActive: true,
        }).onConflictDoNothing({ target: plans.slug });
        const [monthlyOnly] = await testDb
            .select({ id: plans.id }).from(plans).where(eq(plans.slug, MONTHLY_ONLY_SLUG)).limit(1);
        const user = await createTestUser();

        const yearly = await offlinePaymentsService.submit({
            ...submission(user.id, `REF-${Date.now()}-NOYEAR`),
            planId: monthlyOnly.id,
            billingInterval: 'year',
        });
        expect(yearly.ok).toBe(false);
        if (yearly.ok) return;
        expect(yearly.reason).toBe('plan_not_purchasable');

        // ...while the monthly claim on the same plan is fine.
        const monthly = await offlinePaymentsService.submit({
            ...submission(user.id, `REF-${Date.now()}-YESMONTH`),
            planId: monthlyOnly.id,
        });
        expect(monthly.ok).toBe(true);
        if (!monthly.ok) return;
        expect(monthly.row.amountCents).toBe(2900);
    });

    it('refuses a free plan', async () => {
        await testDb.insert(plans).values({
            name: 'Free Tier', slug: FREE_SLUG, price: 0, isActive: true,
        }).onConflictDoNothing({ target: plans.slug });
        const [free] = await testDb
            .select({ id: plans.id }).from(plans).where(eq(plans.slug, FREE_SLUG)).limit(1);
        const user = await createTestUser();

        const result = await offlinePaymentsService.submit({
            ...submission(user.id, `REF-${Date.now()}-FREE`),
            planId: free.id,
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('plan_not_purchasable');
    });

    it('refuses a plan that does not exist', async () => {
        const user = await createTestUser();
        const result = await offlinePaymentsService.submit({
            ...submission(user.id, `REF-${Date.now()}-NOPLAN`),
            planId: '00000000-0000-0000-0000-000000000000',
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('plan_not_found');
    });
});

describe('offlinePaymentsService.review', () => {
    it('moves a pending claim exactly once', async () => {
        const user = await createTestUser();
        const result = await offlinePaymentsService.submit(submission(user.id, `REF-${Date.now()}-REV`));
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // Two admins pressing Approve on a stale queue, or one double-click.
        const first = await offlinePaymentsService.review(result.row.id, 'approved', user.id, 'matched');
        const second = await offlinePaymentsService.review(result.row.id, 'rejected', user.id, null);

        expect(first).toBe(true);
        expect(second).toBe(false);

        const [row] = await testDb
            .select({ status: offlinePayments.status, note: offlinePayments.reviewNote })
            .from(offlinePayments)
            .where(eq(offlinePayments.id, result.row.id));
        expect(row.status).toBe('approved');
        expect(row.note).toBe('matched');
    });

    it('frees the pending slot once reviewed', async () => {
        // Otherwise a merchant whose claims were all approved could never submit
        // another transfer — the cap is an abuse bound, not a lifetime limit.
        const user = await createTestUser();
        const submitted = [];
        for (let i = 0; i < OFFLINE_PAYMENT_MAX_PENDING_PER_USER; i++) {
            const r = await offlinePaymentsService.submit(submission(user.id, `REF-${Date.now()}-SLOT${i}`));
            expect(r.ok).toBe(true);
            if (r.ok) submitted.push(r.row.id);
        }
        await offlinePaymentsService.review(submitted[0], 'approved', user.id, null);

        const next = await offlinePaymentsService.submit(submission(user.id, `REF-${Date.now()}-SLOTX`));
        expect(next.ok).toBe(true);
    });
});
