import { db } from '../db';
import { subscriptions } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { LIVE_SUBSCRIPTION_STATUSES } from '../config/shopifyBilling';
import { PAID_STRIPE_STATUSES, isPaidStripeStatus } from '../config/stripeBilling';
import { stripeService, stripeRefId } from './stripe';
import { subscriptionsService } from './subscriptions';
import { stripeTsToDate } from '../utils/stripeTime';
import { getSubscriptionPeriod } from '../utils/stripeCompat';
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

export interface SubscriptionSweepResult {
    /** paid Stripe subscriptions examined this sweep */
    scanned: number;
    /** rows adopted because nothing local pointed at them */
    healed: number;
    /** already linked — the happy path, nothing to do */
    alreadyLinked: number;
    /** paid in Stripe but un-adoptable (no metadata) — needs a human */
    orphaned: number;
    /** per-subscription failures, isolated so one bad row can't stall the sweep */
    errors: number;
}

/**
 * Self-heal merchants who paid in Stripe but were never activated here.
 *
 * The webhook path is a single point of failure: one dropped delivery, one 500,
 * one Stripe outage and a merchant is charged for nothing — the exact failure
 * this module exists for, and one that was silent for weeks. Stripe is the
 * authority on who is paying, so ask it directly and reconcile.
 *
 * Idempotent and safe to run beside the live webhook: already-linked
 * subscriptions are skipped, and adoption rewrites the same values anyway.
 */
export async function reconcileStripeSubscriptions(options?: {
    limit?: number;
    log?: LinkLogger;
}): Promise<SubscriptionSweepResult> {
    const limit = options?.limit ?? 100;
    const log = options?.log ?? noopLinkLogger;

    const result: SubscriptionSweepResult = {
        scanned: 0, healed: 0, alreadyLinked: 0, orphaned: 0, errors: 0,
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
                    .select({ id: subscriptions.id })
                    .from(subscriptions)
                    .where(eq(subscriptions.externalSubscriptionId, sub.id))
                    .limit(1);

                if (linked) {
                    result.alreadyLinked++;
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
