/**
 * Backfill the payments ledger from the money we already recorded elsewhere.
 *
 * The ledger starts empty, so on day one "who paid" would show every existing
 * paying merchant as never-paid — which is worse than no feature at all,
 * because a rep would chase merchants who are current. This walks the two
 * tables that already hold settled money and books each row once:
 *
 *   - `payment_requests` (status='paid')      → the Stripe collect links
 *   - `topup_purchases`  (status='succeeded') → credit packs, Stripe AND manual
 *
 * Idempotent by construction: every row is keyed `backfill:<table>:<id>` on the
 * ledger's unique `idempotency_key`, so re-running inserts nothing new. Safe to
 * run twice, and safe to run after a partial failure.
 *
 * NOT backfilled: Stripe subscription invoices before this deploy. They live in
 * Stripe, not in our database — `subscriptions` keeps current state, not a
 * payment history — so recovering them needs the Stripe API, and inventing a
 * row per period from `current_period_start` would fabricate payments that may
 * never have happened (a canceled-then-resubscribed merchant, a failed renewal).
 * From this deploy forward the webhook books them live.
 *
 *   npx tsx scripts/backfill-payments-ledger.ts            # dry run, prints a plan
 *   npx tsx scripts/backfill-payments-ledger.ts --apply    # writes
 */
import { db } from '../src/db';
import { payments, paymentRequests, topupPurchases, users } from '../src/db/schema';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { commissionCentsFor } from '../src/services/payments';

const APPLY = process.argv.includes('--apply');

interface PlannedRow {
    userId: string;
    amountCents: number;
    currency: string;
    method: 'stripe' | 'cash' | 'sham_cash' | 'bank_transfer' | 'other';
    collectedBy: 'stripe' | 'admin';
    paidAt: Date;
    externalRef: string | null;
    note: string;
    idempotencyKey: string;
}

async function main() {
    const planned: PlannedRow[] = [];

    const paidRequests = await db
        .select({
            id: paymentRequests.id,
            userId: paymentRequests.userId,
            amountCents: paymentRequests.amountCents,
            currency: paymentRequests.currency,
            description: paymentRequests.description,
            stripePaymentIntentId: paymentRequests.stripePaymentIntentId,
            paidAt: paymentRequests.paidAt,
            createdAt: paymentRequests.createdAt,
        })
        .from(paymentRequests)
        .where(eq(paymentRequests.status, 'paid'));

    for (const r of paidRequests) {
        planned.push({
            userId: r.userId,
            amountCents: r.amountCents,
            currency: r.currency,
            method: 'stripe',
            collectedBy: 'stripe',
            paidAt: r.paidAt ?? r.createdAt,
            externalRef: r.stripePaymentIntentId,
            note: r.description ? `Collect link: ${r.description}` : 'Collect link',
            idempotencyKey: `backfill:payment_request:${r.id}`,
        });
    }

    const succeededTopups = await db
        .select({
            id: topupPurchases.id,
            userId: topupPurchases.userId,
            priceCents: topupPurchases.priceCents,
            currency: topupPurchases.currency,
            source: topupPurchases.source,
            pack: topupPurchases.pack,
            externalRef: topupPurchases.externalRef,
            stripePaymentIntentId: topupPurchases.stripePaymentIntentId,
            succeededAt: topupPurchases.succeededAt,
            createdAt: topupPurchases.createdAt,
        })
        .from(topupPurchases)
        .where(eq(topupPurchases.status, 'succeeded'));

    for (const t of succeededTopups) {
        // A manual grant's `price_cents` is the LIST price of the pack, which is
        // what we billed — but an admin grant may have been a gift. Both are
        // booked; a gift is voided by hand afterwards rather than guessed at
        // here, because guessing loses real revenue silently.
        planned.push({
            userId: t.userId,
            amountCents: t.priceCents,
            currency: t.currency,
            method: t.source === 'stripe' ? 'stripe' : 'other',
            collectedBy: t.source === 'stripe' ? 'stripe' : 'admin',
            paidAt: t.succeededAt ?? t.createdAt,
            externalRef: t.stripePaymentIntentId ?? t.externalRef,
            note: `Top-up ${t.pack} (${t.source})`,
            idempotencyKey: `backfill:topup:${t.id}`,
        });
    }

    // Drop rows whose merchant no longer exists (the ledger FK is ON DELETE
    // CASCADE, but the insert itself would fail on a missing user).
    const userIds = [...new Set(planned.map(p => p.userId))];
    const live = new Set(
        userIds.length > 0
            ? (await db.select({ id: users.id }).from(users).where(inArray(users.id, userIds))).map(u => u.id)
            : [],
    );
    const orphaned = planned.filter(p => !live.has(p.userId));
    const usable = planned.filter(p => live.has(p.userId));

    // Which are already booked — so a re-run reports honestly instead of
    // claiming it inserted rows that conflict-skipped.
    const keys = usable.map(p => p.idempotencyKey);
    const already = new Set(
        keys.length > 0
            ? (await db
                .select({ k: payments.idempotencyKey })
                .from(payments)
                .where(and(isNotNull(payments.idempotencyKey), inArray(payments.idempotencyKey, keys)))
              ).map(r => r.k as string)
            : [],
    );
    const fresh = usable.filter(p => !already.has(p.idempotencyKey));

    const totalCents = fresh.reduce((sum, p) => sum + p.amountCents, 0);
    console.log(`payment_requests(paid):   ${paidRequests.length}`);
    console.log(`topup_purchases(succeeded): ${succeededTopups.length}`);
    console.log(`already in ledger:        ${already.size}`);
    console.log(`skipped (merchant gone):  ${orphaned.length}`);
    console.log(`to insert:                ${fresh.length}  ($${(totalCents / 100).toFixed(2)})`);

    if (!APPLY) {
        console.log('\nDry run. Re-run with --apply to write.');
        return;
    }
    if (fresh.length === 0) {
        console.log('\nNothing to insert.');
        return;
    }

    // Attribution snapshot: whoever owns the merchant today. Historic rows
    // predate the partners table, so "today's rep" is the only answer that
    // exists — and it is the right one for a payout conversation about a book
    // he is being handed.
    const partnerByUser = new Map<string, { partnerId: string; pct: number }>();
    const attributed = await db
        .select({
            userId: users.id,
            partnerId: users.partnerId,
            pct: sql<number>`COALESCE((SELECT commission_pct FROM partners WHERE partners.id = ${users.partnerId}), 0)::int`,
        })
        .from(users)
        .where(and(inArray(users.id, [...new Set(fresh.map(p => p.userId))]), isNotNull(users.partnerId)));
    for (const a of attributed) {
        if (a.partnerId) partnerByUser.set(a.userId, { partnerId: a.partnerId, pct: a.pct });
    }

    let inserted = 0;
    for (const p of fresh) {
        const attribution = partnerByUser.get(p.userId);
        const pct = attribution?.pct ?? 0;
        const result = await db
            .insert(payments)
            .values({
                userId: p.userId,
                partnerId: attribution?.partnerId ?? null,
                amountCents: p.amountCents,
                currency: p.currency,
                method: p.method,
                collectedBy: p.collectedBy,
                commissionPct: pct,
                commissionCents: commissionCentsFor(p.amountCents, pct),
                // Historic money is money we already have — settled by
                // definition, never outstanding against a rep.
                status: 'settled',
                settledAt: p.paidAt,
                externalRef: p.externalRef,
                note: p.note,
                idempotencyKey: p.idempotencyKey,
                paidAt: p.paidAt,
            })
            .onConflictDoNothing({ target: payments.idempotencyKey })
            .returning({ id: payments.id });
        inserted += result.length;
    }

    console.log(`\nInserted ${inserted} ledger rows.`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
