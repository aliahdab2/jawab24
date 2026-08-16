import { db } from '../db';
import { payments, partners, users, adminAuditLogs } from '../db/schema';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

/**
 * Payments ledger — the single record of every dollar a merchant pays us,
 * whoever collected it.
 *
 * ONE service for both surfaces on purpose. The reseller portal and the admin
 * console record the same event with different actors, so a second
 * "manual payment" implementation would duplicate the commission snapshot and
 * the settlement invariant — the two things that must not drift (Rule 10.8).
 *
 * ⛔ Nothing here grants entitlement. Recording a payment never extends a
 * subscription, never credits `users.topup_balance`, never unblocks replies.
 * That separation is the reason a rep may write to this table at all: the worst
 * a wrong row can do is misstate a report, which an admin can void.
 */

export const PAYMENT_METHODS = ['stripe', 'cash', 'sham_cash', 'bank_transfer', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_COLLECTORS = ['stripe', 'partner', 'admin'] as const;
export type PaymentCollector = (typeof PAYMENT_COLLECTORS)[number];

export type PaymentStatus = 'recorded' | 'settled' | 'void';

/**
 * Upper bound on a single recorded payment ($100,000). Not a business rule —
 * a typo guard. The largest real invoice is three orders of magnitude below it,
 * and an unbounded integer field reachable by a non-admin is how a mis-keyed
 * "790" becomes "79000000" in a revenue report nobody reconciles by hand.
 */
export const MAX_PAYMENT_CENTS = 10_000_000;

export interface RecordPaymentInput {
    userId: string;
    amountCents: number;
    currency?: string;
    method: PaymentMethod;
    paidAt: Date;
    coversPeriodStart?: Date | null;
    coversPeriodEnd?: Date | null;
    externalRef?: string | null;
    note?: string | null;
    idempotencyKey?: string | null;
}

export interface PaymentActor {
    /** The Jawab24 user recording it — the rep's login, or the admin's. */
    userId: string;
    /** 'partner' when a rep holds the cash; 'admin' or 'stripe' otherwise. */
    collectedBy: PaymentCollector;
    /** Set for a rep-collected payment; drives the commission snapshot. */
    partnerId?: string | null;
}

export class PaymentValidationError extends Error {
    constructor(message: string, readonly code: string) {
        super(message);
        this.name = 'PaymentValidationError';
    }
}

/**
 * The rep's cut, in cents, rounded half-up to the cent.
 *
 * Exported and used by BOTH write paths so the number an admin sees is the
 * number the ledger stored — a second rounding rule in the UI is how a $0.01
 * discrepancy per row turns into an argument about a payout total.
 */
export function commissionCentsFor(amountCents: number, commissionPct: number): number {
    return Math.round((amountCents * commissionPct) / 100);
}

/**
 * A rep-collected payment starts OUTSTANDING — he is holding the money. Anything
 * the system or an admin took is settled the moment it exists: there is no
 * handover pending. Centralised because the DB CHECK
 * (`payments_settled_consistency`) rejects any pair that disagrees.
 */
function initialSettlement(collectedBy: PaymentCollector, paidAt: Date): { status: PaymentStatus; settledAt: Date | null } {
    return collectedBy === 'partner'
        ? { status: 'recorded', settledAt: null }
        : { status: 'settled', settledAt: paidAt };
}

class PaymentsService {
    /**
     * Record one payment. Validates hard, because the partner path is reachable
     * by a non-admin: bounds, enum membership, a real merchant, and a paid-at
     * that cannot be in the future (a future-dated row silently vanishes from
     * "collected this month" and shows up again later).
     */
    async record(input: RecordPaymentInput, actor: PaymentActor) {
        const amount = Math.trunc(input.amountCents);
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new PaymentValidationError('Amount must be a positive number of cents', 'INVALID_AMOUNT');
        }
        if (amount > MAX_PAYMENT_CENTS) {
            throw new PaymentValidationError('Amount exceeds the per-payment limit', 'AMOUNT_TOO_LARGE');
        }
        if (!PAYMENT_METHODS.includes(input.method)) {
            throw new PaymentValidationError('Unknown payment method', 'INVALID_METHOD');
        }
        // Tolerate a little clock skew between the rep's device and the server,
        // but not a date typed as next year.
        if (input.paidAt.getTime() > Date.now() + 5 * 60_000) {
            throw new PaymentValidationError('Payment date cannot be in the future', 'FUTURE_PAID_AT');
        }
        if (
            input.coversPeriodStart && input.coversPeriodEnd &&
            input.coversPeriodStart.getTime() > input.coversPeriodEnd.getTime()
        ) {
            throw new PaymentValidationError('Covered period ends before it starts', 'INVALID_PERIOD');
        }

        // Snapshot the rate NOW. Re-reading `partners.commission_pct` at report
        // time would rewrite history the day a rate changes.
        let commissionPct = 0;
        if (actor.partnerId) {
            const [partner] = await db
                .select({ pct: partners.commissionPct })
                .from(partners)
                .where(eq(partners.id, actor.partnerId))
                .limit(1);
            commissionPct = partner?.pct ?? 0;
        }

        const { status, settledAt } = initialSettlement(actor.collectedBy, input.paidAt);

        const [row] = await db
            .insert(payments)
            .values({
                userId: input.userId,
                partnerId: actor.partnerId ?? null,
                amountCents: amount,
                currency: (input.currency ?? 'usd').toLowerCase(),
                method: input.method,
                collectedBy: actor.collectedBy,
                coversPeriodStart: input.coversPeriodStart ?? null,
                coversPeriodEnd: input.coversPeriodEnd ?? null,
                commissionPct,
                commissionCents: commissionCentsFor(amount, commissionPct),
                status,
                settledAt,
                externalRef: input.externalRef ?? null,
                note: input.note ?? null,
                idempotencyKey: input.idempotencyKey ?? null,
                // A Stripe row has no human author — attributing it to the
                // merchant would read as "the merchant recorded a payment".
                recordedByUserId: actor.collectedBy === 'stripe' ? null : actor.userId,
                paidAt: input.paidAt,
            })
            // A double-tapped submit carries the same key: return the existing
            // row instead of a second payment. `onConflictDoNothing` returns []
            // on collision, which the caller below resolves back to the winner.
            .onConflictDoNothing({ target: payments.idempotencyKey })
            .returning();

        if (!row) {
            if (!input.idempotencyKey) {
                throw new PaymentValidationError('Payment could not be recorded', 'INSERT_FAILED');
            }
            const [existing] = await db
                .select()
                .from(payments)
                .where(eq(payments.idempotencyKey, input.idempotencyKey))
                .limit(1);
            if (!existing) {
                throw new PaymentValidationError('Payment could not be recorded', 'INSERT_FAILED');
            }
            return existing;
        }

        // Money entering the books is exactly the kind of write "who did this,
        // and when?" must be answerable for after the fact. Stripe rows are
        // exempt: they have no human author, and one audit row per renewal
        // would bury the human actions this log exists to surface.
        if (actor.collectedBy === 'stripe') return row;

        await db.insert(adminAuditLogs).values({
            adminUserId: actor.collectedBy === 'admin' ? actor.userId : null,
            targetUserId: input.userId,
            action: 'payment_recorded',
            newValue: {
                paymentId: row.id,
                amountCents: amount,
                currency: row.currency,
                method: input.method,
                collectedBy: actor.collectedBy,
                partnerId: actor.partnerId ?? null,
                recordedByUserId: actor.userId,
            },
            paymentReference: input.externalRef ?? null,
            note: input.note ?? null,
        });

        return row;
    }

    /**
     * Record money Stripe collected, from a webhook.
     *
     * NEVER THROWS. The money has already landed and the subscription
     * activation in the same handler is what keeps the merchant serving — a
     * ledger write must not be able to fail that, or a bookkeeping bug becomes
     * an outage. A swallowed failure here costs one missing report row, which
     * the backfill script can repair.
     *
     * Idempotency comes from the Stripe object id, so a replayed webhook (which
     * Stripe does routinely) updates nothing and inserts nothing.
     */
    async recordStripePayment(args: {
        userId: string;
        amountCents: number;
        currency: string;
        stripeRef: string;
        paidAt: Date;
        coversPeriodStart?: Date | null;
        coversPeriodEnd?: Date | null;
        log?: { warn: (obj: unknown, msg: string) => void };
    }) {
        try {
            if (args.amountCents <= 0) return null;

            // Attribute to whoever owns the merchant today. The rep earns on a
            // Stripe payment too — he just never holds it, so it lands settled
            // and never appears in what he owes us.
            const [merchant] = await db
                .select({ partnerId: users.partnerId })
                .from(users)
                .where(eq(users.id, args.userId))
                .limit(1);

            return await this.record(
                {
                    userId: args.userId,
                    amountCents: args.amountCents,
                    currency: args.currency,
                    method: 'stripe',
                    paidAt: args.paidAt,
                    coversPeriodStart: args.coversPeriodStart ?? null,
                    coversPeriodEnd: args.coversPeriodEnd ?? null,
                    externalRef: args.stripeRef,
                    idempotencyKey: `stripe:${args.stripeRef}`,
                },
                { userId: args.userId, collectedBy: 'stripe', partnerId: merchant?.partnerId ?? null },
            );
        } catch (error) {
            args.log?.warn({ err: error, stripeRef: args.stripeRef }, 'Payments ledger: Stripe payment not recorded');
            return null;
        }
    }

    /**
     * Mark a rep-collected payment as received by us (تسليم المبلغ). Admin-only:
     * the rep asserts he collected it, we assert it arrived. Guarded on the
     * current status so a replayed click cannot re-stamp `settled_at`.
     */
    async settle(paymentId: string, adminUserId: string, settledAt = new Date()) {
        const updated = await db
            .update(payments)
            .set({ status: 'settled', settledAt, confirmedByAdminUserId: adminUserId, updatedAt: new Date() })
            .where(and(eq(payments.id, paymentId), eq(payments.status, 'recorded')))
            .returning();
        if (updated.length === 0) return null;

        await db.insert(adminAuditLogs).values({
            adminUserId,
            targetUserId: updated[0].userId,
            action: 'payment_settled',
            previousValue: { status: 'recorded' },
            newValue: { paymentId, status: 'settled', settledAt: settledAt.toISOString() },
        });
        return updated[0];
    }

    /**
     * Void a payment — a mistake, a bounced transfer, a duplicate. The row is
     * kept and flagged, never deleted: a ledger that can lose rows cannot be
     * reconciled against anything.
     */
    async void(paymentId: string, adminUserId: string, reason: string) {
        const updated = await db
            .update(payments)
            .set({ status: 'void', settledAt: null, confirmedByAdminUserId: adminUserId, note: reason, updatedAt: new Date() })
            .where(and(eq(payments.id, paymentId), sql`${payments.status} <> 'void'`))
            .returning();
        if (updated.length === 0) return null;

        await db.insert(adminAuditLogs).values({
            adminUserId,
            targetUserId: updated[0].userId,
            action: 'payment_voided',
            newValue: { paymentId, reason },
        });
        return updated[0];
    }

    /** One merchant's payment history, newest first. Bounded. */
    async listForMerchant(userId: string, limit = 100) {
        return db
            .select()
            .from(payments)
            .where(eq(payments.userId, userId))
            .orderBy(desc(payments.paidAt))
            .limit(limit);
    }

    /**
     * A partner's own payments, newest first, with the totals his portal shows:
     * collected, and what he still owes us. Voided rows are excluded from BOTH
     * the list and the totals — a voided payment is not money.
     */
    async listForPartner(partnerId: string, limit = 200) {
        const rows = await db
            .select()
            .from(payments)
            .where(and(eq(payments.partnerId, partnerId), sql`${payments.status} <> 'void'`))
            .orderBy(desc(payments.paidAt))
            .limit(limit);

        const totals = rows.reduce(
            (acc, r) => {
                acc.collectedCents += r.amountCents;
                // What he must hand over: gross minus his cut. Outstanding only
                // while the money is still with him.
                const net = r.amountCents - r.commissionCents;
                acc.netOwedTotalCents += net;
                if (r.status === 'recorded') acc.outstandingCents += net;
                else acc.settledCents += net;
                return acc;
            },
            { collectedCents: 0, netOwedTotalCents: 0, outstandingCents: 0, settledCents: 0 },
        );

        return { rows, totals };
    }

    /**
     * Per-merchant payment state for a batch of merchants — one query, not one
     * per row. Feeds both the "مين ما دفع" chip in the portal list and the same
     * column in admin.
     *
     * `coveredUntil` is the furthest period end any non-void payment claims to
     * cover; `lastPaidAt` answers "when did we last see money from them" for the
     * merchants whose payments carry no period (a cash payment often does not).
     */
    async getPaymentStateFor(userIds: string[]): Promise<Map<string, MerchantPaymentState>> {
        const state = new Map<string, MerchantPaymentState>();
        if (userIds.length === 0) return state;

        const rows = await db
            .select({
                userId: payments.userId,
                lastPaidAt: sql<Date | null>`MAX(${payments.paidAt})`,
                coveredUntil: sql<Date | null>`MAX(${payments.coversPeriodEnd})`,
                paymentCount: sql<number>`COUNT(*)::int`,
                outstandingCents: sql<number>`COALESCE(SUM(CASE WHEN ${payments.status} = 'recorded' THEN ${payments.amountCents} - ${payments.commissionCents} ELSE 0 END), 0)::int`,
                totalCents: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)::int`,
            })
            .from(payments)
            .where(and(inArray(payments.userId, userIds), sql`${payments.status} <> 'void'`))
            .groupBy(payments.userId);

        for (const r of rows) {
            state.set(r.userId, {
                lastPaidAt: r.lastPaidAt ? new Date(r.lastPaidAt) : null,
                coveredUntil: r.coveredUntil ? new Date(r.coveredUntil) : null,
                paymentCount: r.paymentCount,
                outstandingCents: r.outstandingCents,
                totalCents: r.totalCents,
            });
        }
        return state;
    }

    /**
     * Everything a rep still holds, per partner — the number the payout
     * conversation starts from.
     */
    async outstandingByPartner() {
        return db
            .select({
                partnerId: payments.partnerId,
                partnerName: partners.name,
                outstandingCents: sql<number>`COALESCE(SUM(${payments.amountCents} - ${payments.commissionCents}), 0)::int`,
                paymentCount: sql<number>`COUNT(*)::int`,
            })
            .from(payments)
            .innerJoin(partners, eq(payments.partnerId, partners.id))
            .where(eq(payments.status, 'recorded'))
            .groupBy(payments.partnerId, partners.name)
            .orderBy(desc(sql`SUM(${payments.amountCents} - ${payments.commissionCents})`));
    }

    /**
     * Merchants attributed to a partner who have never paid anything — the
     * other half of "مين ما دفع", and the half a payments-only query cannot
     * see (they have no rows at all).
     */
    async neverPaidForPartner(partnerId: string) {
        return db
            .select({ id: users.id, name: users.name, phone: users.phone, createdAt: users.createdAt })
            .from(users)
            .leftJoin(payments, and(eq(payments.userId, users.id), sql`${payments.status} <> 'void'`))
            .where(and(eq(users.partnerId, partnerId), isNull(payments.id)))
            .orderBy(desc(users.createdAt))
            .limit(500);
    }
}

export interface MerchantPaymentState {
    lastPaidAt: Date | null;
    coveredUntil: Date | null;
    paymentCount: number;
    /** Cents this merchant's payments are still sitting with a rep. */
    outstandingCents: number;
    totalCents: number;
}

/**
 * Is this merchant behind on payment, as of `now`?
 *
 * Deliberately conservative — it drives a chip a rep will act on, so a false
 * "مستحق" costs a wrong phone call. A merchant is unpaid only when the
 * subscription period we are billing for has ENDED and no payment claims to
 * cover past it. A merchant still inside a paid period, or on trial, is not
 * unpaid; a merchant with no subscription at all is not unpaid either.
 */
export function isUnpaid(
    args: {
        subscriptionStatus: string | null;
        currentPeriodEnd: Date | null;
        coveredUntil: Date | null;
    },
    now: Date,
): boolean {
    const { subscriptionStatus, currentPeriodEnd, coveredUntil } = args;
    if (!subscriptionStatus || subscriptionStatus === 'trialing') return false;
    if (subscriptionStatus === 'past_due') return true;
    if (!currentPeriodEnd) return false;
    if (currentPeriodEnd.getTime() > now.getTime()) return false;
    return !coveredUntil || coveredUntil.getTime() <= now.getTime();
}

export const paymentsService = new PaymentsService();
