import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { topupPurchases, users } from '../db/schema';
import { config } from '../config';

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
     * Settle a Stripe top-up on payment_intent.succeeded: flip the pending row
     * to `succeeded` and credit users.topup_balance in one transaction.
     *
     * Idempotency is structural, not advisory: the status update is gated on
     * `status = 'pending'`, so only the FIRST successful settlement of a given
     * PaymentIntent updates a row. A webhook replay (or any later delivery)
     * matches 0 rows and credits nothing — no double-credit is possible even
     * before the stripeWebhookEvents dedup layer. Returns credited:false with
     * alreadySettled to let the caller distinguish a replay (expected) from a
     * genuinely missing row (which it should log for reconciliation).
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
                        eq(topupPurchases.status, 'pending'),
                    ),
                )
                .returning({ userId: topupPurchases.userId, repliesAdded: topupPurchases.repliesAdded });

            // 0 rows updated → either already succeeded (replay) or no such row.
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
        await db
            .update(topupPurchases)
            .set({ status: 'failed' })
            .where(
                and(
                    eq(topupPurchases.stripePaymentIntentId, stripePaymentIntentId),
                    eq(topupPurchases.status, 'pending'),
                ),
            );
    },
};
