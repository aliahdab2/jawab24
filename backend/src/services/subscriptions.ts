import { eq, and, or, gte, lte, desc, sql } from 'drizzle-orm';
import { OFFLINE_PAYMENT_METHODS as SHARED_OFFLINE_PAYMENT_METHODS } from '@jawab24/shared';
import { db } from '../db';
import type { DbExecutor } from './admin/subscriptions';
import { subscriptions, plans, usage, usageLogs, pages, workspaces, users, topupPurchases, messages, comments, instagramComments } from '../db/schema';
import { plansService } from './plans';
import { trialLedgerService, type TrialIdentity } from './trialLedger';
import { redis } from '../lib/redis';
import { notificationService } from './notifications';
import { captureError } from '../utils/sentryHelpers';
import { isShopifyBilled, buildShopifyManageUrl } from '../config/shopifyBilling';
import { config } from '../config';
import { isDemoFacebookId } from '../utils/demo';
import { resolveMarketplaceBilling } from './marketplaceBilling';
import { getWhatsAppUnavailableReason } from './whatsappAvailability';
import type { NotificationType } from './notifications';
import { emailService, type EmailType } from './email';
import { getEmailRecipient } from './emailRecipient';
import { aiUsageEmailTemplate, type AiUsageEmailVariant } from '../utils/emailTemplates';
import {
    resolveAiQuotaStatus,
    PAST_DUE_GRACE_DAYS,
    type AiQuotaStatus,
    type Subscription, type Plan, type Usage, type UsageSummary,
    type SubscriptionStatus, type LimitCheckResult,
} from '@jawab24/shared';

/**
 * AI usage notification thresholds (percent of monthly limit).
 * Crossing one dispatches a one-time notification per subscription period.
 */
export const AI_USAGE_THRESHOLDS = [80, 100] as const;
export type AiUsageThreshold = typeof AI_USAGE_THRESHOLDS[number];

/**
 * Return the thresholds newly crossed by an increment from `oldUsed` to `newUsed`.
 * Pure function — returns [] if limit is null/<=0 or nothing crossed.
 *
 * Measured against the PLAN CAP on purpose, not against plan + top-up: this is the
 * billing boundary, and `incrementAiReplies` never drives `aiRepliesCount` past the
 * cap (overflow is charged to the balance instead). An 80%-of-capacity boundary
 * would therefore sit beyond anything this counter can reach, silently deleting the
 * 80% notification for every top-up holder. The top-up balance changes the MESSAGE,
 * not the trigger — see `resolveAiUsageNotificationType`.
 */
export function computeCrossedAiThresholds(
    oldUsed: number,
    newUsed: number,
    limit: number | null,
): AiUsageThreshold[] {
    if (limit === null || limit <= 0 || newUsed <= oldUsed) return [];
    return AI_USAGE_THRESHOLDS.filter(t => {
        const boundary = (t / 100) * limit;
        return oldUsed < boundary && newUsed >= boundary;
    });
}

/**
 * Pick the notification to send for a newly-crossed AI-usage threshold.
 *
 * The 100% boundary is the plan-quota wall, NOT the point where replies stop.
 * `canUseAiReplies` falls through to the top-up balance, so the real wall is
 * plan + top-up — which is why the choice is made from `resolveAiQuotaStatus`
 * rather than from `topupBalance > 0`:
 *
 *   - `exhausted`         → nothing left; replies really have paused → limit_reached
 *   - `on_topup`, roomy   → replies keep flowing → the calm `ai_usage_on_topup`
 *   - `on_topup`, at the
 *     wall (`nearWall`)   → a balance too thin to be a runway → `ai_usage_topup_low`
 *
 * That last case is the one a bare `topupBalance > 0` got wrong: a merchant with
 * THREE top-up replies left was sent "no interruption — replies keep running from
 * your top-up balance", moments before they stopped. The admin console already
 * separates these two (`usage_on_topup` vs `usage_topup_nearly_drained`); this
 * keeps the merchant's own notification telling the same story.
 *
 * Pure function — exported for unit testing.
 */
export function resolveAiUsageNotificationType(
    threshold: AiUsageThreshold,
    quota: AiQuotaStatus,
): NotificationType {
    if (threshold !== 100) return 'ai_usage_warning_80';
    if (quota.state === 'on_topup') {
        return quota.nearWall ? 'ai_usage_topup_low' : 'ai_usage_on_topup';
    }
    return 'ai_usage_limit_reached';
}

/**
 * The crossings that also go out by email, and the `email_sends.type` each is
 * audited under. Keyed by `AiUsageEmailVariant`, so the three notification types
 * that have an email and the three the template can render are ONE list — adding
 * a variant to the template without a row here is a compile error.
 *
 * `ai_usage_on_topup` is absent on purpose (see the template's docblock): it
 * reports a non-event.
 */
const AI_USAGE_EMAIL_TYPE = {
    ai_usage_warning_80: 'ai_usage_warning',
    ai_usage_limit_reached: 'ai_usage_limit',
    ai_usage_topup_low: 'ai_usage_warning',
} as const satisfies Record<AiUsageEmailVariant, EmailType>;

/** Does this crossing get an email as well as the in-app card? */
export function isEmailableAiUsageType(type: NotificationType): type is AiUsageEmailVariant {
    return Object.prototype.hasOwnProperty.call(AI_USAGE_EMAIL_TYPE, type);
}

/**
 * Email the merchant about a newly-crossed AI-usage threshold.
 *
 * The in-app card and the push both require the merchant to be looking — the
 * bell needs the dashboard open, the push needs the app installed. Running out
 * of replies is silent by construction (customers keep writing; they receive a
 * generic fallback), so a merchant with neither surface open learned about it
 * only from the business they lost. Email is the channel that reaches them
 * where they already are.
 *
 * No dedup of its own: the caller has already claimed the once-per-period
 * threshold key, so this runs at most once per merchant per threshold per
 * billing period. Exported for tests.
 */
export async function sendAiUsageThresholdEmail(
    userId: string,
    variant: AiUsageEmailVariant,
    counts: { used: number; limit: number; balance: number },
): Promise<void> {
    const recipient = await getEmailRecipient(userId);
    // No address on file — nothing was sent, and nothing pretends otherwise.
    // The in-app card remains the merchant's only channel.
    if (!recipient) return;

    const { subject, html } = aiUsageEmailTemplate({
        lang: recipient.lang,
        name: recipient.name,
        variant,
        used: counts.used,
        limit: counts.limit,
        balance: counts.balance,
        pricingUrl: `${config.frontendUrl}/${recipient.lang}/pricing`,
    });

    // `trySend`, not `send`: `send` fails in two shapes and only one of them
    // looks like failure (see its docblock).
    const { delivered, error } = await emailService.trySend({
        to: recipient.email,
        subject,
        html,
        type: AI_USAGE_EMAIL_TYPE[variant],
        userId,
    });

    if (!delivered) {
        captureError(
            new Error(`AI usage ${variant} email failed: ${error ?? 'unknown error'}`),
            'subscriptions.aiUsageEmailFailed',
            { tags: { service: 'subscriptions' }, level: 'warning', extra: { userId, variant } },
        );
    }
}

/**
 * Payment methods where NO external authority advances the billing period — a
 * human does, through `adminSubscriptionsService.manualUpgrade`, after money
 * lands off-platform. 'manual' (admin comp / cash), 'bank_transfer',
 * 'syrian_bank' (all three already selectable in the admin upgrade modal), and
 * 'sham_cash' (the Syria rail). Built from the ONE list in `@jawab24/shared`
 * (`OFFLINE_PAYMENT_METHODS`) that the admin upgrade route validates against and
 * the admin modal renders from — never re-listed here.
 *
 * ONE set, because the three predicates below used to test the string 'manual'
 * directly and every other offline string fell through them: a `bank_transfer`
 * row skipped the immediate-expiry check, landed in the past_due branch, and
 * collected the 3-day grace meant for a STRIPE CARD RETRY — with its usage
 * window already closed, `getCurrentUsage` reads used=0, so the merchant got a
 * free full-quota refill for three days after their subscription ended. There
 * is no card to retry on any of these rails; expiry is immediate by design
 * (D-023). Same rule as LAZY_EXPIRY_CANARIES below: a new offline rail is an
 * entry here, never another copied if-block.
 *
 * Exported for tests and for anything else that must ask "is this rail
 * human-advanced?" rather than re-listing the strings.
 *
 * ⛔ SYRIA IS NOT THE CRITERION — "who advances the period" is. When the Syrian
 * gateway (Paymera) is integrated it is a MANAGED rail like stripe/shopify/zid/
 * salla: its callbacks advance the period, so it belongs in
 * LAZY_EXPIRY_CANARIES below and must NOT be added here. Adding it here on the
 * "Syria = offline" pattern would expire a properly-billed subscription on
 * date and deny it the grace window that exists precisely to absorb a late
 * callback — i.e. it would cut off a paying customer mid-renewal.
 */
export const OFFLINE_PAYMENT_METHODS: ReadonlySet<string> = new Set<string>(SHARED_OFFLINE_PAYMENT_METHODS);

/** True when a subscription's period is advanced by a human, not a processor. */
export function isOfflinePaymentMethod(paymentMethod: string | null | undefined): boolean {
    return !!paymentMethod && OFFLINE_PAYMENT_METHODS.has(paymentMethod);
}

/**
 * Is this subscription row a real billing relationship (paying or admin-comp),
 * as opposed to a free-trial-only account?
 *
 * Status is intentionally NOT required to be 'active' for Stripe rows: a
 * card-on-file customer mid Stripe-managed trial (status='trialing' with an
 * externalSubscriptionId) is a real customer, not a free-trial farmer. Only the
 * OFFLINE rails require status='active', so a canceled comp doesn't count.
 *
 * Shopify-billed rows (payment_method='shopify') read as paying through the
 * first branch BY DESIGN: their externalSubscriptionId holds the AppSubscription
 * GID, and a Shopify-managed trial is card-equivalent commitment exactly like a
 * Stripe-managed one (locked by test — see subscriptions isPayingCustomer suite).
 *
 * Pure function — exported for unit testing.
 */
export function isPayingCustomer(row: {
    status: string | null;
    externalSubscriptionId: string | null;
    stripeCustomerId: string | null;
    paymentMethod: string | null;
}): boolean {
    if (row.externalSubscriptionId || row.stripeCustomerId) return true;
    if (isOfflinePaymentMethod(row.paymentMethod) && row.status === 'active') return true;
    return false;
}

/**
 * Thrown by incrementAiReplies when both the plan quota AND the topup balance
 * are insufficient to absorb the requested count. Rare in practice — callers
 * gate with canUseAiReplies first — but possible under concurrent increments
 * that race the gate's read.
 */
export class QuotaExhaustedError extends Error {
    constructor(message = 'AI reply quota exhausted and no top-up balance available') {
        super(message);
        this.name = 'QuotaExhaustedError';
    }
}

/**
 * Lazy-expiry canaries, one per rail where an EXTERNAL authority advances the
 * billing period — stripe via renewal webhooks, shopify via the 6h billing
 * reconciler (D-B; the 3-day past_due grace absorbs a late sweep). A row on
 * these rails lazily expiring means the authority is broken; a Sentry warning
 * fires before a paying customer notices. The OFFLINE_PAYMENT_METHODS rails are
 * deliberately absent (D-023: manual expiry IS the normal path — a human, not a
 * processor, advances those periods). New MANAGED rails (zid, salla) get an
 * entry here — never another copied if-block.
 */
const LAZY_EXPIRY_CANARIES: Record<string, {
    message: string;
    flow: string;
    /** stripe rows without an external id are unlinked legacy rows — no authority to blame */
    requiresExternalId: boolean;
}> = {
    stripe: {
        message: 'Stripe subscription lazily expired — renewal webhook did not advance the period',
        flow: 'lazy_expiry',
        requiresExternalId: true,
    },
    shopify: {
        message: 'Shopify-billed subscription lazily expired — the billing reconciler did not advance the period',
        flow: 'lazy_expiry_shopify',
        requiresExternalId: false,
    },
    // Zid advances the period through its own App Market subscription, which we
    // mirror on the webhook trigger and the 6h reconciler. A zid row reaching
    // lazy expiry means BOTH missed — the webhook was not delivered AND the
    // sweep did not heal it. requiresExternalId is false because the payload is
    // not confirmed to carry a subscription id at all (see services/zidBilling).
    zid: {
        message: 'Zid-billed subscription lazily expired — neither the subscription webhook nor the billing reconciler advanced the period',
        flow: 'lazy_expiry_zid',
        requiresExternalId: false,
    },
    // Salla advances the period through its own app subscription, mirrored on
    // the webhook trigger, the post-claim sync, and the 6h reconciler. A salla
    // row reaching lazy expiry means ALL of them missed. requiresExternalId is
    // false because `subscription_id` is documented to change every renewal
    // cycle (see services/sallaBilling) — its absence proves nothing.
    salla: {
        message: 'Salla-billed subscription lazily expired — neither the subscription webhook nor the billing reconciler advanced the period',
        flow: 'lazy_expiry_salla',
        requiresExternalId: false,
    },
};

/** Cache TTL for subscription status (seconds). Short so payment events reflect quickly. */
const STATUS_CACHE_TTL = 60;
/**
 * How long a `past_due` subscription keeps its entitlement past
 * `current_period_end` — covers Stripe's first payment-retry window (declined
 * card, bank flag) without giving abusers a week of free service every month.
 * Matches Shopify. Exported because the dunning emails print the same boundary
 * (services/dunningNotices.ts) — display and enforcement must share one clock.
 *
 * The value itself lives in @jawab24/shared as `PAST_DUE_GRACE_DAYS`, because
 * the support console (admin/health.ts, deliberately DB-free) must date the
 * same fuse this gate burns. This name is kept for the dunning sweep's
 * existing import; it is the same constant, never a second literal.
 */
export const GRACE_PERIOD_DAYS = PAST_DUE_GRACE_DAYS;

/**
 * Snap a date to 00:00:00 UTC. Used to align usage rollover to a calendar boundary
 * instead of the exact subscription-start instant — merchants in MENA (UTC+3) see
 * the reset happen overnight at 3 AM local, the lowest-activity window.
 */
export function startOfUtcDay(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

/**
 * Exactly the fields `checkSubscriptionStatus` reads. Narrower than
 * `Subscription & { plan: Plan }` on purpose: entitlement never depends on the
 * plan, and demanding one forced every caller that only has a subscription row
 * — the admin console among them — to either fabricate a plan or re-implement
 * the predicate. A second implementation is precisely how the console came to
 * disagree with the gate.
 */
export type SubscriptionStatusInput = Pick<
    Subscription,
    'status' | 'paymentMethod' | 'currentPeriodEnd' | 'trialEndsAt'
>;

/**
 * The instant a subscription's entitlement ACTUALLY ends — the same boundary
 * `checkSubscriptionStatus` enforces, exported so every display surface reads
 * it from one place instead of re-deriving it from `currentPeriodEnd`.
 *
 * For a MANUAL (cash/transfer) subscription that boundary is snapped back to
 * UTC midnight of the period-end day, because `initializeUsagePeriod` snaps the
 * usage window the same way — see the long comment in `checkSubscriptionStatus`.
 * That snap is deliberate and load-bearing (it closes the free-refill hole), but
 * it means entitlement ends up to ~24h BEFORE the raw `currentPeriodEnd` instant
 * every UI used to print. Printing the raw instant is what let a merchant read
 * "14 August" while replies had already stopped at 14 August 00:00 UTC.
 *
 * Returns null when nothing bounds the subscription in time (no period end).
 */
export function resolveEntitlementEnd(subscription: SubscriptionStatusInput): Date | null {
    const { status, paymentMethod, currentPeriodEnd, trialEndsAt } = subscription;

    // Order mirrors checkSubscriptionStatus branch for branch. Each arm answers
    // "which clock cuts this subscription off?", and it is NOT currentPeriodEnd
    // on three of the four rails:
    //
    //   manual        → currentPeriodEnd SNAPPED to UTC midnight (up to 24h early)
    //   trial-origin  → trialEndsAt, which can be WEEKS before currentPeriodEnd
    //   past_due      → currentPeriodEnd + the retry grace (3 days LATE)
    //   trialing      → trialEndsAt
    //
    // The first cut of this function modelled only the manual rail and returned
    // the raw currentPeriodEnd for everything else. On a trial that is a date
    // ~23 days in the FUTURE, which the dashboard then printed as "Coverage
    // ended <future date>" — reproducing, larger, the very defect this PR was
    // written to remove. Keep the arms in lockstep with the gate.
    // null means "no CLOCK bounds this row", never "it has ended". canceled/paused
    // are refused by status, and a past_due row with no currentPeriodEnd is never
    // refused at all — both are unbounded in time, so no date may be shown for them.
    if (status === 'canceled' || status === 'paused') return null;

    if (isOfflinePaymentMethod(paymentMethod) && currentPeriodEnd) {
        return startOfUtcDay(new Date(currentPeriodEnd));
    }

    if (!paymentMethod && trialEndsAt && (status === 'trialing' || status === 'past_due')) {
        return new Date(trialEndsAt);
    }

    if (status === 'past_due') {
        if (!currentPeriodEnd) return null; // gate never blocks this row — see below
        const graceEnd = new Date(currentPeriodEnd);
        graceEnd.setDate(graceEnd.getDate() + PAST_DUE_GRACE_DAYS);
        return graceEnd;
    }

    if (status === 'trialing' && trialEndsAt) return new Date(trialEndsAt);

    return currentPeriodEnd ? new Date(currentPeriodEnd) : null;
}

/**
 * Subscriptions Service - Manages user subscriptions and usage
 */
// Shared SQL for subscription priority: Active/Trialing > Past Due > Others
const SUBSCRIPTION_PRIORITY_SQL = sql`CASE WHEN ${subscriptions.status} IN ('active', 'trialing') THEN 1 WHEN ${subscriptions.status} = 'past_due' THEN 2 ELSE 3 END`;

/**
 * Subscriptions Service - Manages user subscriptions and usage
 */
export const subscriptionsService = {
    // Export for use in other files (like PaymentController)
    PRIORITY_SQL: SUBSCRIPTION_PRIORITY_SQL,
    /**
     * Get user's current subscription with plan details
     * Includes automatic expiration check - updates status if period has ended
     */
    async getUserSubscription(userId: string): Promise<(Subscription & { plan: Plan }) | null> {
        const result = await db
            .select({
                subscription: subscriptions,
                plan: plans,
            })
            .from(subscriptions)
            .innerJoin(plans, eq(subscriptions.planId, plans.id))
            .where(eq(subscriptions.userId, userId))
            .orderBy(
                SUBSCRIPTION_PRIORITY_SQL,
                desc(subscriptions.createdAt)
            )
            .limit(1);

        if (!result[0]) return null;

        const sub = result[0].subscription;
        const now = new Date();

        // Check for expired subscription and auto-update status
        let needsUpdate = false;
        let newStatus: SubscriptionStatus | null = null;

        // Check trial expiration
        if (sub.status === 'trialing' && sub.trialEndsAt) {
            const trialEnd = new Date(sub.trialEndsAt);
            if (trialEnd < now) {
                needsUpdate = true;
                newStatus = 'past_due';
            }
        }

        // Check period expiration for active subscriptions. If the user opted
        // for graceful cancel (cancel_at_period_end=true), the terminal state
        // is `canceled`, not `past_due` — they explicitly asked to stop.
        if (sub.status === 'active' && sub.currentPeriodEnd) {
            const periodEnd = new Date(sub.currentPeriodEnd);
            if (periodEnd < now) {
                needsUpdate = true;
                newStatus = sub.cancelAtPeriodEnd ? 'canceled' : 'past_due';

                // Canary: on rails where an EXTERNAL authority advances the
                // period (see LAZY_EXPIRY_CANARIES), a row reaching this branch
                // means that authority failed — the exact failure that silently
                // re-downgraded a paid Stripe customer (utils/stripeCompat.ts).
                // Flag it loudly instead of quietly flipping a paying customer
                // to past_due.
                const canary = sub.paymentMethod ? LAZY_EXPIRY_CANARIES[sub.paymentMethod] : undefined;
                if (
                    canary &&
                    !sub.cancelAtPeriodEnd &&
                    (!canary.requiresExternalId || sub.externalSubscriptionId)
                ) {
                    captureError(null, canary.message, {
                        level: 'warning',
                        tags: { service: 'subscriptions', flow: canary.flow },
                        extra: {
                            subscriptionId: sub.id,
                            externalSubscriptionId: sub.externalSubscriptionId,
                            shopifyShopDomain: sub.shopifyShopDomain,
                            currentPeriodEnd: sub.currentPeriodEnd,
                        },
                    });
                }
            }
        }

        // Auto-update status if expired
        if (needsUpdate && newStatus) {
            await db
                .update(subscriptions)
                .set({
                    status: newStatus,
                    updatedAt: now,
                })
                .where(eq(subscriptions.id, sub.id));

            // Return updated subscription
            return {
                ...this.mapToSubscription({
                    ...sub,
                    status: newStatus,
                    updatedAt: now,
                }),
                plan: plansService.mapToPlan(result[0].plan),
            };
        }

        return {
            ...this.mapToSubscription(sub),
            plan: plansService.mapToPlan(result[0].plan),
        };
    },

    /**
     * Fast subscription status check for the reply pipeline.
     * Returns true if the user is entitled to auto-replies.
     * Cached in Redis for 60s to keep the hot path fast.
     *
     * Delegates to `checkSubscriptionStatus` — THE entitlement predicate — rather
     * than testing `status in (active, trialing)` itself. It used to do the latter,
     * which made it a second, disagreeing answer to "is this account replying?":
     * a manual (cash/transfer) plan holds `status = 'active'` for good and lapses
     * only at a snapped UTC-midnight boundary, so this would have called a frozen
     * account active. It has no production caller today, and its docstring invites
     * one onto the hot path — so it must not be able to disagree with the gate.
     */
    async isSubscriptionActive(userId: string): Promise<boolean> {
        const cacheKey = `sub:active:${userId}`;

        try {
            const cached = await redis.get(cacheKey);
            if (cached !== null) return cached === '1';
        } catch {
            // Redis down — fall through to DB
        }

        const sub = await this.getUserSubscription(userId);
        // No subscription row = free/trial user → allow replies, matching
        // canAutoReply. Only an explicit, unentitled subscription blocks.
        const active = sub === null || this.checkSubscriptionStatus(sub).allowed;

        try {
            await redis.set(cacheKey, active ? '1' : '0', 'EX', STATUS_CACHE_TTL);
        } catch {
            // Cache write failure is non-critical
        }

        return active;
    },

    /**
     * Invalidate cached subscription status (call after payment events).
     */
    async invalidateStatusCache(userId: string): Promise<void> {
        try {
            await redis.del(`sub:active:${userId}`);
        } catch {
            // Non-critical
        }
    },

    /**
     * Create subscription for a new user
     */
    async createSubscription(userId: string, planId?: string): Promise<Subscription> {
        // Get the plan (or default plan)
        let plan: Plan | null;
        if (planId) {
            plan = await plansService.getPlanById(planId);
        } else {
            plan = await plansService.getDefaultPlan();
        }

        if (!plan) {
            throw new Error('No valid plan found');
        }

        const now = new Date();

        // Free-trial anti-abuse. The 14-day trial is a one-time benefit per signup
        // IDENTITY, not per account: account deletion hard-deletes the user +
        // subscription rows, so re-signing-up with the same phone / Facebook id
        // would otherwise mint a brand-new trial (and fresh monthly quota) every
        // cycle — farmable for unlimited free usage. Only the organic signup path
        // (no explicit planId → default plan) is gated; admin / Stripe plan
        // assignments pass a planId and are untouched. A returning identity that
        // already used its trial gets a 'canceled' subscription (no trial dates) →
        // canUseAiReplies blocks it immediately, so the account looks new but starts
        // with zero free replies and must subscribe. See services/trialLedger.ts and
        // the trial_grants table in db/schema.ts.
        let trialIdentities: TrialIdentity[] = [];
        let trialAlreadyConsumed = false;
        if (!planId && plan.trialDays > 0) {
            const [identityRow] = await db
                .select({ phone: users.phone, facebookId: users.facebookId })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);
            if (identityRow) {
                trialIdentities = trialLedgerService.identitiesForUser(identityRow);
                // Fail-open: a ledger read error must never block a legitimate new
                // signup, so an unreachable ledger falls through to granting the trial.
                trialAlreadyConsumed = await trialLedgerService
                    .hasConsumedTrial(trialIdentities)
                    .catch(() => false);
            }
        }

        // Trial dates only for a real, fresh trial. A returning identity gets none.
        const trialEndsAt = (plan.trialDays > 0 && !trialAlreadyConsumed)
            ? new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000)
            : null;

        // Calculate period end (1 month from now)
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        // Determine initial status. A returning identity that already burned its
        // trial lands in 'canceled' — zero free entitlement, blocked immediately by
        // canUseAiReplies with no grace, and (unlike an expired 'trialing' row) NOT
        // lazily flipped to 'past_due' by getUserSubscription, whose 3-day grace off
        // a fresh currentPeriodEnd would otherwise re-open a month of free replies.
        const status: SubscriptionStatus = trialAlreadyConsumed
            ? 'canceled'
            : (plan.trialDays > 0 ? 'trialing' : 'active');

        const result = await db
            .insert(subscriptions)
            .values({
                userId,
                planId: plan.id,
                status,
                trialEndsAt,
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
            })
            .returning();

        // Initialize usage tracking for this period
        await this.initializeUsagePeriod(userId, now, periodEnd);

        // Claim the trial in the survivor ledger only when a real, fresh trial was
        // actually granted (first writer wins; preserves the original
        // firstTrialedAt). Best-effort — never breaks subscription creation.
        if (trialIdentities.length > 0 && !trialAlreadyConsumed) {
            await trialLedgerService.record(trialIdentities, userId);
        }

        return this.mapToSubscription(result[0]);
    },

    /**
     * Initialize usage tracking for a billing period
     */
    async initializeUsagePeriod(userId: string, periodStart: Date, periodEnd: Date, executor: DbExecutor = db): Promise<void> {
        // Snap to UTC midnight so the quota window aligns with a calendar boundary,
        // not the exact subscription-start instant.
        const normalizedStart = startOfUtcDay(periodStart);
        const normalizedEnd = startOfUtcDay(periodEnd);

        // Close any still-open prior period so it can't overlap with the new one.
        // On admin upgrade (and Stripe plan-change events that don't wait for the
        // current period to end), the prior row's periodEnd is in the future —
        // without this, getCurrentUsage's `periodStart <= now <= periodEnd` query
        // can match the old maxed row instead of the fresh one.
        await executor
            .update(usage)
            .set({ periodEnd: normalizedStart, updatedAt: new Date() })
            .where(
                and(
                    eq(usage.userId, userId),
                    gte(usage.periodEnd, normalizedStart),
                    sql`${usage.periodStart} < ${normalizedStart}`
                )
            );

        // Check if period already exists (idempotency for webhook replays)
        const existing = await executor
            .select()
            .from(usage)
            .where(
                and(
                    eq(usage.userId, userId),
                    eq(usage.periodStart, normalizedStart)
                )
            )
            .limit(1);

        if (existing.length > 0) return;

        await executor.insert(usage).values({
            userId,
            periodStart: normalizedStart,
            periodEnd: normalizedEnd,
            aiRepliesCount: 0,
            totalCommentsProcessed: 0,
            totalMessagesProcessed: 0,
            dailyBreakdown: {},
        });
    },

    /**
     * Get current usage for user
     */
    async getCurrentUsage(userId: string): Promise<Usage | null> {
        const now = new Date();

        // Order by periodStart DESC so that if two rows briefly overlap (e.g. a
        // mid-period upgrade), we always pick the most recently opened one
        // instead of the older maxed-out row. initializeUsagePeriod closes the
        // prior row, but this ordering is defense-in-depth.
        const result = await db
            .select()
            .from(usage)
            .where(
                and(
                    eq(usage.userId, userId),
                    lte(usage.periodStart, now),
                    gte(usage.periodEnd, now)
                )
            )
            .orderBy(desc(usage.periodStart))
            .limit(1);

        return result[0] ? this.mapToUsage(result[0]) : null;
    },

    /**
     * Resolve the effective subscription for a (user, workspace): the user's
     * own, or — for team members with no subscription row — the workspace
     * owner's. Returns the subscription plus the owning userId (for usage/cap
     * attribution), or null when neither has one.
     */
    async resolveWorkspaceSubscription(
        userId: string,
        workspaceId: string,
    ): Promise<{ subscription: Subscription & { plan: Plan }; ownerId: string } | null> {
        // Billing belongs to the WORKSPACE, so the owner's subscription is the
        // answer for everyone in it — including the owner, for whom it is the
        // same row either way.
        //
        // This used to read "mine, else the owner's", on the assumption stated
        // in the old comment: "Team members have no subscription row". That is
        // false, and was false for 4 of 4 team members on the platform — every
        // signup mints a trial row, and it lingers when that person is later
        // added to someone else's workspace. So the fallback branch written FOR
        // team members had never once run in production, and each of them saw
        // their own expired `starter` instead of the workspace's real plan.
        //
        // The visible cost was not a cosmetic label. `/subscription/usage`
        // feeds the dashboard's plan banner, so when a workspace's subscription
        // lapsed, the people actually using the app were shown a healthy-looking
        // ghost plan and had no way to learn why replies had stopped.
        const [workspace] = await db
            .select({ ownerId: workspaces.ownerId })
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .limit(1);

        // No workspace row (or no owner) is not a reason to show someone else's
        // billing — fall back to the caller's own, which is what a personal
        // workspace resolves to anyway.
        const ownerId = workspace?.ownerId ?? userId;
        const subscription = await this.getUserSubscription(ownerId);

        return subscription ? { subscription, ownerId } : null;
    },

    /**
     * Can this WORKSPACE still use AI replies? The workspace-scoped twin of
     * `canUseAiReplies`, and the one every HTTP surface should call.
     *
     * Quota belongs to the workspace, so it must be answered for the
     * workspace's billing subject rather than for whoever happens to be logged
     * in. A team member carrying a leftover trial row from their own signup
     * would otherwise be told their AI is blocked while the workspace they are
     * working in is perfectly healthy — and, once that workspace lapses, be
     * told the opposite.
     *
     * Same shape as `getUsageSummary(userId, workspaceId)` so the two
     * workspace-scoped reads resolve their subject identically and cannot
     * disagree; the route composing them by hand is what let them drift.
     */
    async canUseAiRepliesForWorkspace(userId: string, workspaceId: string): Promise<LimitCheckResult> {
        const resolved = await this.resolveWorkspaceSubscription(userId, workspaceId);
        return this.canUseAiReplies(resolved?.ownerId ?? userId);
    },

    /**
     * Get full usage summary with limits and subscription info
     */
    async getUsageSummary(userId: string, workspaceId: string): Promise<UsageSummary | null> {
        const resolved = await this.resolveWorkspaceSubscription(userId, workspaceId);
        if (!resolved) return null;
        const { subscription, ownerId: subscriptionOwnerId } = resolved;

        const currentUsage = await this.getCurrentUsage(subscriptionOwnerId);
        const plan = subscription.plan;

        // Count enabled page slots (FB + IG counted separately)
        const pagesUsed = await this.countEnabledPageSlots(workspaceId);

        // Calculate trial days remaining
        let trialDaysRemaining: number | undefined;
        if (subscription.status === 'trialing' && subscription.trialEndsAt) {
            const trialEnd = new Date(subscription.trialEndsAt);
            const now = new Date();
            trialDaysRemaining = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
        }

        const aiUsed = currentUsage?.aiRepliesCount || 0;
        const aiLimit = plan.maxAiRepliesPerMonth;

        // Top-up balance attaches to the subscription owner, not the requesting
        // user (team members see the owner's combined plan + top-up).
        const topup = await this.getTopupSummary(subscriptionOwnerId);

        // Resolved once, against the SUBSCRIPTION OWNER — the same subject the
        // payment controller's guard uses, so the UI and the API cannot disagree.
        const marketplaceVerdict = await resolveMarketplaceBilling(subscriptionOwnerId, subscription);

        // WhatsApp connect availability, INDEPENDENT of plan and marketplace
        // billing — a store connected through Zid blocks the channel entirely
        // (D-117), even for a fully-paid Business account and even when Stripe
        // (not Zid) is the billing rail. Resolved separately from
        // marketplaceVerdict for exactly that reason: the billing resolver's
        // Stripe exemption would miss a Stripe-paying Zid merchant. Same subject
        // (the subscription owner), so the UI hides the connect entry the API
        // will refuse.
        const whatsappUnavailableReason = await getWhatsAppUnavailableReason(subscriptionOwnerId);

        // THE gate verdict — the very predicate enforceAutoReplyGate blocks on,
        // not a second opinion assembled from `status` or percent-of-quota.
        //
        // Without this the dashboard had no way to know replies were frozen: a
        // manual subscription past its snapped boundary closes the usage window,
        // getCurrentUsage then matches no row, `used` reads 0 — and the warning
        // banner, seeing 0 of 4,500, concluded everything was healthy and hid
        // itself. The merchant saw a green dashboard while every reply was
        // refused (owner's own account, 2026-08-14). `reason` is deliberately NOT
        // forwarded: it is an internal English string, and the client renders a
        // translated message keyed off `code`.
        // Read through resolveEntitlement, not checkSubscriptionStatus: the shared
        // demo fixture is exempted there exactly as the reply gates exempt it, so
        // this banner and /limits/ai can never give the same account two answers.
        const entitlement = await this.resolveEntitlement(subscriptionOwnerId, subscription);
        const entitlementEnd = resolveEntitlementEnd(subscription);

        // What the block has cost so far, counted only when there IS a block and
        // a boundary to count from. "Your subscription ended" is a statement a
        // merchant can put off; "579 customers wrote and nobody answered" is the
        // same fact in the terms they actually decide on.
        //
        // Scoped to the WORKSPACE being viewed, not the subscription owner: the
        // merchant is asking about the pages on this screen, and an owner with
        // two workspaces would otherwise see one workspace's silence reported on
        // the other's dashboard.
        const unansweredSinceBlock = !entitlement.allowed && entitlementEnd
            ? await this.countUnansweredSince(workspaceId, entitlementEnd)
            : undefined;

        return {
            currentPeriod: {
                start: currentUsage?.periodStart?.toString() || new Date().toISOString(),
                end: currentUsage?.periodEnd?.toString() || new Date().toISOString(),
            },
            aiReplies: {
                used: aiUsed,
                limit: aiLimit,
                remaining: aiLimit ? Math.max(0, aiLimit - aiUsed) : null,
                percentUsed: aiLimit ? Math.min(100, (aiUsed / aiLimit) * 100) : 0,
            },
            pages: {
                used: pagesUsed,
                limit: plan.maxPages,
                remaining: plan.maxPages ? Math.max(0, plan.maxPages - pagesUsed) : null,
            },
            topup,
            subscription: {
                plan,
                status: subscription.status,
                trialDaysRemaining,
                renewsAt: subscription.currentPeriodEnd?.toString(),
                // When entitlement actually lapses — snapped for manual plans, so
                // this can be ~24h earlier than `renewsAt`. Surfaces that tell a
                // merchant "until when am I covered?" must read THIS, not renewsAt.
                entitlementEndsAt: entitlementEnd?.toISOString(),
                autoReply: { allowed: entitlement.allowed, code: entitlement.code, cause: entitlement.cause, unansweredSinceBlock },
                hasStripeCustomer: Boolean(subscription.stripeCustomerId),
                // A CANCELED shopify mirror must NOT read as shopify-billed
                // (isShopifyBilled carries the exemption): the merchant
                // uninstalled the app and is free to come back through Stripe.
                // Suppressed HERE — the single choke point — so no frontend
                // consumer (plan select, top-up CTA, pricing banner) can
                // dead-end a returning merchant.
                paymentMethod:
                    subscription.paymentMethod === 'shopify' && !isShopifyBilled(subscription)
                        ? undefined
                        : subscription.paymentMethod ?? undefined,
                // Shopify-billed workspaces manage their plan inside Shopify
                // admin (D-G) — hand the frontend the exact deep link so it
                // never has to assemble Shopify URLs itself.
                shopifyManageUrl:
                    isShopifyBilled(subscription) && subscription.shopifyShopDomain
                        ? buildShopifyManageUrl(subscription.shopifyShopDomain)
                        : undefined,
                // Which marketplace — if any — owns this account's paid plans,
                // so every Stripe CTA is suppressed for them. Computed at this
                // ONE choke point against the SUBSCRIPTION OWNER, using the
                // SAME resolver the payment controller's guard uses, so the UI
                // can never offer an upgrade the payment API then refuses.
                marketplaceBilling: marketplaceVerdict
                    ? { marketplace: marketplaceVerdict.marketplace, manageUrl: marketplaceVerdict.manageUrl }
                    : undefined,
                // Kept in step with the legacy Salla-only flag for older
                // bundled app builds — see the field's doc comment. Narrowed to
                // 'salla' on purpose: this flag never described the Shopify or
                // Zid rails, and widening it now would change what an old app
                // does with it.
                sallaBilled: marketplaceVerdict?.marketplace === 'salla' || undefined,
                // Why the WhatsApp channel is unavailable to connect, regardless
                // of plan — today only a Zid store (D-117). The frontend gates
                // every WhatsApp connect surface on this so it can never offer
                // what the connect API will 403.
                whatsappUnavailable: whatsappUnavailableReason
                    ? { reason: whatsappUnavailableReason }
                    : undefined,
            },
        };
    },

    /**
     * Increment AI reply usage.
     *
     * Consumption order: plan quota first (resets monthly), then top-up balance
     * (non-expiring). Splits `count` across both sources in a single transaction
     * so a partial failure can't leave the user "charged twice" or "charged once
     * but credited zero".
     *
     * Throws QuotaExhaustedError if the top-up decrement guard fails — rare,
     * happens only when concurrent consumption races the gate. Caller should
     * surface as a "balance depleted, please buy more" message.
     */
    async incrementAiReplies(userId: string, count: number = 1): Promise<void> {
        if (count <= 0) return;
        const now = new Date();

        // Ensure a usage period exists so the UPDATE below matches a row.
        const currentUsage = await this.getCurrentUsage(userId);
        if (!currentUsage) {
            const periodEnd = new Date(now);
            periodEnd.setMonth(periodEnd.getMonth() + 1);
            await this.initializeUsagePeriod(userId, now, periodEnd);
        }

        // Determine how much of `count` lands on the plan vs the top-up.
        //
        // The plan counter only entitles usage when the subscription is in a
        // status that the gate (canUseAiReplies → checkSubscriptionStatus) would
        // allow. For canceled / paused / past-due-beyond-grace subscriptions,
        // the `plan.maxAiRepliesPerMonth` still has a value (it's the plan they
        // USED to be on), but they're no longer entitled to that quota — so we
        // must NOT consume against it. All usage in that state goes to top-up.
        //
        // Without this gate, a canceled merchant with top-up balance would burn
        // a ghost plan quota each new usage period (created by the
        // initializeUsagePeriod call above) and the top-up balance would never
        // decrement — effectively granting them free unlimited usage. The gate
        // and the writer must agree on what counts as "active".
        const subscription = await this.getUserSubscription(userId);
        const statusAllowsPlan = subscription
            ? this.checkSubscriptionStatus(subscription).allowed
            : false;

        let planRoom: number;
        if (!statusAllowsPlan || !subscription) {
            // No subscription, or status doesn't entitle plan usage (canceled,
            // paused, past_due past grace). Top-up absorbs the entire count.
            planRoom = 0;
        } else if (subscription.plan.maxAiRepliesPerMonth === null) {
            // Active subscription with unlimited plan.
            planRoom = Number.POSITIVE_INFINITY;
        } else {
            const currentCount = (await this.getCurrentUsage(userId))?.aiRepliesCount ?? 0;
            planRoom = Math.max(0, subscription.plan.maxAiRepliesPerMonth - currentCount);
        }

        const planConsumed = Math.min(count, planRoom);
        const topupConsumed = count - planConsumed;

        // Atomic split: both writes succeed together or roll back together.
        const updated = await db.transaction(async (tx) => {
            let updatedUsage: { aiRepliesCount: number | null; periodStart: Date } | null = null;

            if (planConsumed > 0) {
                const [row] = await tx
                    .update(usage)
                    .set({
                        aiRepliesCount: sql`COALESCE(${usage.aiRepliesCount}, 0) + ${planConsumed}`,
                        updatedAt: new Date(),
                    })
                    .where(
                        and(
                            eq(usage.userId, userId),
                            lte(usage.periodStart, now),
                            gte(usage.periodEnd, now)
                        )
                    )
                    .returning({ aiRepliesCount: usage.aiRepliesCount, periodStart: usage.periodStart });
                updatedUsage = row ?? null;
            }

            if (topupConsumed > 0) {
                // WHERE guard ensures we never drive the balance negative via a
                // race. If the row count is zero, another concurrent consumer
                // drained the balance after our gate read — throw to roll back.
                const guarded = await tx
                    .update(users)
                    .set({
                        topupBalance: sql`${users.topupBalance} - ${topupConsumed}`,
                        updatedAt: new Date(),
                    })
                    .where(
                        and(
                            eq(users.id, userId),
                            gte(users.topupBalance, topupConsumed)
                        )
                    )
                    .returning({ id: users.id });

                if (guarded.length === 0) {
                    throw new QuotaExhaustedError();
                }
            }

            return updatedUsage;
        });

        await this.logUsageEvent(userId, 'ai_reply', {
            count,
            planConsumed,
            topupConsumed,
        });

        // Dispatch threshold notifications (80%, 100%) — best-effort, never breaks the reply flow.
        // Only fires on the plan-counter side; top-up consumption doesn't have thresholds.
        if (updated && planConsumed > 0) {
            const newUsed = updated.aiRepliesCount ?? 0;
            await this.maybeNotifyAiUsageThreshold(userId, newUsed - planConsumed, newUsed, updated.periodStart);
        }
    },

    /**
     * Send 80%/100% AI-usage notifications once per subscription period.
     * Dedup is enforced in Redis keyed by userId + periodStart + threshold.
     * Errors are swallowed and reported — a notification failure must not break usage tracking.
     */
    async maybeNotifyAiUsageThreshold(
        userId: string,
        oldUsed: number,
        newUsed: number,
        periodStart: Date,
    ): Promise<void> {
        try {
            const subscription = await this.getUserSubscription(userId);
            const limit = subscription?.plan.maxAiRepliesPerMonth ?? null;
            const crossed = computeCrossedAiThresholds(oldUsed, newUsed, limit);
            if (crossed.length === 0 || limit === null) return;

            const periodKey = periodStart.toISOString();
            // TTL: 40 days — longer than any billing period, so dedup survives until the period rolls over.
            const DEDUP_TTL_SECONDS = 40 * 24 * 60 * 60;

            for (const threshold of crossed) {
                const dedupKey = `notif:ai_usage:${userId}:${periodKey}:${threshold}`;
                let firstCrossing = true;
                try {
                    const set = await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
                    firstCrossing = set === 'OK';
                } catch {
                    // Redis unavailable — allow the notification; duplicates are preferable to silence.
                    firstCrossing = true;
                }
                if (!firstCrossing) continue;

                // At the 100% wall the message depends on how much runway the
                // top-up balance actually buys — read it only then.
                const topupBalance = threshold === 100 ? await this.getTopupBalance(userId) : 0;
                const quota = resolveAiQuotaStatus({ used: newUsed, limit, topupBalance });
                const type = resolveAiUsageNotificationType(threshold, quota);
                // Both top-up messages quote the balance; the plan-cap ones quote usage.
                const variables: Record<string, string> = type === 'ai_usage_on_topup' || type === 'ai_usage_topup_low'
                    ? { limit: limit.toLocaleString('en-US'), balance: topupBalance.toLocaleString('en-US') }
                    : { used: String(newUsed), limit: String(limit), percent: String(threshold) };

                // Both channels, in PARALLEL and each with its own failure. Parallel
                // because this runs on the reply path (Rule 17.3) — sequential would
                // add the FCM round-trip and the Resend round-trip to the same reply;
                // independent because sharing one `await` made the least reliable
                // channel a gate on the other, which is the mistake
                // `pageAutoPause.notifyMerchantAutoPaused` was corrected for. A
                // rejection here no longer aborts the loop either: when one increment
                // crosses 80 and 100 at once, a failed 80% send must not swallow the
                // "your replies have stopped" notice behind it.
                const [inApp, email] = await Promise.allSettled([
                    notificationService.sendTemplateNotification(userId, type, variables),
                    isEmailableAiUsageType(type)
                        ? sendAiUsageThresholdEmail(userId, type, { used: newUsed, limit, balance: topupBalance })
                        : Promise.resolve(),
                ]);

                if (inApp.status === 'rejected') {
                    captureError(inApp.reason, 'Failed to send AI usage threshold notification', {
                        tags: { service: 'subscriptions' },
                        extra: { userId, type, threshold },
                    });
                }
                if (email.status === 'rejected') {
                    captureError(email.reason, 'Failed to send AI usage threshold email', {
                        tags: { service: 'subscriptions' },
                        extra: { userId, type, threshold },
                    });
                }
            }
        } catch (err) {
            captureError(err, 'Failed to dispatch AI usage threshold notification', {
                tags: { service: 'subscriptions' },
                extra: { userId },
            });
        }
    },

    /**
     * Read the user's current top-up balance. Returns 0 if user row is missing.
     */
    async getTopupBalance(userId: string): Promise<number> {
        const [row] = await db
            .select({ topupBalance: users.topupBalance })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        return row?.topupBalance ?? 0;
    },

    /**
     * Aggregate top-up summary for a user: current balance + lifetime purchased.
     * lifetimePurchased = sum of replies_added across all succeeded purchases.
     */
    async getTopupSummary(userId: string): Promise<{ balance: number; lifetimePurchased: number }> {
        const [balanceRow] = await db
            .select({ topupBalance: users.topupBalance })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        const [lifetimeRow] = await db
            .select({ total: sql<number>`COALESCE(SUM(${topupPurchases.repliesAdded}), 0)` })
            .from(topupPurchases)
            .where(and(eq(topupPurchases.userId, userId), eq(topupPurchases.status, 'succeeded')));

        return {
            balance: balanceRow?.topupBalance ?? 0,
            lifetimePurchased: Number(lifetimeRow?.total ?? 0),
        };
    },

    /**
     * Check if user can use AI replies.
     *
     * Allowance order:
     *   1. Active/trialing subscription AND plan quota has room → allow (plan).
     *   2. Else if top-up balance > 0 → allow with usingTopup: true. This branch
     *      covers past_due, canceled, and quota-exhausted users — they paid for
     *      these credits and the "never expires" promise must hold.
     *   3. Else → deny, surfacing the more specific reason (status block over
     *      quota exhaustion when both apply) — UNLESS the caller is the shared
     *      demo fixture, which is exempted on this deny path (see isDemoUser).
     */
    async canUseAiReplies(userId: string): Promise<LimitCheckResult> {
        const subscription = await this.getUserSubscription(userId);

        // No subscription row: might still have top-up balance carried over from
        // a previously canceled paid plan. Honor it; otherwise deny.
        if (!subscription) {
            const topupBalance = await this.getTopupBalance(userId);
            if (topupBalance > 0) {
                return { allowed: true, usingTopup: true, topupBalance };
            }
            if (await this.isDemoUser(userId)) return { allowed: true };
            return { allowed: false, reason: 'No active subscription' };
        }

        const plan = subscription.plan;
        const statusCheck = this.checkSubscriptionStatus(subscription);

        // Unlimited plan + active status: short-circuit, top-up irrelevant.
        if (statusCheck.allowed && plan.maxAiRepliesPerMonth === null) {
            return { allowed: true };
        }

        // Active subscription with finite quota — try plan first.
        if (statusCheck.allowed && plan.maxAiRepliesPerMonth !== null) {
            const currentUsage = await this.getCurrentUsage(userId);
            const used = currentUsage?.aiRepliesCount || 0;
            const limit = plan.maxAiRepliesPerMonth;

            if (used < limit) {
                return { allowed: true, limit, used, remaining: limit - used };
            }

            // Plan quota exhausted → fall through to top-up check below.
        }

        // Either subscription is not in active state, or plan quota is exhausted.
        // Top-up balance honors the purchase regardless of subscription state.
        const topupBalance = await this.getTopupBalance(userId);
        if (topupBalance > 0) {
            return { allowed: true, usingTopup: true, topupBalance };
        }

        // Demo accounts are shared, permanently-seeded fixtures with no real
        // billing — their seeded trial expires like any signup's and nothing
        // renews it, which silently AI-killed every live demo from 2026-08-17.
        // Exempt them HERE, at the single choke point, so every caller agrees
        // (test-reply, the reply generator, /limits/ai) instead of each carrying
        // its own copy of the check. Placed on the would-deny path only, so a
        // real reply within quota never pays the extra user read (Rule 17).
        if (await this.isDemoUser(userId)) return { allowed: true };

        // Nothing left. Return the specific denial:
        // status block (canceled/paused/past_due past grace) takes priority
        // over quota exhaustion since status is the more fundamental block.
        if (!statusCheck.allowed) return statusCheck;

        // Otherwise the denial is quota exhaustion. Recompute the same fields
        // the old code returned so existing callers keep working.
        const currentUsage = await this.getCurrentUsage(userId);
        const used = currentUsage?.aiRepliesCount || 0;
        const limit = plan.maxAiRepliesPerMonth as number;
        const resetsAtSource = currentUsage?.periodEnd ?? subscription.currentPeriodEnd;
        return {
            allowed: false,
            reason: 'Monthly AI reply limit reached',
            code: 'ai_limit_reached',
            limit,
            used,
            remaining: 0,
            resetsAt: resetsAtSource
                ? new Date(resetsAtSource).toISOString()
                : undefined,
        };
    },

    /**
     * Is this the shared demo fixture? Demo entities carry a `demo_` platform-id
     * prefix (`isDemoFacebookId`); real Meta ids are numeric, so no collision.
     * The seeded demo signs up on the ordinary path with a normal trial that
     * expires and never renews, so the billing gate would refuse it like any
     * expired trial — which is exactly the bug this exempts (canUseAiReplies
     * calls it on the would-deny path only). Queries the users row directly (not
     * via authService) to avoid the auth → subscriptions import cycle, reads one
     * column, and only when demo mode is enabled at all.
     */
    async isDemoUser(userId: string): Promise<boolean> {
        if (!config.demo.enabled) return false;
        const [row] = await db
            .select({ facebookId: users.facebookId })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        return isDemoFacebookId(row?.facebookId);
    },

    /**
     * The entitlement verdict a USER-FACING surface should show for a subscription
     * owner: `checkSubscriptionStatus`, plus the shared-demo exemption the reply
     * gates already apply (canUseAiReplies / canAutoReply).
     *
     * Exists because that exemption lived only inside those two gates. The usage
     * summary the dashboard banner reads called `checkSubscriptionStatus` directly,
     * so from 2026-08-17 the demo workspace answered `allowed: true` on /limits/ai
     * and `allowed: false, cause: 'trial_expired'` on /usage — one account, two
     * verdicts, and a red "trial ended, renew on the website" card in front of
     * every App Store reviewer who tapped Try Demo (seen on a physical iPhone,
     * 2026-09-05). Any surface that SHOWS the verdict reads it from here so it
     * cannot disagree with the gate that ENFORCES it.
     *
     * Demo is consulted on the deny path only, matching the two existing sites:
     * a healthy row never pays the extra users read (Rule 17).
     */
    async resolveEntitlement(ownerId: string, subscription: SubscriptionStatusInput): Promise<LimitCheckResult> {
        const verdict = this.checkSubscriptionStatus(subscription);
        if (verdict.allowed) return verdict;
        return (await this.isDemoUser(ownerId)) ? { allowed: true } : verdict;
    },

    /**
     * Check if user can add more pages
     */
    async canAddPage(userId: string, workspaceId: string): Promise<LimitCheckResult> {
        const subscription = await this.getUserSubscription(userId);

        if (!subscription) {
            return { allowed: false, reason: 'No active subscription', code: 'subscription_inactive' };
        }

        // Check subscription status (canceled/paused/expired)
        const statusCheck = this.checkSubscriptionStatus(subscription);
        if (!statusCheck.allowed) return statusCheck;

        const plan = subscription.plan;

        // Check if pages limit is unlimited (null)
        if (plan.maxPages === null) {
            return { allowed: true };
        }

        // Count current pages in workspace
        const [result] = await db
            .select({ count: pages.id })
            .from(pages)
            .where(eq(pages.workspaceId, workspaceId));

        const used = Number(result?.count) || 0;
        const limit = plan.maxPages;

        if (used >= limit) {
            return {
                allowed: false,
                reason: 'Page limit reached. Upgrade to add more pages.',
                code: 'page_limit_reached',
                limit,
                used,
                remaining: 0,
            };
        }

        return {
            allowed: true,
            limit,
            used,
            remaining: limit - used,
        };
    },

    /**
     * Count enabled page slots for a user.
     * 1 physical page = 1 slot (regardless of whether FB, IG, or both are enabled).
     */
    async countEnabledPageSlots(workspaceId: string): Promise<number> {
        const [result] = await db
            .select({ count: sql<number>`count(*)` })
            .from(pages)
            .where(and(
                eq(pages.workspaceId, workspaceId),
                or(eq(pages.autoReplyEnabled, true), eq(pages.instagramAutoReplyEnabled, true))
            ));

        return Number(result?.count) || 0;
    },

    /**
     * Customer messages and comments that arrived after `since` and were never
     * answered — what a billing block actually cost this workspace.
     *
     * The three inbound surfaces are counted together because the merchant
     * experiences one thing ("nobody answered my customers"), and a DM-only
     * number would understate a comment-heavy page by an order of magnitude —
     * the 2026-08-13 lesson that a predicate governing three tables must be
     * measured on three tables. Each leg is served by that table's
     * (workspace_id, created_at) index.
     *
     * Called ONLY when the gate refuses (getUsageSummary), so the healthy
     * dashboard path pays nothing for it. `replied = false` is the same column
     * the inbox's unanswered filters read, so the number the merchant is shown
     * is the number they can go and work.
     */
    async countUnansweredSince(workspaceId: string, since: Date): Promise<number> {
        const [dm, fb, ig] = await Promise.all([
            db.select({ count: sql<number>`count(*)` }).from(messages).where(and(
                eq(messages.workspaceId, workspaceId),
                eq(messages.direction, 'incoming'),
                eq(messages.replied, false),
                gte(messages.createdAt, since),
            )),
            db.select({ count: sql<number>`count(*)` }).from(comments).where(and(
                eq(comments.workspaceId, workspaceId),
                eq(comments.replied, false),
                gte(comments.createdAt, since),
            )),
            db.select({ count: sql<number>`count(*)` }).from(instagramComments).where(and(
                eq(instagramComments.workspaceId, workspaceId),
                eq(instagramComments.replied, false),
                gte(instagramComments.createdAt, since),
            )),
        ]);

        return Number(dm[0]?.count ?? 0) + Number(fb[0]?.count ?? 0) + Number(ig[0]?.count ?? 0);
    },

    /**
     * Check if user can enable another page.
     * 1 page = 1 slot (FB + IG on the same page share the slot).
     * Pass pageId to allow enabling the other platform on an already-active page.
     */
    async canEnablePage(userId: string, workspaceId: string, pageId?: string): Promise<LimitCheckResult> {
        const subscription = await this.getUserSubscription(userId);

        if (!subscription) {
            return { allowed: false, reason: 'No active subscription', code: 'subscription_inactive' };
        }

        // Check subscription status (canceled/paused/expired)
        const statusCheck = this.checkSubscriptionStatus(subscription);
        if (!statusCheck.allowed) return statusCheck;

        const plan = subscription.plan;

        // Check if pages limit is unlimited (null)
        if (plan.maxPages === null) {
            return { allowed: true };
        }

        const used = await this.countEnabledPageSlots(workspaceId);
        const limit = plan.maxPages;

        if (used >= limit) {
            // If the page already has a slot (FB or IG already enabled), allow enabling the other platform
            if (pageId) {
                const [existing] = await db
                    .select({ autoReplyEnabled: pages.autoReplyEnabled, instagramAutoReplyEnabled: pages.instagramAutoReplyEnabled })
                    .from(pages)
                    .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)));
                if (existing?.autoReplyEnabled || existing?.instagramAutoReplyEnabled) {
                    return { allowed: true, limit, used, remaining: 0 };
                }
            }

            return {
                allowed: false,
                reason: 'Enabled page limit reached. Disable another page or upgrade your plan.',
                code: 'page_limit_reached',
                limit,
                used,
                remaining: 0,
            };
        }

        return {
            allowed: true,
            limit,
            used,
            remaining: limit - used,
        };
    },

    /**
     * Does this user have a real billing relationship (i.e. NOT a free-trial-only
     * account)? Used by the channel-trial anti-abuse gate to decide whether a user
     * reconnecting a channel that already consumed its free trial may enable
     * auto-reply. Free-trial farmers — the abuse we block — have none of these
     * artifacts: signup creates status='trialing' with no Stripe ids and no
     * paymentMethod. A user with any prior paying/comp subscription is trusted.
     */
    async hasPaidSubscription(userId: string): Promise<boolean> {
        const rows = await db
            .select({
                status: subscriptions.status,
                externalSubscriptionId: subscriptions.externalSubscriptionId,
                stripeCustomerId: subscriptions.stripeCustomerId,
                paymentMethod: subscriptions.paymentMethod,
            })
            .from(subscriptions)
            .where(eq(subscriptions.userId, userId));
        return rows.some(isPayingCustomer);
    },

    /**
     * Get the max products allowed by the user's plan (null = unlimited).
     */
    async getMaxProducts(userId: string): Promise<number | null> {
        const subscription = await this.getUserSubscription(userId);
        if (!subscription) return 50; // default limit if no subscription
        return subscription.plan.maxProducts ?? null;
    },

    /**
     * Record an AI quota-consumption event in the legacy `usage_logs` table.
     *
     * NOT the cost source of truth — that's `ai_usage_log` written by
     * `services/aiUsageLog.ts#logAiUsage`. This event powers per-month quota
     * enforcement (`maxAiRepliesPerMonth`) and old-style audit trails. Two
     * separate tables, two separate purposes; the previous name `logAiUsage`
     * collided with the cost logger and caused confusion.
     */
    async logQuotaEvent(
        userId: string,
        pageId: string | undefined,
        tokensUsed: number | undefined,
        model: string
    ): Promise<void> {
        // Rough cost estimate kept on the legacy event for back-compat with
        // existing usage_logs consumers; authoritative cost lives in ai_usage_log.
        const estimatedCost = tokensUsed ? (tokensUsed / 1_000_000) * 0.80 : 0;

        await this.logUsageEvent(userId, 'ai_quota_consumed', {
            tokensUsed: tokensUsed || 0,
            model,
            estimatedCostUsd: Math.round(estimatedCost * 1_000_000) / 1_000_000,
        }, pageId);
    },

    /**
     * Log a usage event
     */
    async logUsageEvent(
        userId: string,
        eventType: string,
        metadata?: Record<string, unknown>,
        pageId?: string,
        platform?: string
    ): Promise<void> {
        await db.insert(usageLogs).values({
            userId,
            eventType,
            pageId,
            platform,
            metadata: metadata || {},
        });
    },

    /**
     * Check whether any auto-reply (Post Reply, Smart Reply, away message)
     * should fire for this user. Returns `allowed: false` when the
     * subscription is canceled, paused, or past_due beyond the 3-day grace window.
     *
     * Users without a subscription row are allowed (covers the
     * pre-subscribe onboarding window where a workspace exists but no
     * subscription has been created yet). Explicit inactive statuses block.
     *
     * This is the single gate called by comment/message webhook processors
     * before any reply path runs. It keeps all paid reply paths — including
     * deterministic ones like Post Replies — behind an active subscription.
     */
    async canAutoReply(userId: string): Promise<LimitCheckResult> {
        const subscription = await this.getUserSubscription(userId);
        if (!subscription) {
            // No subscription row = pre-signup / freshly onboarded. Allow.
            return { allowed: true };
        }
        return this.checkSubscriptionStatus(subscription);
    },

    /**
     * Gate an auto-reply and dispatch a one-per-24h notification when blocked.
     * Returns the `LimitCheckResult` so the caller can skip its reply path.
     * Dedup via Redis SET NX keeps the notification from re-firing on every
     * blocked webhook (potentially hundreds per day).
     */
    async enforceAutoReplyGate(userId: string): Promise<LimitCheckResult> {
        const check = await this.canAutoReply(userId);
        if (check.allowed) return check;

        try {
            const dedupKey = `notif:auto_reply_paused:${userId}`;
            const TTL_SECONDS = 24 * 60 * 60;
            const set = await redis.set(dedupKey, '1', 'EX', TTL_SECONDS, 'NX');
            if (set === 'OK') {
                // No variables: the template deliberately has no {reason}
                // placeholder (check.reason is an internal English string that
                // used to leak into the Arabic body). deepLink makes the card
                // actionable — without it the frontend renders a dead end.
                await notificationService.sendTemplateNotification(
                    userId,
                    'auto_reply_paused_billing',
                    {},
                    { deepLink: '/settings' },
                );
            }
        } catch (err) {
            captureError(err, 'Failed to dispatch auto-reply paused notification', {
                tags: { service: 'subscriptions' },
                extra: { userId },
            });
        }

        return check;
    },

    /**
     * Check subscription status (canceled/paused/expired trial/past_due beyond grace)
     * Reusable across all limit-check methods.
     */
    checkSubscriptionStatus(subscription: SubscriptionStatusInput): LimitCheckResult {
        if (subscription.status === 'canceled' || subscription.status === 'paused') {
            return { allowed: false, reason: `Subscription is ${subscription.status}`, code: 'subscription_inactive' };
        }

        // Manual (cash/transfer) subscriptions expire when their quota window closes.
        //
        // Stripe drives its own expiry: a failed renewal arrives as a webhook that
        // flips the status to past_due/canceled, which the checks around this one
        // catch. A manual subscription has no such signal — nothing ever moves it
        // off 'active'. Without this check it stays entitled forever, and because
        // getCurrentUsage only matches a usage row while `periodStart <= now <=
        // periodEnd`, the closed window silently reads as `used = 0` again —
        // handing the merchant a fresh monthly allowance they never paid for.
        //
        // We compare against startOfUtcDay(currentPeriodEnd), NOT the raw instant:
        // initializeUsagePeriod snaps the usage window's end to UTC midnight, so
        // the window closes up to ~24h before the subscription's exact end instant.
        // Using the same snapped boundary keeps entitlement and quota-counting on
        // ONE clock — otherwise the midnight→instant sliver is exactly where the
        // free-refill bug lives (window closed, but subscription not "expired" yet).
        // Admin reopens the window (and the quota) via manualUpgrade once the
        // cash/transfer lands.
        if (isOfflinePaymentMethod(subscription.paymentMethod) && subscription.currentPeriodEnd) {
            // resolveEntitlementEnd applies the snap; display surfaces call the
            // same helper so the date a merchant reads is the date enforced here.
            const entitlementEnd = resolveEntitlementEnd(subscription);
            if (entitlementEnd && entitlementEnd < new Date()) {
                return {
                    allowed: false,
                    reason: 'Subscription expired. Please renew to continue.',
                    code: 'subscription_inactive',
                };
            }
        }

        // A trial-origin subscription (organic signup — no payment method on file)
        // is entitled strictly until trial_ends_at. It must NOT inherit the
        // past_due grace window below: that grace covers an external processor's
        // payment-retry cycle (declined card, bank flag), and a trial has no
        // payment to retry. Matched on the raw status pair, not just 'trialing',
        // because getUserSubscription lazily flips an expired trial to 'past_due'
        // — the flip used to hand every expiring trial ~4 extra days of free
        // service (trial_ends_at → current_period_end ≈ 1 day, + 3 days grace);
        // one merchant sent 760 free AI replies through that window (2026-08-04).
        if (
            !subscription.paymentMethod &&
            subscription.trialEndsAt &&
            (subscription.status === 'trialing' || subscription.status === 'past_due') &&
            new Date(subscription.trialEndsAt) < new Date()
        ) {
            return { allowed: false, reason: 'Trial has expired. Please upgrade to continue.', code: 'subscription_inactive', cause: 'trial_expired' };
        }

        if (subscription.status === 'past_due') {
            const periodEnd = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;

            if (periodEnd) {
                const gracePeriodEnd = new Date(periodEnd);
                gracePeriodEnd.setDate(gracePeriodEnd.getDate() + PAST_DUE_GRACE_DAYS);

                if (new Date() > gracePeriodEnd) {
                    return {
                        allowed: false,
                        reason: 'Subscription expired. Please renew to continue.',
                        code: 'subscription_inactive',
                    };
                }
            }
        }

        if (subscription.status === 'trialing' && subscription.trialEndsAt) {
            const trialEnd = new Date(subscription.trialEndsAt);
            if (trialEnd < new Date()) {
                return { allowed: false, reason: 'Trial has expired. Please upgrade to continue.', code: 'subscription_inactive', cause: 'trial_expired' };
            }
        }

        return { allowed: true };
    },

    /**
     * Map database result to Subscription type
     */
    mapToSubscription(row: typeof subscriptions.$inferSelect): Subscription {
        return {
            id: row.id,
            userId: row.userId,
            planId: row.planId,
            status: (row.status || 'active') as SubscriptionStatus,
            paymentMethod: row.paymentMethod,
            shopifyShopDomain: row.shopifyShopDomain,
            trialEndsAt: row.trialEndsAt,
            currentPeriodStart: row.currentPeriodStart || new Date(),
            currentPeriodEnd: row.currentPeriodEnd,
            canceledAt: row.canceledAt,
            cancelReason: row.cancelReason,
            createdAt: row.createdAt || new Date(),
        };
    },

    /**
     * Map database result to Usage type
     */
    mapToUsage(row: typeof usage.$inferSelect): Usage {
        return {
            id: row.id,
            userId: row.userId,
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            aiRepliesCount: row.aiRepliesCount || 0,
            totalCommentsProcessed: row.totalCommentsProcessed || 0,
            totalMessagesProcessed: row.totalMessagesProcessed || 0,
            dailyBreakdown: (row.dailyBreakdown as Record<string, { ai: number }>) || {},
        };
    },
};

