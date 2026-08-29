/**
 * Offline (non-card) payment claims — the Sham Cash rail.
 *
 * WHAT THIS IS: a merchant inside Syria cannot be charged by card (Stripe blocks
 * SY before any API call — `utils/sanctions.ts`, and that block stays). They
 * transfer to our Sham Cash wallet and submit the transfer reference here.
 *
 * Approving a claim GRANTS the plan in the same transaction (D-110, amended
 * after review): the grant still goes through `adminSubscriptionsService.
 * manualUpgrade` — the single grant choke point — but it is no longer a second
 * human step with no key back to the claim. `granted_subscription_id` /
 * `granted_at` record what the money opened, and a DB CHECK makes "approved
 * but not granted" unrepresentable.
 *
 * The transfer reference is the anti-replay key: normalized
 * (`normalizeTransferReference`, a letters-and-digits whitelist) and unique per
 * rail ACROSS ALL USERS while the claim is not rejected, because a reference
 * names one real transfer and a second account claiming it is exactly the abuse
 * this prevents.
 */
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import {
    normalizeTransferReference,
    OFFLINE_PAYMENT_MAX_PENDING_PER_USER,
    type OfflinePaymentRail,
    type OfflinePaymentStatus,
} from '@jawab24/shared';
import { db } from '../db';
import { adminAuditLogs, offlinePayments, offlinePaymentReceipts, plans, users } from '../db/schema';
import { config } from '../config';
import { isUniqueViolation } from '../utils/dbErrors';
import { offlinePaymentReviewEmailTemplate } from '../utils/emailTemplates';
import { adminSubscriptionsService } from './admin/subscriptions';
import { sendThrottledAdminAlert } from './adminAlerts';
import { resolveMarketplaceBilling } from './marketplaceBilling';
import { subscriptionsService } from './subscriptions';

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

/** What a MERCHANT may see about their own claim. Enforced again by the route's response schema. */
export interface OfflinePaymentClaim {
    id: string;
    rail: string;
    planId: string;
    planName: string;
    planSlug: string;
    billingInterval: 'month' | 'year';
    amountCents: number;
    currency: string;
    transferReference: string;
    senderName: string | null;
    note: string | null;
    status: OfflinePaymentStatus;
    hasReceipt: boolean;
    createdAt: Date;
    reviewedAt: Date | null;
}

/** The reviewer's view: the merchant shape plus who filed it and what the decision produced. */
export interface OfflinePaymentAdminClaim extends OfflinePaymentClaim {
    userId: string;
    userEmail: string | null;
    userName: string | null;
    reviewNote: string | null;
    grantedAt: Date | null;
    grantedSubscriptionId: string | null;
}

export interface RailConfig {
    rail: OfflinePaymentRail;
    walletNumber: string;
    walletName: string | null;
    qrImageUrl: string | null;
    currency: 'usd';
}

/**
 * Why a submission was refused. Each maps to its own merchant-facing message —
 * "duplicate reference" in particular must NOT read as a generic failure, or the
 * merchant retries a transfer that already reached us.
 */
export type SubmitFailure =
    | { reason: 'plan_not_found' }
    | { reason: 'plan_not_purchasable' }
    | { reason: 'duplicate_reference' }
    | { reason: 'too_many_pending' }
    /** The account is billed by a marketplace (Salla/Zid/Shopify) — same verdict the Stripe entry points refuse with. */
    | { reason: 'marketplace_billed'; code: string; message: string };

export type SubmitResult =
    | { ok: true; claim: OfflinePaymentClaim; replayed: boolean }
    | { ok: false; failure: SubmitFailure };

export type ReviewResult =
    | { outcome: 'updated'; claim: OfflinePaymentAdminClaim }
    | { outcome: 'already_reviewed'; claim: OfflinePaymentAdminClaim }
    | { outcome: 'not_found' };

/** Claims still waiting after this long are surfaced by the daily digest. */
export const STALE_PENDING_HOURS = 48;

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
 */
function resolveClaimAmountCents(
    plan: { price: number; yearlyPrice: number | null; isActive: boolean | null },
    billingInterval: 'month' | 'year',
): number | null {
    if (plan.isActive === false || plan.price <= 0) return null;
    if (billingInterval === 'year') {
        return plan.yearlyPrice && plan.yearlyPrice > 0 ? plan.yearlyPrice : null;
    }
    return plan.price;
}

const merchantColumns = {
    id: offlinePayments.id,
    rail: offlinePayments.rail,
    planId: offlinePayments.planId,
    billingInterval: offlinePayments.billingInterval,
    amountCents: offlinePayments.amountCents,
    currency: offlinePayments.currency,
    transferReference: offlinePayments.transferReference,
    senderName: offlinePayments.senderName,
    note: offlinePayments.note,
    status: offlinePayments.status,
    createdAt: offlinePayments.createdAt,
    reviewedAt: offlinePayments.reviewedAt,
    planName: plans.name,
    planSlug: plans.slug,
    // Presence only — the bytes are never selected outside the receipt route.
    hasReceipt: sql<boolean>`${offlinePaymentReceipts.offlinePaymentId} IS NOT NULL`,
};

const adminColumns = {
    ...merchantColumns,
    userId: offlinePayments.userId,
    reviewNote: offlinePayments.reviewNote,
    grantedAt: offlinePayments.grantedAt,
    grantedSubscriptionId: offlinePayments.grantedSubscriptionId,
    userEmail: users.email,
    userName: users.name,
};

function toClaim(r: Record<string, unknown>): OfflinePaymentClaim {
    return {
        id: String(r.id),
        rail: String(r.rail),
        planId: String(r.planId),
        planName: String(r.planName ?? ''),
        planSlug: String(r.planSlug ?? ''),
        billingInterval: r.billingInterval === 'year' ? 'year' : 'month',
        amountCents: Number(r.amountCents),
        currency: String(r.currency),
        transferReference: String(r.transferReference),
        senderName: (r.senderName as string | null) ?? null,
        note: (r.note as string | null) ?? null,
        status: r.status as OfflinePaymentStatus,
        hasReceipt: Boolean(r.hasReceipt),
        createdAt: r.createdAt as Date,
        reviewedAt: (r.reviewedAt as Date | null) ?? null,
    };
}

function toAdminClaim(r: Record<string, unknown>): OfflinePaymentAdminClaim {
    return {
        ...toClaim(r),
        userId: String(r.userId),
        userEmail: (r.userEmail as string | null) ?? null,
        userName: (r.userName as string | null) ?? null,
        reviewNote: (r.reviewNote as string | null) ?? null,
        grantedAt: (r.grantedAt as Date | null) ?? null,
        grantedSubscriptionId: (r.grantedSubscriptionId as string | null) ?? null,
    };
}

/**
 * Opaque keyset cursor = the last row's id. The page boundary is compared as a
 * ROW VALUE against that row's own (created_at, id) in SQL — never through a
 * JS Date, whose millisecond precision truncates Postgres's microseconds and
 * re-includes the boundary row on the next page.
 */
function encodeCursor(id: string): string {
    return Buffer.from(id, 'utf8').toString('base64url');
}
function decodeCursor(cursor: string): string | null {
    try {
        const id = Buffer.from(cursor, 'base64url').toString('utf8');
        return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
    } catch {
        return null;
    }
}

async function loadAdminClaim(id: string): Promise<OfflinePaymentAdminClaim | null> {
    const [row] = await db
        .select(adminColumns)
        .from(offlinePayments)
        .innerJoin(plans, eq(plans.id, offlinePayments.planId))
        .innerJoin(users, eq(users.id, offlinePayments.userId))
        .leftJoin(offlinePaymentReceipts, eq(offlinePaymentReceipts.offlinePaymentId, offlinePayments.id))
        .where(eq(offlinePayments.id, id))
        .limit(1);
    return row ? toAdminClaim(row as Record<string, unknown>) : null;
}

export const offlinePaymentsService = {
    /**
     * The rail's wallet details, or null when the rail is OFF (no wallet number
     * in env). The one place that decides "is Sham Cash live" — the controller,
     * /health and the boot log all ask here.
     */
    getRailConfig(): RailConfig | null {
        if (!config.shamCash.walletNumber) return null;
        return {
            rail: 'sham_cash',
            walletNumber: config.shamCash.walletNumber,
            walletName: config.shamCash.walletName || null,
            qrImageUrl: config.shamCash.qrImageUrl || null,
            currency: 'usd',
        };
    },

    /**
     * Record a merchant's claim that they transferred for a plan.
     *
     * The AMOUNT is resolved here from the plan, never taken from the request.
     * The pending cap is enforced INSIDE the transaction behind a per-user
     * advisory lock — a plain count-then-insert let ten concurrent submits
     * store ten rows against a cap of three (measured). A same-user, same-plan
     * resubmission of a reference we already hold is a REPLAY (lost response,
     * double tap) and returns the existing claim rather than a refusal.
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
        if (!plan) return { ok: false, failure: { reason: 'plan_not_found' } };

        const amountCents = resolveClaimAmountCents(plan, input.billingInterval);
        if (amountCents === null) return { ok: false, failure: { reason: 'plan_not_purchasable' } };

        // Same gate every Stripe entry point applies: a marketplace-billed
        // account is billed by the marketplace, on every rail. Here in the
        // service so a future webhook-driven submit path is covered too.
        const subscription = await subscriptionsService.getUserSubscription(input.userId);
        const verdict = await resolveMarketplaceBilling(input.userId, subscription);
        if (verdict) {
            return { ok: false, failure: { reason: 'marketplace_billed', code: verdict.code, message: verdict.message } };
        }

        const transferReference = input.transferReference.trim();
        const normalized = normalizeTransferReference(transferReference);

        try {
            const inserted = await db.transaction(async (tx) => {
                // Serialize this user's submits so the cap below is a real bound.
                await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`);
                const [{ pending }] = await tx
                    .select({ pending: sql<number>`count(*)::int` })
                    .from(offlinePayments)
                    .where(and(
                        eq(offlinePayments.userId, input.userId),
                        eq(offlinePayments.status, 'pending_review'),
                    ));
                if (Number(pending) >= OFFLINE_PAYMENT_MAX_PENDING_PER_USER) return 'too_many_pending' as const;

                const [row] = await tx
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
                    .returning({ id: offlinePayments.id });
                // The receipt and the claim land together or not at all.
                if (input.receipt) {
                    await tx.insert(offlinePaymentReceipts).values({
                        offlinePaymentId: row.id,
                        mimeType: input.receipt.mimeType,
                        byteLength: input.receipt.bytes.length,
                        bytes: input.receipt.bytes,
                    });
                }
                return row.id;
            });
            if (inserted === 'too_many_pending') return { ok: false, failure: { reason: 'too_many_pending' } };
            const claim = await loadAdminClaim(inserted);
            if (!claim) throw new Error('offline payment vanished after insert');
            return { ok: true, claim: toClaim(claim as unknown as Record<string, unknown>), replayed: false };
        } catch (err) {
            if (!isUniqueViolation(err)) throw err;
            // The index fired. The loser's INSERT blocks on the winner's row
            // and raises only after the winner commits, so this lookup always
            // finds a committed row.
            const [existing] = await db
                .select(adminColumns)
                .from(offlinePayments)
                .innerJoin(plans, eq(plans.id, offlinePayments.planId))
                .innerJoin(users, eq(users.id, offlinePayments.userId))
                .leftJoin(offlinePaymentReceipts, eq(offlinePaymentReceipts.offlinePaymentId, offlinePayments.id))
                .where(and(
                    eq(offlinePayments.rail, input.rail),
                    eq(offlinePayments.transferReferenceNormalized, normalized),
                    sql`${offlinePayments.status} <> 'rejected'`,
                ))
                .limit(1);
            const owner = existing ? toAdminClaim(existing as Record<string, unknown>) : null;
            const isReplay = owner
                && owner.userId === input.userId
                && owner.planId === plan.id
                && owner.billingInterval === input.billingInterval;
            if (isReplay && owner) {
                return { ok: true, claim: toClaim(owner as unknown as Record<string, unknown>), replayed: true };
            }
            return { ok: false, failure: { reason: 'duplicate_reference' } };
        }
    },

    /** A merchant's own claims, newest first — powers the «under review» / «refused» states. */
    async listForUser(userId: string, limit = 10): Promise<OfflinePaymentClaim[]> {
        const rows = await db
            .select(merchantColumns)
            .from(offlinePayments)
            .innerJoin(plans, eq(plans.id, offlinePayments.planId))
            .leftJoin(offlinePaymentReceipts, eq(offlinePaymentReceipts.offlinePaymentId, offlinePayments.id))
            .where(eq(offlinePayments.userId, userId))
            .orderBy(desc(offlinePayments.createdAt), desc(offlinePayments.id))
            .limit(limit);
        return rows.map((r) => toClaim(r as Record<string, unknown>));
    },

    /**
     * The admin queue, keyset-paged. Pending is OLDEST first — a queue that
     * truncates must drop the newest, never the claim that has waited longest;
     * history filters are newest first. `total` lets the page say "N of M".
     */
    async list(options: { status?: OfflinePaymentStatus; cursor?: string | null; limit?: number } = {}): Promise<{
        claims: OfflinePaymentAdminClaim[];
        nextCursor: string | null;
        total: number;
    }> {
        const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
        const oldestFirst = options.status === 'pending_review';
        const statusFilter = options.status ? eq(offlinePayments.status, options.status) : undefined;
        const afterId = options.cursor ? decodeCursor(options.cursor) : null;
        const cursorFilter = afterId
            ? (oldestFirst
                ? sql`(${offlinePayments.createdAt}, ${offlinePayments.id}) > (SELECT created_at, id FROM offline_payments WHERE id = ${afterId})`
                : sql`(${offlinePayments.createdAt}, ${offlinePayments.id}) < (SELECT created_at, id FROM offline_payments WHERE id = ${afterId})`)
            : undefined;

        const [rows, [{ total }]] = await Promise.all([
            db
                .select(adminColumns)
                .from(offlinePayments)
                .innerJoin(plans, eq(plans.id, offlinePayments.planId))
                .innerJoin(users, eq(users.id, offlinePayments.userId))
                .leftJoin(offlinePaymentReceipts, eq(offlinePaymentReceipts.offlinePaymentId, offlinePayments.id))
                .where(and(statusFilter, cursorFilter))
                .orderBy(
                    oldestFirst ? asc(offlinePayments.createdAt) : desc(offlinePayments.createdAt),
                    oldestFirst ? asc(offlinePayments.id) : desc(offlinePayments.id),
                )
                .limit(limit + 1),
            db
                .select({ total: sql<number>`count(*)::int` })
                .from(offlinePayments)
                .where(statusFilter),
        ]);
        const page = rows.slice(0, limit).map((r) => toAdminClaim(r as Record<string, unknown>));
        const last = page[page.length - 1];
        const nextCursor = rows.length > limit && last ? encodeCursor(last.id) : null;
        return { claims: page, nextCursor, total: Number(total) };
    },

    /**
     * Decide a claim. APPROVE = GRANT, atomically: the status flip, the grant
     * (`manualUpgrade` on the same transaction: plan, 1 or 12 months, method
     * `sham_cash`, the claim's own reference as the audit reference), the
     * `granted_*` stamp and the `admin_audit_logs` row all commit together or
     * not at all.
     *
     * Gated on `pending_review`, so two admins acting on a stale queue
     * transition exactly once; the loser gets the current row back.
     */
    async review(
        id: string,
        decision: 'approved' | 'rejected',
        adminUserId: string,
        reviewNote?: string | null,
    ): Promise<ReviewResult> {
        const note = reviewNote?.trim() || null;

        const updated = await db.transaction(async (tx) => {
            const now = new Date();
            const [claim] = await tx
                .update(offlinePayments)
                .set({
                    status: decision,
                    reviewNote: note,
                    reviewedByAdminUserId: adminUserId,
                    reviewedAt: now,
                    // Satisfies the grant CHECK inside the same statement; the
                    // real subscription id is stamped right after the grant.
                    grantedAt: decision === 'approved' ? now : null,
                    updatedAt: now,
                })
                .where(and(eq(offlinePayments.id, id), eq(offlinePayments.status, 'pending_review')))
                .returning();
            if (!claim) return null;

            let grantedSubscriptionId: string | null = null;
            if (decision === 'approved') {
                const grant = await adminSubscriptionsService.manualUpgrade(
                    claim.userId,
                    {
                        planId: claim.planId,
                        periodMonths: claim.billingInterval === 'year' ? 12 : 1,
                        paymentMethod: 'sham_cash',
                        paymentReference: claim.transferReference,
                        note: note ?? undefined,
                    },
                    adminUserId,
                    tx,
                );
                grantedSubscriptionId = grant.subscription.id;
                await tx
                    .update(offlinePayments)
                    .set({ grantedSubscriptionId })
                    .where(eq(offlinePayments.id, id));
            }

            await tx.insert(adminAuditLogs).values({
                adminUserId,
                targetUserId: claim.userId,
                action: 'offline_payment_review',
                previousValue: { claimId: claim.id, status: 'pending_review' },
                newValue: {
                    claimId: claim.id,
                    status: decision,
                    rail: claim.rail,
                    planId: claim.planId,
                    billingInterval: claim.billingInterval,
                    amountCents: claim.amountCents,
                    grantedSubscriptionId,
                },
                paymentReference: claim.transferReference,
                note,
            });
            return claim.id;
        });

        const current = await loadAdminClaim(id);
        if (!current) return { outcome: 'not_found' };
        return updated ? { outcome: 'updated', claim: current } : { outcome: 'already_reviewed', claim: current };
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

    /**
     * Tell the reviewer there is something to review. Best effort and
     * fire-and-forget: the claim is already recorded, and a mail outage must
     * not fail the merchant's submission. Dedup key is the claim id, so a
     * retried request that lands twice still mails once. Lives in the service
     * so any submit path — HTTP today, a gateway webhook tomorrow — notifies.
     */
    notifyReviewer(claim: OfflinePaymentClaim, userId: string): void {
        const mail = offlinePaymentReviewEmailTemplate({
            planName: claim.planName,
            billingInterval: claim.billingInterval,
            amountCents: claim.amountCents,
            transferReference: claim.transferReference,
            senderName: claim.senderName,
            hasReceipt: claim.hasReceipt,
            reviewUrl: `${config.frontendUrl}/admin/offline-payments`,
        });
        void sendThrottledAdminAlert({
            dedupKey: `offline-payment:notify:${claim.id}`,
            cooldownSeconds: 24 * 60 * 60,
            // A business event, not an anomaly: 'info' keeps it out of the
            // warning-level Sentry issues on-call triages.
            level: 'info',
            message: 'Offline payment claim submitted',
            tags: { component: 'offlinePayments', rail: claim.rail },
            extra: { claimId: claim.id, userId, planSlug: claim.planSlug },
            subject: mail.subject,
            html: mail.html,
        });
    },

    /** Claims still pending after STALE_PENDING_HOURS — the daily digest's input. */
    async listStalePending(): Promise<OfflinePaymentAdminClaim[]> {
        const cutoff = new Date(Date.now() - STALE_PENDING_HOURS * 60 * 60 * 1000);
        const rows = await db
            .select(adminColumns)
            .from(offlinePayments)
            .innerJoin(plans, eq(plans.id, offlinePayments.planId))
            .innerJoin(users, eq(users.id, offlinePayments.userId))
            .leftJoin(offlinePaymentReceipts, eq(offlinePaymentReceipts.offlinePaymentId, offlinePayments.id))
            .where(and(eq(offlinePayments.status, 'pending_review'), lt(offlinePayments.createdAt, cutoff)))
            .orderBy(asc(offlinePayments.createdAt))
            .limit(200);
        return rows.map((r) => toAdminClaim(r as Record<string, unknown>));
    },

    /**
     * Daily: one alert naming every claim that has waited longer than
     * STALE_PENDING_HOURS. The submit notification fires once per claim and
     * can be lost (spam, Resend outage — send errors are swallowed by design);
     * without this sweep, a merchant's WhatsApp message would be the only
     * second signal. Approved-but-not-granted needs no sweep: the grant
     * CHECK makes it unrepresentable.
     */
    async runStaleClaimsDigest(): Promise<{ stale: number }> {
        const stale = await this.listStalePending();
        if (stale.length > 0) {
            void sendThrottledAdminAlert({
                dedupKey: 'offline-payment:stale-digest',
                cooldownSeconds: 24 * 60 * 60,
                level: 'warning',
                message: `${stale.length} Sham Cash claim(s) waiting for review for over ${STALE_PENDING_HOURS}h`,
                tags: { component: 'offlinePayments' },
                extra: { count: stale.length, claimIds: stale.map((c) => c.id) },
                subject: `${stale.length} Sham Cash claim(s) waiting over ${STALE_PENDING_HOURS} hours`,
                html: `<p>${stale.length} claim(s) have been waiting for review for more than ${STALE_PENDING_HOURS} hours.</p>`
                    + `<p><a href="${config.frontendUrl}/admin/offline-payments">Open the review queue</a></p>`,
            });
        }
        return { stale: stale.length };
    },
};
