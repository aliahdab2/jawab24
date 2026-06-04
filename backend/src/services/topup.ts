import { and, eq, lt, sql, isNotNull, inArray } from 'drizzle-orm';
import { db } from '../db';
import { topupPurchases, users } from '../db/schema';
import { config } from '../config';
import { stripeService } from './stripe';
import { captureError } from '../utils/sentryHelpers';

export type TopupPack = keyof typeof config.topup.packs;
export type TopupSource = 'stripe' | 'manual' | 'admin';

export class UnknownTopupPackError extends Error {
    constructor(pack: string) {
        super(`Unknown top-up pack: ${pack}. Valid packs: ${Object.keys(config.topup.packs).join(', ')}`);
        this.name = 'UnknownTopupPackError';
    }
}

export class TopupUserNotFoundError extends Error {
    constructor(userId: string) {
        super(`User not found for top-up credit: ${userId}`);
        this.name = 'TopupUserNotFoundError';
    }
}

export class DuplicateTopupError extends Error {
    constructor(stripePaymentIntentId: string) {
        super(`Top-up purchase already recorded for PaymentIntent ${stripePaymentIntentId}`);
        this.name = 'DuplicateTopupError';
    }
}

export interface CreditTopupInput {
    userId: string;
    pack: TopupPack;
    source: TopupSource;
    /** Required when source === 'stripe'. Used for idempotency on webhook replays. */
    stripePaymentIntentId?: string;
    /** Free-form reference: bank transaction ID, USDT TXID, WhatsApp note, etc. */
    externalRef?: string;
}

export interface CreditTopupResult {
    purchaseId: string;
    repliesAdded: number;
    newBalance: number;
}

export interface CreatePendingStripeTopupInput {
    userId: string;
    pack: TopupPack;
    stripePaymentIntentId: string;
}

export interface SettleStripeTopupResult {
    /** True only when this call flipped a pending row to succeeded AND credited the balance. */
    credited: boolean;
    /** True when the row was already succeeded (webhook replay) — a safe no-op, not an error. */
    alreadySettled: boolean;
    userId?: string;
    repliesAdded?: number;
    newBalance?: number;
}

export interface ReconcileStripeTopupsResult {
    /** pending stripe rows examined this sweep */
    scanned: number;
    /** rows credited now because the webhook never arrived */
    credited: number;
    /** rows the webhook had already settled before we got to them (expected, not an error) */
    alreadySettled: number;
    /** rows marked refunded (Stripe charge refunded/disputed while still pending — money gone, never credited) */
    refunded: number;
    /** rows marked failed (Stripe canceled, or abandoned past the cutoff) */
    failed: number;
    /** rows genuinely not resolved yet (still in flight / awaiting the customer) */
    stillPending: number;
    /** per-row errors (e.g. a Stripe API failure) — isolated, the sweep continues */
    errors: number;
    /** true when the sweep aborted early after consecutive Stripe failures (degraded Stripe) */
    abortedEarly: boolean;
}

/**
 * Pending-gated terminal transition for a Stripe top-up row, shared by
 * markStripeTopupFailed / markStripeTopupRefunded. The `status = 'pending'`
 * gate is the load-bearing safety invariant: a terminal transition can never
 * clobber a row that was already legitimately succeeded/credited, so this is
 * safe to run concurrently with the webhook settle path.
 */
async function transitionPendingStripeTopup(
    stripePaymentIntentId: string,
    set: Partial<typeof topupPurchases.$inferInsert>,
): Promise<void> {
    await db
        .update(topupPurchases)
        .set(set)
        .where(
            and(
                eq(topupPurchases.stripePaymentIntentId, stripePaymentIntentId),
                eq(topupPurchases.status, 'pending'),
            ),
        );
}

export const topupService = {
    /**
     * Credit a top-up purchase atomically: insert a `succeeded` row in
     * topup_purchases AND increment users.topup_balance in the same
     * transaction. Either both writes commit or neither does.
     *
     * Idempotent for Stripe purchases: a duplicate stripePaymentIntentId
     * throws DuplicateTopupError (caught by the webhook handler so replays
     * become a safe no-op). Manual purchases have no idempotency key — the
     * admin is the deduplication boundary.
     */
    async creditTopup(input: CreditTopupInput): Promise<CreditTopupResult> {
        const pack = config.topup.packs[input.pack];
        if (!pack) throw new UnknownTopupPackError(input.pack);

        if (input.source === 'stripe' && !input.stripePaymentIntentId) {
            throw new Error('stripePaymentIntentId is required when source is "stripe"');
        }

        const now = new Date();

        return db.transaction(async (tx) => {
            // Confirm user exists before crediting — FK would catch it, but we
            // want a clean domain error rather than a Postgres constraint dump.
            const [user] = await tx
                .select({ id: users.id })
                .from(users)
                .where(eq(users.id, input.userId))
                .limit(1);
            if (!user) throw new TopupUserNotFoundError(input.userId);

            // Idempotency for Stripe: if a purchase row already exists for this
            // PaymentIntent (webhook replay), throw the typed error and let the
            // caller decide. We do NOT silently no-op here so the caller can
            // log/metric the duplicate.
            if (input.stripePaymentIntentId) {
                const [existing] = await tx
                    .select({ id: topupPurchases.id })
                    .from(topupPurchases)
                    .where(eq(topupPurchases.stripePaymentIntentId, input.stripePaymentIntentId))
                    .limit(1);
                if (existing) throw new DuplicateTopupError(input.stripePaymentIntentId);
            }

            const [purchase] = await tx
                .insert(topupPurchases)
                .values({
                    userId: input.userId,
                    pack: input.pack,
                    repliesAdded: pack.repliesAdded,
                    priceCents: pack.priceCents,
                    currency: config.topup.currency,
                    source: input.source,
                    stripePaymentIntentId: input.stripePaymentIntentId ?? null,
                    externalRef: input.externalRef ?? null,
                    status: 'succeeded',
                    createdAt: now,
                    succeededAt: now,
                })
                .returning({ id: topupPurchases.id });

            const [updated] = await tx
                .update(users)
                .set({
                    topupBalance: sql`${users.topupBalance} + ${pack.repliesAdded}`,
                    updatedAt: now,
                })
                .where(eq(users.id, input.userId))
                .returning({ topupBalance: users.topupBalance });

            return {
                purchaseId: purchase.id,
                repliesAdded: pack.repliesAdded,
                newBalance: updated.topupBalance,
            };
        });
    },

    /**
     * Record a `pending` Stripe top-up at PaymentIntent-creation time. The
     * balance is NOT credited here — that happens in settleStripeTopup() when
     * the payment_intent.succeeded webhook arrives. This row is what the
     * webhook looks up by PaymentIntent id, and gives us a record of
     * abandoned/failed checkout attempts for reconciliation.
     *
     * Idempotent: a double-clicked "Pay with card" dedupes to the same Stripe
     * PaymentIntent (per-minute idempotency key), so onConflictDoNothing on the
     * unique stripe_payment_intent_id makes the second insert a no-op rather
     * than a constraint violation.
     */
    async createPendingStripeTopup(input: CreatePendingStripeTopupInput): Promise<void> {
        const pack = config.topup.packs[input.pack];
        if (!pack) throw new UnknownTopupPackError(input.pack);

        await db
            .insert(topupPurchases)
            .values({
                userId: input.userId,
                pack: input.pack,
                repliesAdded: pack.repliesAdded,
                priceCents: pack.priceCents,
                currency: config.topup.currency,
                source: 'stripe',
                stripePaymentIntentId: input.stripePaymentIntentId,
                status: 'pending',
                createdAt: new Date(),
            })
            .onConflictDoNothing({ target: topupPurchases.stripePaymentIntentId });
    },

    /**
     * Settle a Stripe top-up on payment_intent.succeeded: flip the open row to
     * `succeeded` and credit users.topup_balance in one transaction.
     *
     * The settle is gated on `status IN ('pending', 'failed')`, NOT `'pending'`
     * alone. `payment_intent.succeeded` is authoritative proof the money was
     * captured, so it MUST win over a prior failed *attempt*: a single
     * PaymentIntent can fire `payment_intent.payment_failed` (declined attempt)
     * and then `payment_intent.succeeded` (successful retry on the same PI). If
     * an earlier event left the row `failed`, success still credits it here —
     * otherwise the customer would be charged with no replies and the
     * pending-only reconcile sweep couldn't self-heal it.
     *
     * Idempotency is still structural: a `succeeded` row is excluded from the
     * gate, so a webhook replay (or any later delivery) matches 0 rows and
     * credits nothing — no double-credit is possible even before the
     * stripeWebhookEvents dedup layer. A `refunded` row is also excluded (money
     * already returned). Returns credited:false with alreadySettled to let the
     * caller distinguish a replay (expected) from a genuinely missing row (which
     * it should log for reconciliation).
     */
    async settleStripeTopup(stripePaymentIntentId: string): Promise<SettleStripeTopupResult> {
        const now = new Date();

        return db.transaction(async (tx) => {
            const [settled] = await tx
                .update(topupPurchases)
                .set({ status: 'succeeded', succeededAt: now })
                .where(
                    and(
                        eq(topupPurchases.stripePaymentIntentId, stripePaymentIntentId),
                        inArray(topupPurchases.status, ['pending', 'failed']),
                    ),
                )
                .returning({ userId: topupPurchases.userId, repliesAdded: topupPurchases.repliesAdded });

            // 0 rows updated → already succeeded (replay), refunded, or no such row.
            // Disambiguate so the webhook handler logs the missing-row case loudly.
            if (!settled) {
                const [existing] = await tx
                    .select({ status: topupPurchases.status })
                    .from(topupPurchases)
                    .where(eq(topupPurchases.stripePaymentIntentId, stripePaymentIntentId))
                    .limit(1);
                return { credited: false, alreadySettled: existing?.status === 'succeeded' };
            }

            const [updated] = await tx
                .update(users)
                .set({
                    topupBalance: sql`${users.topupBalance} + ${settled.repliesAdded}`,
                    updatedAt: now,
                })
                .where(eq(users.id, settled.userId))
                .returning({ topupBalance: users.topupBalance });

            return {
                credited: true,
                alreadySettled: false,
                userId: settled.userId,
                repliesAdded: settled.repliesAdded,
                newBalance: updated.topupBalance,
            };
        });
    },

    /**
     * Mark a pending Stripe top-up `failed` on payment_intent.payment_failed.
     * Best-effort funnel hygiene — no balance change. Gated on `status =
     * 'pending'` so it never clobbers a row that already succeeded.
     */
    async markStripeTopupFailed(stripePaymentIntentId: string): Promise<void> {
        await transitionPendingStripeTopup(stripePaymentIntentId, { status: 'failed' });
    },

    /**
     * Mark a still-`pending` Stripe top-up `refunded` without ever crediting it.
     * Used by the reconciliation sweep when it finds a PaymentIntent that is
     * `succeeded` but whose charge was refunded (or disputed) while the credit
     * was still missing — the money is gone, so the row reaches its terminal
     * `refunded` state and is no longer sweep-eligible, but topup_balance is
     * NOT touched (it was never credited). Gated on `status = 'pending'` so it
     * can never reverse a row that was already legitimately credited.
     */
    async markStripeTopupRefunded(stripePaymentIntentId: string): Promise<void> {
        await transitionPendingStripeTopup(stripePaymentIntentId, { status: 'refunded', refundedAt: new Date() });
    },

    /**
     * Reverse a Stripe top-up when its money is taken back: a `charge.refunded`
     * or `charge.dispute.created` webhook. Unlike markStripeTopupRefunded (which
     * only handles the never-credited `pending` case), this also claws back the
     * reply credits when the row was already `succeeded`:
     *   - succeeded → 'refunded' AND decrement users.topup_balance by repliesAdded
     *   - pending   → 'refunded' (never credited, so no balance change)
     *   - already refunded / other → no-op
     *
     * Idempotent: both updates are status-gated, so a webhook replay (or a
     * refund + dispute on the same charge) matches 0 rows the second time and
     * never double-decrements. The decrement is floored at 0 so a balance the
     * user already spent down can't go negative.
     */
    async reverseStripeTopup(stripePaymentIntentId: string): Promise<{ reversed: boolean; decremented: boolean }> {
        const now = new Date();
        return db.transaction(async (tx) => {
            // Previously-credited row: flip to refunded AND claw back the credits.
            const [credited] = await tx
                .update(topupPurchases)
                .set({ status: 'refunded', refundedAt: now })
                .where(
                    and(
                        eq(topupPurchases.stripePaymentIntentId, stripePaymentIntentId),
                        eq(topupPurchases.status, 'succeeded'),
                    ),
                )
                .returning({ userId: topupPurchases.userId, repliesAdded: topupPurchases.repliesAdded });

            if (credited) {
                await tx
                    .update(users)
                    .set({
                        topupBalance: sql`GREATEST(0, ${users.topupBalance} - ${credited.repliesAdded})`,
                        updatedAt: now,
                    })
                    .where(eq(users.id, credited.userId));
                return { reversed: true, decremented: true };
            }

            // Never-credited pending row: mark refunded, no balance change.
            const pendingReversed = await tx
                .update(topupPurchases)
                .set({ status: 'refunded', refundedAt: now })
                .where(
                    and(
                        eq(topupPurchases.stripePaymentIntentId, stripePaymentIntentId),
                        eq(topupPurchases.status, 'pending'),
                    ),
                )
                .returning({ id: topupPurchases.id });

            return { reversed: pendingReversed.length > 0, decremented: false };
        });
    },

    /**
     * Open (`pending`) Stripe top-up rows for a user. Used by the admin manual-
     * credit endpoint to warn before minting a separate manual row: if the user
     * has a stuck Stripe top-up, the reconciliation sweep will auto-credit it,
     * so a manual credit on top would double-credit. We surface this rather than
     * auto-failing the pending rows — auto-failing would silently lose money if
     * the row is a genuinely in-flight payment that later succeeds (the
     * status='pending'-gated webhook could then no longer credit it).
     */
    async findOpenPendingStripeTopups(userId: string): Promise<Array<{ stripePaymentIntentId: string | null; createdAt: Date }>> {
        return db
            .select({
                stripePaymentIntentId: topupPurchases.stripePaymentIntentId,
                createdAt: topupPurchases.createdAt,
            })
            .from(topupPurchases)
            .where(
                and(
                    eq(topupPurchases.userId, userId),
                    eq(topupPurchases.source, 'stripe'),
                    eq(topupPurchases.status, 'pending'),
                ),
            );
    },

    /**
     * Reconciliation backstop for the top-up money flow. Money capture (Stripe
     * automatic capture) and reply crediting (settleStripeTopup, fired by the
     * payment_intent.succeeded webhook) are decoupled — so a missed or
     * misconfigured webhook would leave a row `pending` forever: money taken,
     * replies never credited, no self-heal. This sweep re-queries Stripe for the
     * authoritative status of aged `pending` stripe rows and resolves them:
     *   - succeeded + charge clean (not refunded, not disputed) → settleStripeTopup
     *     (idempotent credit; safe even if the webhook also fires — the
     *     status='pending' guard prevents double-credit)
     *   - succeeded + charge refunded/disputed → markStripeTopupRefunded (NO
     *     credit — pi.status stays 'succeeded' after a refund, so crediting on
     *     status alone would grant replies for money that was returned)
     *   - canceled  → markStripeTopupFailed
     *   - otherwise → leave pending (not resolved yet), unless it has sat past
     *     `abandonAfterHours` without completing (abandoned checkout) → failed
     *
     * This is a strict backstop: it only auto-credits the clean missed-webhook
     * case it exists to serve and refuses to act on anything ambiguous. It does
     * NOT decrement balance for refunds that land AFTER a row was already
     * credited — that is the webhook handler's job (charge.refunded /
     * charge.dispute.created), separate from this sweep.
     *
     * Per-row failures are isolated so one unreachable PaymentIntent can't stall
     * the whole sweep; it also aborts early after consecutive Stripe failures so
     * it doesn't hammer a degraded Stripe, and emits a single aggregated Sentry
     * event per sweep rather than one per row. Idempotent and safe to run
     * concurrently with the webhook (and with a second instance during deploys).
     */
    async reconcileStripeTopups(options?: {
        olderThanMinutes?: number;
        abandonAfterHours?: number;
        limit?: number;
    }): Promise<ReconcileStripeTopupsResult> {
        const olderThanMinutes = options?.olderThanMinutes ?? 5;
        const abandonAfterHours = options?.abandonAfterHours ?? 24;
        const limit = options?.limit ?? 100;
        const now = Date.now();
        const cutoff = new Date(now - olderThanMinutes * 60_000);

        // Only sweep rows old enough that the webhook has had a fair chance to
        // arrive first (avoids racing the happy path on fresh purchases).
        const rows = await db
            .select({
                stripePaymentIntentId: topupPurchases.stripePaymentIntentId,
                createdAt: topupPurchases.createdAt,
            })
            .from(topupPurchases)
            .where(
                and(
                    eq(topupPurchases.source, 'stripe'),
                    eq(topupPurchases.status, 'pending'),
                    lt(topupPurchases.createdAt, cutoff),
                    isNotNull(topupPurchases.stripePaymentIntentId),
                ),
            )
            .limit(limit);

        const result: ReconcileStripeTopupsResult = {
            scanned: rows.length, credited: 0, alreadySettled: 0, refunded: 0,
            failed: 0, stillPending: 0, errors: 0, abortedEarly: false,
        };

        // Abort the sweep after this many consecutive per-row failures: a healthy
        // Stripe resolves rows one after another, so a run of back-to-back errors
        // means Stripe is degraded (outage / 429). Bailing avoids hammering an
        // already-struggling API ~100 times; the next 15-min tick retries.
        const MAX_CONSECUTIVE_ERRORS = 5;
        let consecutiveErrors = 0;
        // One aggregated Sentry event per sweep instead of one per row, so a
        // Stripe outage can't bury the high-signal credited>0 alert under noise.
        const errorSamples: Array<{ stripePaymentIntentId: string; message: string }> = [];

        for (const row of rows) {
            const piId = row.stripePaymentIntentId;
            if (!piId) continue;
            try {
                const pi = await stripeService.retrievePaymentIntent(piId);
                if (pi.status === 'succeeded') {
                    // pi.status stays 'succeeded' after a refund/dispute — the money-out
                    // state lives on the (expanded) charge. A succeeded PI should always
                    // carry an expanded charge; if it doesn't we can't verify the money is
                    // still ours, so refuse to credit and let the next sweep retry.
                    const charge = pi.latest_charge;
                    if (!charge || typeof charge === 'string') {
                        throw new Error(`succeeded PaymentIntent ${piId} has no expanded latest_charge`);
                    }
                    if (charge.refunded || (charge.amount_refunded ?? 0) > 0 || charge.disputed) {
                        // Money was returned/held while the credit was still missing — mark
                        // terminal refunded WITHOUT crediting (it was never credited).
                        await this.markStripeTopupRefunded(piId);
                        result.refunded++;
                    } else {
                        const settled = await this.settleStripeTopup(piId);
                        // credited:false here means the webhook beat us to it — already
                        // settled, which is the expected happy path, not an error.
                        if (settled.credited) result.credited++;
                        else result.alreadySettled++;
                    }
                } else if (pi.status === 'canceled') {
                    await this.markStripeTopupFailed(piId);
                    result.failed++;
                } else {
                    // Not resolved yet (requires_payment_method / requires_action /
                    // processing / etc). Expire only if it never completed within
                    // the abandonment window, so we don't churn live attempts.
                    const ageHours = (now - new Date(row.createdAt).getTime()) / 3_600_000;
                    if (ageHours >= abandonAfterHours) {
                        await this.markStripeTopupFailed(piId);
                        result.failed++;
                    } else {
                        result.stillPending++;
                    }
                }
                consecutiveErrors = 0;
            } catch (err) {
                result.errors++;
                consecutiveErrors++;
                errorSamples.push({
                    stripePaymentIntentId: piId,
                    message: err instanceof Error ? err.message : String(err),
                });
                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    result.abortedEarly = true;
                    break;
                }
            }
        }

        if (result.errors > 0) {
            captureError(
                new Error(`Top-up reconciliation hit ${result.errors} error(s)${result.abortedEarly ? ' (aborted early — Stripe likely degraded)' : ''}`),
                'Top-up reconciliation per-row failures',
                {
                    level: result.abortedEarly ? 'error' : 'warning',
                    tags: { area: 'topup_reconcile' },
                    // Cap the sample so a large sweep can't bloat the Sentry payload.
                    extra: { ...result, errorSamples: errorSamples.slice(0, 10) },
                },
            );
        }

        return result;
    },
};
