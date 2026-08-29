/**
 * Offline (non-card) payment claims — the Sham Cash rail.
 *
 * WHAT THIS IS: a merchant inside Syria cannot be charged by card (Stripe blocks
 * SY before any API call — `utils/sanctions.ts`, and that block stays). They
 * transfer to our Sham Cash wallet and submit the transfer reference here. This
 * service records the CLAIM and nothing else.
 *
 * WHAT THIS IS NOT: an entitlement path. Approving a claim does not extend a
 * subscription. `adminSubscriptionsService.manualUpgrade` stays the single grant
 * choke point, so the day Sham Cash exposes an API, only WHO moves the status
 * changes — not what a status means, and not who grants.
 *
 * The transfer reference is the anti-replay key: normalized
 * (`normalizeTransferReference`) and unique per rail ACROSS ALL USERS, because a
 * reference names one real transfer and a second account claiming it is exactly
 * the abuse this prevents.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import {
    normalizeTransferReference,
    OFFLINE_PAYMENT_MAX_PENDING_PER_USER,
    type OfflinePaymentRail,
    type OfflinePaymentStatus,
} from '@jawab24/shared';
import { db } from '../db';
import { adminAuditLogs, offlinePayments, offlinePaymentReceipts, plans, users } from '../db/schema';

export interface SubmitOfflinePaymentInput {
    userId: string;
    rail: OfflinePaymentRail;
    planId: string;
    billingInterval: 'month' | 'year';
    transferReference: string;
    senderName?: string | null;
    note?: string | null;
    /** Optional evidence. Already validated + normalized by the controller. */
    receipt?: { bytes: Buffer; mimeType: string } | null;
}

export interface OfflinePaymentRow {
    id: string;
    userId: string;
    rail: string;
    planId: string;
    planName: string;
    planSlug: string;
    billingInterval: string;
    amountCents: number;
    currency: string;
    transferReference: string;
    senderName: string | null;
    note: string | null;
    status: OfflinePaymentStatus;
    reviewNote: string | null;
    reviewedAt: Date | null;
    hasReceipt: boolean;
    createdAt: Date;
}

export interface OfflinePaymentAdminRow extends OfflinePaymentRow {
    userEmail: string | null;
    userName: string | null;
}

/**
 * Why a submission was refused. Each maps to its own merchant-facing message —
 * "duplicate reference" in particular must NOT read as a generic failure, or the
 * merchant retries a transfer that already reached us.
 */
export type SubmitFailure =
    | 'plan_not_found'
    | 'plan_not_purchasable'
    | 'duplicate_reference'
    | 'too_many_pending';

/**
 * What this claim is for, in USD cents — the number the reviewer will read off
 * the wallet statement.
 *
 * Deliberately NOT the frontend's `getDisplayPrice`, even though the monthly arm
 * is the same expression. That helper falls back to `monthly × 10` for a plan
 * with no yearly price so the pricing GRID still renders; here that would invent
 * a figure nobody agreed and then review a real transfer against it. A yearly
 * claim on a plan with no yearly price is refused instead. Display may
 * approximate; money may not (D-110).
 *
 * Returns null when the plan cannot be bought on this rail.
 */
function resolveClaimAmountCents(
    plan: { price: number; yearlyPrice: number | null; isActive: boolean | null },
    billingInterval: 'month' | 'year',
): number | null {
    // A free or deactivated plan has nothing to pay for; a claim against one is
    // something no reviewer could act on.
    if (plan.isActive === false || plan.price <= 0) return null;
    if (billingInterval === 'year') {
        return plan.yearlyPrice && plan.yearlyPrice > 0 ? plan.yearlyPrice : null;
    }
    return plan.price;
}

export type SubmitResult =
    | { ok: true; row: OfflinePaymentRow }
    | { ok: false; reason: SubmitFailure };

/**
 * Postgres unique-violation (23505), anywhere in the error's cause chain.
 *
 * The chain walk is load-bearing, not defensive: drizzle's `transaction()`
 * rethrows the driver error WRAPPED, so the `code` is on `err.cause`, not on
 * `err`. Reading only the top level made a duplicate reference escape as a 500
 * instead of the "we already have this transfer" answer — proven by the
 * integration suite, which is the only place a real index can raise it.
 */
function isUniqueViolation(err: unknown): boolean {
    for (let cur: unknown = err, depth = 0; cur && depth < 5; depth++) {
        if (typeof cur !== 'object') break;
        if ((cur as { code?: unknown }).code === '23505') return true;
        cur = (cur as { cause?: unknown }).cause;
    }
    return false;
}

const rowColumns = {
    id: offlinePayments.id,
    userId: offlinePayments.userId,
    rail: offlinePayments.rail,
    planId: offlinePayments.planId,
    billingInterval: offlinePayments.billingInterval,
    amountCents: offlinePayments.amountCents,
    currency: offlinePayments.currency,
    transferReference: offlinePayments.transferReference,
    senderName: offlinePayments.senderName,
    note: offlinePayments.note,
    status: offlinePayments.status,
    reviewNote: offlinePayments.reviewNote,
    reviewedAt: offlinePayments.reviewedAt,
    createdAt: offlinePayments.createdAt,
    planName: plans.name,
    planSlug: plans.slug,
    // Presence only — the bytes are never selected outside the receipt route.
    hasReceipt: sql<boolean>`${offlinePaymentReceipts.offlinePaymentId} IS NOT NULL`,
};

function toRow(r: Record<string, unknown>): OfflinePaymentRow {
    return {
        id: String(r.id),
        userId: String(r.userId),
        rail: String(r.rail),
        planId: String(r.planId),
        planName: String(r.planName ?? ''),
        planSlug: String(r.planSlug ?? ''),
        billingInterval: String(r.billingInterval),
        amountCents: Number(r.amountCents),
        currency: String(r.currency),
        transferReference: String(r.transferReference),
        senderName: (r.senderName as string | null) ?? null,
        note: (r.note as string | null) ?? null,
        status: r.status as OfflinePaymentStatus,
        reviewNote: (r.reviewNote as string | null) ?? null,
        reviewedAt: (r.reviewedAt as Date | null) ?? null,
        hasReceipt: Boolean(r.hasReceipt),
        createdAt: r.createdAt as Date,
    };
}

export const offlinePaymentsService = {
    /**
     * Record a merchant's claim that they transferred for a plan.
     *
     * The AMOUNT is resolved here from the plan, never taken from the request:
     * the claim is reviewed against a wallet statement, so the number on it has
     * to be the number we actually asked for.
     */
    async submit(input: SubmitOfflinePaymentInput): Promise<SubmitResult> {
        const [plan] = await db
            .select({
                id: plans.id,
                name: plans.name,
                slug: plans.slug,
                price: plans.price,
                yearlyPrice: plans.yearlyPrice,
                isActive: plans.isActive,
            })
            .from(plans)
            .where(eq(plans.id, input.planId))
            .limit(1);

        if (!plan) return { ok: false, reason: 'plan_not_found' };

        const amountCents = resolveClaimAmountCents(plan, input.billingInterval);
        if (amountCents === null) return { ok: false, reason: 'plan_not_purchasable' };

        const [{ pending }] = await db
            .select({ pending: sql<number>`count(*)::int` })
            .from(offlinePayments)
            .where(and(
                eq(offlinePayments.userId, input.userId),
                eq(offlinePayments.status, 'pending_review'),
            ));
        if (Number(pending) >= OFFLINE_PAYMENT_MAX_PENDING_PER_USER) {
            return { ok: false, reason: 'too_many_pending' };
        }

        const transferReference = input.transferReference.trim();
        const normalized = normalizeTransferReference(transferReference);

        try {
            // The receipt and the claim land together or not at all: a claim whose
            // image failed to write would send the reviewer looking for evidence
            // that does not exist.
            const row = await db.transaction(async (tx) => {
                const [inserted] = await tx
                    .insert(offlinePayments)
                    .values({
                        userId: input.userId,
                        rail: input.rail,
                        planId: plan.id,
                        billingInterval: input.billingInterval,
                        amountCents,
                        currency: 'usd',
                        transferReference,
                        transferReferenceNormalized: normalized,
                        senderName: input.senderName?.trim() || null,
                        note: input.note?.trim() || null,
                    })
                    .returning();

                if (input.receipt) {
                    await tx.insert(offlinePaymentReceipts).values({
                        offlinePaymentId: inserted.id,
                        mimeType: input.receipt.mimeType,
                        byteLength: input.receipt.bytes.length,
                        bytes: input.receipt.bytes,
                    });
                }
                return inserted;
            });

            return {
                ok: true,
                row: toRow({ ...row, planName: plan.name, planSlug: plan.slug, hasReceipt: Boolean(input.receipt) }),
            };
        } catch (err) {
            // The unique index is the real guard; the pre-check above is only a
            // nicer error. Two submissions racing on the same reference arrive
            // here, and the second one is a duplicate, not a server fault.
            if (isUniqueViolation(err)) return { ok: false, reason: 'duplicate_reference' };
            throw err;
        }
    },

    /** A merchant's own claims, newest first — powers the «under review» state. */
    async listForUser(userId: string, limit = 10): Promise<OfflinePaymentRow[]> {
        const rows = await db
            .select(rowColumns)
            .from(offlinePayments)
            .innerJoin(plans, eq(plans.id, offlinePayments.planId))
            .leftJoin(offlinePaymentReceipts, eq(offlinePaymentReceipts.offlinePaymentId, offlinePayments.id))
            .where(eq(offlinePayments.userId, userId))
            .orderBy(desc(offlinePayments.createdAt))
            .limit(limit);
        return rows.map((r) => toRow(r as Record<string, unknown>));
    },

    /** The admin review queue. `status` omitted = everything, newest first. */
    async list(options?: { status?: OfflinePaymentStatus; limit?: number }): Promise<OfflinePaymentAdminRow[]> {
        const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
        const rows = await db
            .select({ ...rowColumns, userEmail: users.email, userName: users.name })
            .from(offlinePayments)
            .innerJoin(plans, eq(plans.id, offlinePayments.planId))
            .innerJoin(users, eq(users.id, offlinePayments.userId))
            .leftJoin(offlinePaymentReceipts, eq(offlinePaymentReceipts.offlinePaymentId, offlinePayments.id))
            .where(options?.status ? eq(offlinePayments.status, options.status) : undefined)
            .orderBy(desc(offlinePayments.createdAt))
            .limit(limit);
        return rows.map((r) => ({
            ...toRow(r as Record<string, unknown>),
            userEmail: (r.userEmail as string | null) ?? null,
            userName: (r.userName as string | null) ?? null,
        }));
    },

    /**
     * Move a claim to a terminal status, and record WHO decided it.
     *
     * Gated on `pending_review`, so a double click — or two admins acting on a
     * stale queue — transitions exactly once and the audit row is written once:
     * the same status-gated idempotency the Stripe payment-request rows use.
     * Returns false when the row was already reviewed (or does not exist).
     *
     * The `admin_audit_logs` write is in the SAME transaction as the status
     * change, not beside it. Every other admin mutation in this codebase writes
     * one (manual upgrade, top-up grant, partner edits), and a decision about
     * whether real money arrived is the last one that should be missing from
     * that trail. Atomic because a decision with no record of who made it is
     * worse than no decision.
     */
    async review(
        id: string,
        decision: 'approved' | 'rejected',
        adminUserId: string | undefined,
        reviewNote?: string | null,
    ): Promise<boolean> {
        const note = reviewNote?.trim() || null;

        return db.transaction(async (tx) => {
            const [updated] = await tx
                .update(offlinePayments)
                .set({
                    status: decision,
                    reviewNote: note,
                    reviewedByAdminUserId: adminUserId ?? null,
                    reviewedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(and(
                    eq(offlinePayments.id, id),
                    eq(offlinePayments.status, 'pending_review'),
                ))
                .returning();

            if (!updated) return false;

            await tx.insert(adminAuditLogs).values({
                adminUserId,
                targetUserId: updated.userId,
                action: 'offline_payment_review',
                previousValue: { claimId: updated.id, status: 'pending_review' },
                newValue: {
                    claimId: updated.id,
                    status: decision,
                    rail: updated.rail,
                    planId: updated.planId,
                    billingInterval: updated.billingInterval,
                    amountCents: updated.amountCents,
                },
                // The reviewer's own words on why, and the reference they matched
                // against the wallet statement — the two things a later reader of
                // this row will want and cannot reconstruct.
                paymentReference: updated.transferReference,
                note,
            });

            return true;
        });
    },

    /** Receipt bytes for the admin-only route. The ONLY place bytes are read. */
    async getReceipt(id: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
        const [row] = await db
            .select({ bytes: offlinePaymentReceipts.bytes, mimeType: offlinePaymentReceipts.mimeType })
            .from(offlinePaymentReceipts)
            .where(eq(offlinePaymentReceipts.offlinePaymentId, id))
            .limit(1);
        return row ? { bytes: row.bytes, mimeType: row.mimeType } : null;
    },
};
