import { eq, sql } from 'drizzle-orm';
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

        return await db.transaction(async (tx) => {
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
};
