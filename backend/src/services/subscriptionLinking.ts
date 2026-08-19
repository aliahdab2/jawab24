import { db } from '../db';
import { subscriptions } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { LIVE_SUBSCRIPTION_STATUSES } from '../config/shopifyBilling';
import {
    PAID_STRIPE_STATUSES,
    isPaidStripeStatus,
    isCurrentPeriodPaidFor,
    mapStripeSubscriptionStatus,
} from '../config/stripeBilling';
import { stripeService, stripeRefId } from './stripe';
import { subscriptionsService } from './subscriptions';
import { handlePaymentRecovery } from './dunningNotices';
import { stripeTsToDate } from '../utils/stripeTime';
import { getSubscriptionPeriod, getExpandedLatestInvoice } from '../utils/stripeCompat';
import { captureError } from '../utils/sentryHelpers';
import type Stripe from 'stripe';

/**
 * Linking a paid Stripe subscription to its local row.
 *
 * WHY THIS EXISTS. `externalSubscriptionId` was only ever written by the
 * webhook handler for `checkout.session.completed` — an event Stripe fires only
 * for Checkout Sessions. Checkout moved to the embedded PaymentElement
 * (`create-subscription-intent` → `stripe.subscriptions.create`), which creates
 * no Session, so that event stopped firing and nothing linked the two sides.
 * Every downstream handler resolves our row `WHERE external_subscription_id =
 * …`, so they all matched zero rows: merchants were charged and never
 * activated, silently, because the handlers still returned success.
 *
 * Confirmed in production 2026-07-25 — a merchant paid $39 and stayed on his
 * signup trial; only 1 of 66 subscription rows was linked at all.
 *
 * Lives in a service (not the webhook controller) because the reconciliation
 * sweep below needs it too, and a cron must not import from a controller.
 */

/** The subset of pino we need — satisfied by `request.log` and the server log. */
export interface LinkLogger {
    info: (obj: Record<string, unknown>, msg: string) => void;
    warn: (obj: Record<string, unknown>, msg: string) => void;
}

/** Silent default for cron callers that pass no logger. NOT the `noopLogger`
 * in types/logger.ts — that interface has the opposite (msg, data) order. */
export const noopLinkLogger: LinkLogger = { info: () => {}, warn: () => {} };

/**
 * Sentinel status for a `latest_invoice` that IS present but arrived as a bare
 * id rather than an expanded object. It must not read as `null`, because `null`
 * means "this subscription has no invoice at all" — the fully-discounted
 * exemption in `isCurrentPeriodPaidFor`, which would wave an UNPAID period
 * through. Any non-`paid` string refuses, so an unreadable invoice fails
 * closed: entitlement is withheld rather than granted on a guess.
 */
const INVOICE_UNEXPANDED = 'unexpanded';

/**
 * The latest invoice's status, as `isCurrentPeriodPaidFor` wants it, keeping the
 * three cases distinct: no invoice (`null`), a readable status, or present but
 * unexpanded (refuses — see INVOICE_UNEXPANDED).
 */
function latestInvoiceStatusOf(subscription: Stripe.Subscription): string | null {
    const raw = (subscription as unknown as { latest_invoice?: unknown }).latest_invoice;
    if (!raw) return null;
    return getExpandedLatestInvoice(subscription)?.status ?? INVOICE_UNEXPANDED;
}

/**
 * Attach a Stripe subscription to the local row it belongs to, keyed on the
 * `metadata.userId` / `metadata.planId` that createSubscriptionIntent stamps.
 *
 * Gated on the Stripe subscription being PAID (`active`/`trialing`). A
 * `default_incomplete` subscription exists before the customer pays, and one
 * merchant retrying checkout can rack up several, so adopting on creation would
 * link whichever attempt fired last and mark an unpaid account active.
 *
 * Idempotent: re-running against an already-linked row rewrites the same values.
 */
export async function adoptStripeSubscription(
    stripeSubscription: Stripe.Subscription,
    log: LinkLogger
): Promise<boolean> {
    const { userId, planId } = stripeSubscription.metadata ?? {};
    const status = stripeSubscription.status;

    if (!isPaidStripeStatus(status)) {
        log.info(
            { subscriptionId: stripeSubscription.id, status },
            'Unlinked Stripe subscription is not paid yet — not adopting'
        );
        return false;
    }

    if (!userId || !planId) {
        log.warn(
            { subscriptionId: stripeSubscription.id, status },
            'Paid Stripe subscription has no userId/planId metadata — cannot adopt'
        );
        return false;
    }

    // `active` is not proof the current period was paid for. Stripe advances the
    // period when it CREATES the renewal invoice and only degrades the status
    // about an hour later if the charge fails — measured on the 2026-08-13
    // incident, where the period-advancing event carried status=active with an
    // open, amount_paid=0 invoice. This function writes both the period AND the
    // quota window, so adopting inside that hour would hand out an unpaid month.
    //
    // The ruling itself lives in config/stripeBilling.isCurrentPeriodPaidFor,
    // shared with the sweep's period healer below so the two writers of
    // paid-through cannot drift on what "paid for" means. What differs here is
    // only HOW the invoice is obtained, and deliberately so: this path ALWAYS
    // re-reads it from the API, because its callers are webhook handlers whose
    // payload is a snapshot that may predate the charge settling. Re-reading at
    // handling time is what makes that ordering race unlikely (the same
    // reasoning handlePaymentSucceeded states). The healer, by contrast, is fed
    // a list response it fetched moments ago and trusts that expansion.
    //
    // `trialing` never reaches for an invoice at all — it has none to pay.
    if (status === 'active') {
        const withInvoice = await stripeService.getSubscriptionWithLatestInvoice(stripeSubscription.id);
        const invoiceStatus = latestInvoiceStatusOf(withInvoice);
        if (!isCurrentPeriodPaidFor(status, invoiceStatus)) {
            log.info(
                { subscriptionId: stripeSubscription.id, status, invoiceStatus },
                'Active Stripe subscription whose latest invoice is unpaid — not adopting yet'
            );
            return false;
        }
    }

    // Take over the user's existing row rather than inserting a second one:
    // signup already created a local trial row, and leaving it behind would let
    // the subscription resolver keep serving the stale trial.
    const [current] = await db
        .select({
            id: subscriptions.id,
            paymentMethod: subscriptions.paymentMethod,
            status: subscriptions.status,
        })
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);

    // Mirror of the Shopify rail's D-H: never overwrite a LIVE shopify mirror
    // with a Stripe adoption — the AppSubscription GID would be lost and the
    // Shopify reconciler would refuse (and Sentry) every 6h while the merchant
    // is double-billed. A canceled/paused shopify row is fair game.
    if (
        current &&
        current.paymentMethod === 'shopify' &&
        (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(current.status ?? '')
    ) {
        captureError(
            new Error(`Stripe subscription ${stripeSubscription.id} collides with a live shopify-billed row for user ${userId}`),
            'Stripe adoption refused over a live Shopify mirror (D-H twin)',
            {
                level: 'warning',
                tags: { service: 'subscriptions', flow: 'adopt_refused' },
                fingerprint: ['stripe-adopt-refused-shopify-mirror'],
                extra: { subscriptionId: stripeSubscription.id, userId, localSubscriptionId: current.id },
            },
        );
        return false;
    }

    const period = getSubscriptionPeriod(stripeSubscription);
    const values = {
        userId,
        planId,
        status,
        externalSubscriptionId: stripeSubscription.id,
        paymentMethod: 'stripe' as const,
        stripeCustomerId: stripeRefId(stripeSubscription.customer),
        currentPeriodStart: stripeTsToDate(period.start),
        currentPeriodEnd: stripeTsToDate(period.end),
        trialEndsAt: stripeTsToDate(stripeSubscription.trial_end),
        updatedAt: new Date(),
    };

    if (current) {
        await db.update(subscriptions).set(values).where(eq(subscriptions.id, current.id));
    } else {
        await db.insert(subscriptions).values(values);
    }

    // Establish the quota window for the period just paid for. Without this an
    // adopted merchant keeps whatever usage row their SIGNUP TRIAL created —
    // wrong period boundaries and trial-era accounting for someone now paying.
    // handlePaymentSucceeded does this on its normal path; the adoption path
    // returns before reaching it, so it has to happen here to cover all four
    // callers (subscription.created / .updated / invoice.payment_succeeded /
    // the reconciliation sweep). Idempotent on replay.
    if (values.currentPeriodStart && values.currentPeriodEnd) {
        await subscriptionsService.initializeUsagePeriod(
            userId,
            values.currentPeriodStart,
            values.currentPeriodEnd,
        );
    } else {
        log.warn(
            { subscriptionId: stripeSubscription.id, userId },
            'Adopted subscription without valid period boundaries — quota window not initialized'
        );
    }

    await subscriptionsService.invalidateStatusCache(userId);
    log.info(
        { subscriptionId: stripeSubscription.id, userId, planId, status, adopted: current ? 'updated' : 'inserted' },
        'Adopted Stripe subscription onto the local row'
    );
    return true;
}

/** The local columns the period healer reads and decides against. */
export interface LinkedSubscriptionRow {
    id: string;
    userId: string;
    status: string | null;
    currentPeriodEnd: Date | null;
}

/** Why the healer did or did not move a linked row's paid-through boundary. */
export type PeriodHealOutcome =
    /** paid-through advanced to the period Stripe has been paid for */
    | 'advanced'
    /** Stripe's current period is not paid for — the boundary must not move */
    | 'unpaid'
    /** Stripe agrees with the row (or would move it backwards) — nothing written */
    | 'no_drift'
    /** Stripe returned no usable period boundaries */
    | 'no_period';

/**
 * Re-assert Stripe's PAID-FOR period onto an already-linked local row — the
 * healer for a missed `invoice.payment_succeeded`.
 *
 * ## Why this exists (the risk #817 introduced)
 *
 * `invoice.payment_succeeded` is the ONLY writer of `current_period_*`, because
 * it is the only event that proves money landed. That is correct, and it closed
 * a free-month leak — but it also made the webhook a single point of failure in
 * the opposite direction. One dropped delivery, one 5xx that exhausts Stripe's
 * retries, and a PAYING merchant's paid-through stays frozen; three days later
 * `checkSubscriptionStatus`'s grace expires and they are blocked, with their
 * customers' messages going unanswered. `LAZY_EXPIRY_CANARIES.stripe` reports
 * that in Sentry; nothing repaired it. The sweep below examined only UNLINKED
 * rows, so the merchants most exposed — the ones correctly linked and paying —
 * were the ones it skipped.
 *
 * The failure direction inverted with #817: the old bug gave away service, this
 * one withholds service from someone who paid. That is the worse of the two.
 *
 * ## What it may write, and what it must never write
 *
 * 1. **The discriminator is the invoice, never the status.** Shared with the
 *    adoption path via `isCurrentPeriodPaidFor`. A status gate would permit the
 *    very event that moves the boundary: Stripe advances the period when it
 *    CREATES the renewal invoice, while the subscription still reads `active`
 *    (2026-08-13, 19:41:52 → period 08-13 becomes 09-13; the status only
 *    degraded at 20:42:59). Measured live on 2026-08-19, this predicate refuses
 *    exactly the row it must: an unpaid `past_due` merchant whose Stripe item
 *    period reads a month ahead of what he has paid for.
 * 2. **Forward only.** The boundary may advance, never retract. A Stripe period
 *    that ends EARLIER than ours cannot be a repair — it is a stale read, a
 *    proration artifact or a bug — and retracting it would block a payer, the
 *    exact harm this function exists to prevent.
 * 3. **Silent when there is nothing to fix** (the `noDrift` posture
 *    `syncShopifyBilling` already takes). This runs every 15 minutes over every
 *    paying merchant; churning `updated_at` on all of them would destroy the
 *    only proxy we have for when a row last genuinely changed.
 * 4. **Status and period move TOGETHER, or not at all.** Never decoupled:
 *    `past_due` with a NULL period reads as ALLOWED FOREVER, because the grace
 *    check only applies when there is a period to apply it to. A revision of
 *    #817 shipped the decoupled version and was strictly worse than the defect
 *    it replaced.
 * 5. **The quota window is reopened only on a genuine advance** — via the same
 *    `initializeUsagePeriod` the webhook calls. Reopening it on a no-op would
 *    hand out a monthly allowance nobody paid for, which is how the original
 *    incident became immediate rather than merely theoretical.
 * 6. **The dunning episode is closed through `handlePaymentRecovery`.** Both
 *    dunning branches select on `isNull(…_notified_at)`, and that function is
 *    the only resetter — reached only from the webhook that went missing. A
 *    healed row with its stamps left set would be silenced for every FUTURE
 *    episode, which is the silent-suspension failure the dunning system was
 *    built to end. Its atomic reset-UPDATE IS the once-only claim, so racing a
 *    late webhook costs nothing, and both callers pass the same
 *    `payment_recovered:<invoiceId>` idempotency key. ⛔ This is NOT a licence
 *    to call it from `handleSubscriptionUpdated`: that handler fires on the
 *    period-ADVANCING event, before money lands, where the same call would
 *    close an episode that is still open and mail a false confirmation.
 */
export async function healStripeSubscriptionPeriod(
    stripeSubscription: Stripe.Subscription,
    local: LinkedSubscriptionRow,
    log: LinkLogger,
): Promise<PeriodHealOutcome> {
    const invoiceStatus = latestInvoiceStatusOf(stripeSubscription);
    if (!isCurrentPeriodPaidFor(stripeSubscription.status, invoiceStatus)) {
        return 'unpaid';
    }

    const period = getSubscriptionPeriod(stripeSubscription);
    const periodStart = stripeTsToDate(period.start);
    const periodEnd = stripeTsToDate(period.end);
    if (!periodStart || !periodEnd) {
        log.warn(
            { subscriptionId: stripeSubscription.id, localSubscriptionId: local.id },
            'Linked Stripe subscription reports no period boundaries — paid-through left as is'
        );
        return 'no_period';
    }

    // Forward only (rule 2). A NULL local boundary is not "later than Stripe" —
    // it is no boundary at all, and healing it is the point: `past_due` with a
    // NULL period is entitled forever.
    const localEnd = local.currentPeriodEnd ? new Date(local.currentPeriodEnd) : null;
    if (localEnd && periodEnd.getTime() <= localEnd.getTime()) {
        return 'no_drift';
    }

    // Only `active`/`trialing` reach here (the sweep lists nothing else and the
    // paid-for gate above refuses the rest), so this always writes — but read
    // the status through the same map as every other writer rather than
    // mirroring Stripe's raw value, which is how three of its eight statuses
    // used to land in a column that entitles anything it does not recognise.
    const mapping = mapStripeSubscriptionStatus(stripeSubscription.status);

    await db
        .update(subscriptions)
        .set({
            ...(mapping.write ? { status: mapping.status } : {}),
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, local.id));

    // The window for the period just proven paid for. Without it the merchant
    // is un-blocked but still counting against the PREVIOUS period's usage row.
    await subscriptionsService.initializeUsagePeriod(local.userId, periodStart, periodEnd);
    await subscriptionsService.invalidateStatusCache(local.userId);

    log.info(
        {
            subscriptionId: stripeSubscription.id,
            localSubscriptionId: local.id,
            userId: local.userId,
            previousStatus: local.status,
            status: mapping.write ? mapping.status : local.status,
            previousPeriodEnd: localEnd,
            currentPeriodEnd: periodEnd,
        },
        'Advanced paid-through period on a linked Stripe subscription — its renewal webhook was missed'
    );

    // Close the dunning episode (rule 6). Never throws.
    await handlePaymentRecovery(
        stripeSubscription.id,
        getExpandedLatestInvoice(stripeSubscription)?.id,
        periodEnd,
    );

    return 'advanced';
}

export interface SubscriptionSweepResult {
    /** paid Stripe subscriptions examined this sweep */
    scanned: number;
    /** rows adopted because nothing local pointed at them */
    healed: number;
    /**
     * linked rows whose paid-through boundary was advanced to the period Stripe
     * has been paid for — each one is a `invoice.payment_succeeded` that never
     * arrived, and a merchant who would otherwise have been blocked.
     */
    periodsHealed: number;
    /** already linked and in agreement with Stripe — the happy path */
    alreadyLinked: number;
    /** paid in Stripe but un-adoptable (no metadata) — needs a human */
    orphaned: number;
    /** per-subscription failures, isolated so one bad row can't stall the sweep */
    errors: number;
}

/**
 * Self-heal merchants Stripe says are paying but whose local row disagrees.
 *
 * The webhook path is a single point of failure: one dropped delivery, one 500,
 * one Stripe outage and a merchant is charged for nothing — the exact failure
 * this module exists for, and one that was silent for weeks. Stripe is the
 * authority on who is paying, so ask it directly and reconcile.
 *
 * TWO repairs, because a missed webhook strands a merchant in two ways:
 *   - **unlinked** → nothing local points at the Stripe subscription, so every
 *     handler matches zero rows (`adoptStripeSubscription`).
 *   - **linked but frozen** → the row exists and the renewal payment landed, but
 *     the event that carries paid-through never arrived, so the grace expires
 *     and a payer is blocked (`healStripeSubscriptionPeriod`).
 *
 * Idempotent and safe to run beside the live webhook: adoption rewrites the same
 * values, and the healer writes nothing unless Stripe's PAID-FOR period is
 * strictly ahead of the row's.
 */
export async function reconcileStripeSubscriptions(options?: {
    limit?: number;
    log?: LinkLogger;
}): Promise<SubscriptionSweepResult> {
    const limit = options?.limit ?? 100;
    const log = options?.log ?? noopLinkLogger;

    const result: SubscriptionSweepResult = {
        scanned: 0, healed: 0, periodsHealed: 0, alreadyLinked: 0, orphaned: 0, errors: 0,
    };

    // Both paid states. A trialing Stripe subscription is a real commitment
    // (card on file) and must be reflected locally just like an active one.
    // Sourced from config/stripeBilling so the sweep and the adoption guard
    // above can never disagree about which statuses count as paid.
    for (const status of PAID_STRIPE_STATUSES) {
        const paid = await stripeService.listSubscriptions({ status, limit });

        // Never let a bounded sweep look like a complete one. If the cap is hit,
        // subscriptions beyond it are NOT examined this round and a merchant
        // sitting past the boundary would never be healed — silently, which is
        // the exact failure shape this module exists to end.
        if (paid.length >= limit) {
            log.warn(
                { status, limit },
                'Subscription reconciliation hit its page cap — subscriptions beyond it were not examined'
            );
        }

        for (const sub of paid) {
            result.scanned++;
            try {
                const [linked] = await db
                    .select({
                        id: subscriptions.id,
                        userId: subscriptions.userId,
                        status: subscriptions.status,
                        currentPeriodEnd: subscriptions.currentPeriodEnd,
                    })
                    .from(subscriptions)
                    .where(eq(subscriptions.externalSubscriptionId, sub.id))
                    .limit(1);

                // A linked row is NOT automatically a healthy one. Since #817
                // only `invoice.payment_succeeded` writes paid-through, so a
                // missed delivery freezes the boundary and the 3-day grace then
                // blocks a merchant who paid. This used to `continue` here,
                // which meant the sweep repaired everyone EXCEPT the paying,
                // correctly-linked merchants. See healStripeSubscriptionPeriod.
                if (linked) {
                    const outcome = await healStripeSubscriptionPeriod(sub, linked, log);
                    if (outcome === 'advanced') result.periodsHealed++;
                    else result.alreadyLinked++;
                    continue;
                }

                if (await adoptStripeSubscription(sub, log)) {
                    result.healed++;
                } else {
                    result.orphaned++;
                }
            } catch (err) {
                result.errors++;
                log.warn(
                    { subscriptionId: sub.id, err: err instanceof Error ? err.message : String(err) },
                    'Subscription reconciliation failed for one subscription'
                );
            }
        }
    }

    // A merchant Stripe says is PAID that we cannot adopt is the worst state in
    // this module: money taken, account not activated, and no code path will
    // ever fix it on its own. The cron scaffold only alerts on `healed`, so
    // raise this here or it stays buried in a log line nobody reads — the same
    // silence that let the original bug run for weeks.
    if (result.orphaned > 0) {
        captureError(
            new Error(`${result.orphaned} paid Stripe subscription(s) could not be linked to a user`),
            'Subscription reconciliation found orphaned paid subscriptions',
            { level: 'warning', tags: { cron: 'subscription_reconcile' }, extra: { ...result } },
        );
    }

    return result;
}
