import { and, desc, eq, lt } from 'drizzle-orm';
import { db } from '../db';
import { paymentRequests } from '../db/schema';
import { stripeService } from './stripe';
import { captureError } from '../utils/sentryHelpers';

export interface CreatePaymentRequestInput {
    /** Caller supplies the id so it can double as the Stripe idempotency key + metadata. */
    id: string;
    userId: string;
    amountCents: number;
    currency: string;
    description?: string | null;
    stripeCheckoutSessionId: string;
    createdByAdminUserId?: string | null;
    topupPurchaseId?: string | null;
}

export interface ReconcilePaymentRequestsResult {
    /** aged pending rows examined */
    scanned: number;
    /** rows marked paid because the session was paid but the webhook was missed */
    paid: number;
    /** rows marked expired (abandoned/expired Stripe session) */
    expired: number;
    /** rows still genuinely awaiting the customer */
    stillPending: number;
    /** per-row errors (isolated; sweep continues) */
    errors: number;
}

export interface PaymentRequestRow {
    id: string;
    userId: string;
    amountCents: number;
    currency: string;
    description: string | null;
    stripeCheckoutSessionId: string;
    stripePaymentIntentId: string | null;
    status: string;
    createdByAdminUserId: string | null;
    createdAt: Date;
    paidAt: Date | null;
    updatedAt: Date;
}

/**
 * Admin-generated "collect payment" requests. COLLECT-ONLY by design: this
 * service never touches users.topup_balance — the replies it bills for were
 * credited separately (manually). Paying a request only flips it to 'paid'.
 */
export const paymentRequestService = {
    /**
     * Insert a `pending` request for a freshly-created Stripe Checkout Session.
     */
    async create(input: CreatePaymentRequestInput): Promise<PaymentRequestRow> {
        const [row] = await db
            .insert(paymentRequests)
            .values({
                id: input.id,
                userId: input.userId,
                amountCents: input.amountCents,
                currency: input.currency,
                description: input.description ?? null,
                stripeCheckoutSessionId: input.stripeCheckoutSessionId,
                createdByAdminUserId: input.createdByAdminUserId ?? null,
                topupPurchaseId: input.topupPurchaseId ?? null,
            })
            .returning();
        return row as PaymentRequestRow;
    },

    /**
     * Mark a request `paid` from its `checkout.session.completed` webhook.
     * Gated on `status = 'pending'` so a webhook replay matches 0 rows and
     * no-ops — idempotent, and it never reverses an already-paid row. Returns
     * `true` only on the first (real) transition. Does NOT credit reply balance.
     */
    async markPaid(
        stripeCheckoutSessionId: string,
        stripePaymentIntentId: string | null,
    ): Promise<boolean> {
        const updated = await db
            .update(paymentRequests)
            .set({
                status: 'paid',
                stripePaymentIntentId,
                paidAt: new Date(),
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(paymentRequests.stripeCheckoutSessionId, stripeCheckoutSessionId),
                    eq(paymentRequests.status, 'pending'),
                ),
            )
            .returning({ id: paymentRequests.id });
        return updated.length > 0;
    },

    /**
     * All payment requests for a user, newest first — for the admin history list.
     */
    async listForUser(userId: string): Promise<PaymentRequestRow[]> {
        const rows = await db
            .select()
            .from(paymentRequests)
            .where(eq(paymentRequests.userId, userId))
            .orderBy(desc(paymentRequests.createdAt));
        return rows as PaymentRequestRow[];
    },

    /**
     * Reconciliation backstop. A missed/late `checkout.session.completed` webhook
     * would leave a row `pending` even though the customer paid — which, now that
     * a request can be tied to a grant, would mis-report it as "granted but
     * unpaid". This re-queries Stripe for aged `pending` rows and resolves them:
     *   - session.payment_status === 'paid' → markPaid (idempotent; safe even if
     *     the webhook also lands — the status='pending' gate prevents a re-flip)
     *   - session.status === 'expired'      → mark expired
     *   - otherwise                          → leave pending (still in flight)
     *
     * Collect-only: this NEVER touches users.topup_balance. Per-row errors are
     * isolated so one unreachable session can't stall the sweep; a single
     * aggregated Sentry event is emitted per sweep when errors occur.
     */
    async reconcilePending(options?: { olderThanMinutes?: number; limit?: number }): Promise<ReconcilePaymentRequestsResult> {
        const olderThanMinutes = options?.olderThanMinutes ?? 10;
        const limit = options?.limit ?? 100;
        const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

        const rows = await db
            .select({
                stripeCheckoutSessionId: paymentRequests.stripeCheckoutSessionId,
            })
            .from(paymentRequests)
            .where(
                and(
                    eq(paymentRequests.status, 'pending'),
                    lt(paymentRequests.createdAt, cutoff),
                ),
            )
            .limit(limit);

        const result: ReconcilePaymentRequestsResult = {
            scanned: rows.length, paid: 0, expired: 0, stillPending: 0, errors: 0,
        };
        const errorSamples: Array<{ sessionId: string; message: string }> = [];

        for (const row of rows) {
            const sessionId = row.stripeCheckoutSessionId;
            try {
                const session = await stripeService.getCheckoutSession(sessionId);
                if (session.payment_status === 'paid') {
                    const pi = typeof session.payment_intent === 'string'
                        ? session.payment_intent
                        : session.payment_intent?.id ?? null;
                    const flipped = await this.markPaid(sessionId, pi);
                    if (flipped) result.paid++;
                    else result.stillPending++; // webhook beat us to it (expected)
                } else if (session.status === 'expired') {
                    await db
                        .update(paymentRequests)
                        .set({ status: 'expired', updatedAt: new Date() })
                        .where(
                            and(
                                eq(paymentRequests.stripeCheckoutSessionId, sessionId),
                                eq(paymentRequests.status, 'pending'),
                            ),
                        );
                    result.expired++;
                } else {
                    result.stillPending++;
                }
            } catch (err) {
                result.errors++;
                errorSamples.push({
                    sessionId,
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        }

        if (result.errors > 0) {
            captureError(
                new Error(`Payment-request reconciliation hit ${result.errors} error(s)`),
                'Payment-request reconciliation per-row failures',
                {
                    level: 'warning',
                    tags: { area: 'payment_request_reconcile' },
                    extra: { ...result, errorSamples: errorSamples.slice(0, 10) },
                },
            );
        }

        return result;
    },
};
