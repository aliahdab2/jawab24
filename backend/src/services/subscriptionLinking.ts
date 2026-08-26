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
import { noopLinkLogger, type LinkLogger } from '../types/linkLogger';
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

    // Mirror of every marketplace rail's D-H: never overwrite a LIVE marketplace
    // mirror with a Stripe adoption — the external id would be lost and that
    // rail's reconciler would refuse (and Sentry) every 6h while the merchant is
    // double-billed. A canceled/paused mirror is fair game.
    //
    // `zid` and `salla` are listed for the same reason `shopify` is, and their
    // absence was a live gap: the six merchant-facing Stripe entry points refuse
    // a marketplace-billed account, but `admin/billing.ts:createPaymentRequest`
    // consults neither rule, so a Stripe subscription CAN reach one of these
    // merchants. Worse than Shopify's case: the adopt would leave the row's
    // `zid_store_id`/`salla_store_id` set while flipping payment_method to
    // 'stripe', which drops it out of that rail's WHERE triple entirely — the
    // sweep can then neither pause nor heal it, and the mirror is unrecoverable
    // without a human.
    const MARKETPLACE_MIRROR_METHODS = ['shopify', 'zid', 'salla'] as const;
    if (
        current &&
        (MARKETPLACE_MIRROR_METHODS as readonly string[]).includes(current.paymentMethod ?? '') &&
        (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(current.status ?? '')
    ) {
        captureError(
            new Error(`Stripe subscription ${stripeSubscription.id} collides with a live ${current.paymentMethod}-billed row for user ${userId}`),
            `Stripe adoption refused over a live ${current.paymentMethod} mirror (D-H twin)`,
            {
                level: 'warning',
                tags: { service: 'subscriptions', flow: 'adopt_refused' },
                // Per-rail so an alert names which marketplace collided; the
                // shopify string is unchanged, keeping its alert history.
                fingerprint: [`stripe-adopt-refused-${current.paymentMethod}-mirror`],
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
    paymentMethod: string | null;
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
    | 'no_period'
    /** a paid status our map does not answer for — refused, never written half */
    | 'unmapped_status'
    /** the matched row is billed by another rail — refused, and reported */
    | 'foreign_rail';

/**
 * Outcomes that mean "Stripe says this merchant is paying and we could NOT
 * reflect it" — the sweep is the authority of last resort, so each of these is a
 * merchant who may sit blocked with nobody looking. They are counted apart from
 * agreement and reported to Sentry in aggregate, the same posture `orphaned`
 * already has, because per-row `log.warn` does not reach Sentry.
 *
 * `unpaid` is deliberately NOT here: a linked row Stripe has not been paid for
 * is the normal state of a merchant mid-dunning, and services/dunningNotices.ts
 * owns telling them. Refusing it is the correct outcome, not a failure.
 */
const UNHEALABLE_OUTCOMES: ReadonlySet<PeriodHealOutcome> = new Set([
    'no_period', 'unmapped_status', 'foreign_rail',
]);

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
    // Row targeting, the same invariant `updateLiveMirrorsForShop` holds on the
    // Shopify side: this function is reached by matching a STRIPE subscription id,
    // so the row it found must be stripe-billed. A manual/bank row that kept an
    // old Stripe id (payment_method flipped, external_subscription_id not
    // cleared) would otherwise have its period advanced — and possibly its plan
    // contradicted — by a Stripe subscription that no longer governs it. Zero
    // such rows exist in production today (measured 2026-08-19: every non-stripe
    // row has a NULL external id); refusing makes it impossible rather than
    // merely unlikely, and an id collision we cannot explain must be seen.
    if (local.paymentMethod !== 'stripe') {
        captureError(
            new Error(`Stripe subscription ${stripeSubscription.id} matched a ${local.paymentMethod ?? 'null'}-billed row`),
            'Period healer refused a row billed by another rail',
            {
                level: 'warning',
                tags: { service: 'subscriptions', flow: 'period_heal_refused' },
                fingerprint: ['stripe-period-heal-foreign-rail'],
                extra: {
                    subscriptionId: stripeSubscription.id,
                    localSubscriptionId: local.id,
                    localPaymentMethod: local.paymentMethod,
                },
            },
        );
        return 'foreign_rail';
    }

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

    // Read the status through the same map as every other writer rather than
    // mirroring Stripe's raw value, which is how three of its eight statuses
    // used to land in a column that entitles anything it does not recognise.
    //
    // Only `active`/`trialing` reach here (the sweep lists nothing else and the
    // paid-for gate above refuses the rest), so in practice this always writes.
    // If that ever stops being true, REFUSE rather than write half a repair:
    // rule 4 above is that the status and the period move together, and a period
    // advanced without its status is the decoupled shape that made an earlier
    // revision of #817 strictly worse than the defect it replaced.
    const mapping = mapStripeSubscriptionStatus(stripeSubscription.status);
    if (!mapping.write) {
        log.warn(
            { subscriptionId: stripeSubscription.id, localSubscriptionId: local.id, stripeStatus: stripeSubscription.status },
            'Paid Stripe status has no mapping — refusing to advance a period without its status'
        );
        return 'unmapped_status';
    }

    const trialEndsAt = stripeTsToDate(stripeSubscription.trial_end);

    // ORDER MATTERS, and it is the reverse of handlePaymentSucceeded's.
    //
    // The paid-through write is what makes this row look repaired, and it is
    // also this function's own idempotence key: once the boundary has advanced,
    // the next sweep reads `no_drift` and does nothing more. So anything that
    // must accompany the repair has to happen BEFORE it — otherwise a throw in
    // between leaves a row that is un-blocked but still counted against the
    // previous period's usage, and NO later sweep will finish the job. This
    // sweep is the last resort; it cannot afford a half-repair that looks
    // complete. `handlePaymentSucceeded` can afford the opposite order precisely
    // because it is NOT the last resort: it throws, the webhook returns 5xx, and
    // Stripe redelivers the whole handler. Do not "fix" the inconsistency by
    // making this one match it — there is no redelivery here.
    //
    // Opening the quota window first is safe in the other direction: the window
    // does not entitle anything on its own (the gate reads status and period),
    // incrementAiReplies creates one lazily anyway, and initializeUsagePeriod is
    // idempotent on replay. A window opened for a period whose boundary then
    // failed to land is inert, and the next sweep retries the whole repair.
    await subscriptionsService.initializeUsagePeriod(local.userId, periodStart, periodEnd);

    await db
        .update(subscriptions)
        .set({
            status: mapping.status,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            // `trial_ends_at` is mirrored for the same reason handleSubscription
            // Updated mirrors it, and omitting it made this whole repair a
            // half-repair for `trialing` rows. It is NOT a paid-through claim —
            // it is Stripe's statement of when the trial stops — and it is what
            // actually gates a trialing row: checkSubscriptionStatus blocks
            // `status='trialing'` the moment `trial_ends_at` passes, whatever the
            // period says. So healing the period while leaving a stale
            // trial_ends_at behind reports success, counts a periodsHealed,
            // reopens the quota window, closes the dunning episode and can mail
            // "payment recovered" — to a merchant who is STILL BLOCKED at the
            // read path. Live-reachable, not theoretical: plan `starter` is
            // active with trial_days=30 and createSubscriptionIntent passes it as
            // `trial_period_days`, so Stripe-managed trialing subscriptions are
            // created today (0 such rows in prod as of 2026-08-19; the next
            // starter checkout through Stripe makes one).
            trialEndsAt,
            updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, local.id));

    await subscriptionsService.invalidateStatusCache(local.userId);

    log.info(
        {
            subscriptionId: stripeSubscription.id,
            localSubscriptionId: local.id,
            userId: local.userId,
            previousStatus: local.status,
            status: mapping.status,
            previousPeriodEnd: localEnd,
            currentPeriodEnd: periodEnd,
            trialEndsAt,
        },
        'Advanced paid-through period on a linked Stripe subscription — its renewal webhook was missed'
    );

    // Close the dunning episode (rule 6) — LAST, and deliberately after the
    // boundary write, unlike the two steps above. It is the only step with an
    // outward-facing effect: closing an episode mails "payment recovered". Run
    // before the write, a failed write would leave that mail sent to a merchant
    // who is still blocked. It never throws, so it cannot break the chain.
    //
    // The invoice id becomes the Resend `payment_recovered:<id>` idempotency key,
    // shared with handlePaymentSucceeded so a late webhook cannot double-send.
    // It is `undefined` only when the subscription has no invoice at all
    // (trialing / fully discounted) — and in exactly that case no
    // `invoice.payment_succeeded` exists to race with, so there is nothing for a
    // key to guard. Two concurrent SWEEPS are still covered: the atomic
    // reset-UPDATE inside handlePaymentRecovery is the once-only claim, so only
    // one of them composes an email.
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
    /**
     * already linked and in agreement with Stripe — the happy path, and ONLY
     * that. Every refusal gets its own counter below: folding them in here made
     * one number mean four different things, so an operator reading
     * `alreadyLinked: 12` could not tell agreement from four kinds of failure.
     */
    alreadyLinked: number;
    /**
     * linked rows whose current period Stripe has NOT been paid for. The normal
     * state of a merchant mid-dunning (Nourva, 2026-08-13) — a correct refusal,
     * not a failure, and services/dunningNotices.ts owns telling them.
     */
    periodUnpaid: number;
    /**
     * linked rows Stripe says are PAYING that we could not reflect — no period
     * boundaries, an unmapped status, or a row billed by another rail. Each is a
     * merchant who may sit blocked with nobody looking, so this count raises
     * Sentry (see UNHEALABLE_OUTCOMES).
     */
    periodUnhealable: number;
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
        scanned: 0, healed: 0, periodsHealed: 0, alreadyLinked: 0,
        periodUnpaid: 0, periodUnhealable: 0, orphaned: 0, errors: 0,
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
                        paymentMethod: subscriptions.paymentMethod,
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
                    else if (outcome === 'unpaid') result.periodUnpaid++;
                    else if (UNHEALABLE_OUTCOMES.has(outcome)) result.periodUnhealable++;
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

    // The linked twin of the orphan alert above, and it exists for the same
    // reason: Stripe says these merchants are paying, we could not reflect it,
    // and the per-row `log.warn` inside the healer does NOT reach Sentry. Left
    // to the log alone, a paying merchant sits blocked until someone reads it —
    // which is the silence this whole module exists to end. The cron scaffold
    // only alerts on recovered WORK (healed + periodsHealed), so a sweep that
    // healed nothing because it COULD heal nothing looks identical to a quiet,
    // healthy one.
    if (result.periodUnhealable > 0) {
        captureError(
            new Error(`${result.periodUnhealable} paying Stripe subscription(s) could not have their period reflected`),
            'Subscription reconciliation could not heal a paid period',
            {
                level: 'warning',
                tags: { cron: 'subscription_reconcile' },
                fingerprint: ['stripe-period-unhealable'],
                extra: { ...result },
            },
        );
    }

    return result;
}
