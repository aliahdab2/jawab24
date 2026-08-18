import type Stripe from 'stripe';
import type { SubscriptionStatus } from '@jawab24/shared';

/**
 * Stripe subscription-status vocabulary: how Stripe's status enum translates
 * into OUR five-value `SubscriptionStatus`, and which statuses are allowed to
 * advance the local billing period.
 *
 * Same role as `LIVE_SUBSCRIPTION_STATUSES` in config/shopifyBilling.ts — one
 * home for a rail's status ruling, so a change is a one-site edit (Rule 10.8).
 *
 * ## Why this exists (Nourva, 2026-08-13 → 08-18)
 *
 * The webhook handlers used to mirror Stripe's payload verbatim:
 *
 *   status: stripeSubscription.status          // raw
 *   currentPeriodStart/End: <always mirrored>  // paid or not
 *
 * Both halves leak free service, and they compound:
 *
 * 1. **Raw status.** `SubscriptionStatus` has five values; Stripe has eight.
 *    `unpaid`, `incomplete` and `incomplete_expired` are none of them, and
 *    `checkSubscriptionStatus` blocks only `canceled`/`paused` (grace-handling
 *    `past_due`). An unmapped status therefore falls through to `allowed: true`
 *    — permanently. There is no CHECK constraint on `subscriptions.status`, so
 *    nothing stopped the raw value from landing. Stripe's own documentation is
 *    explicit about `unpaid`: *"Revoke access to your product when the
 *    subscription is unpaid because payments were already attempted and retried
 *    while past_due."*
 *
 * 2. **Unconditional period mirror.** A `past_due` subscription "continues to
 *    create invoices" (Stripe docs), so Stripe advances `current_period_*` into
 *    a period the merchant has NOT paid for. Mirroring that hands out a free
 *    month of entitlement — plus, because `getCurrentUsage` matches a usage row
 *    only while `periodStart <= now <= periodEnd`, a fresh monthly quota. The
 *    merchant this was found on caps his 10,000-reply plan every month; the
 *    failed renewal handed him a brand-new 10,000.
 *
 * The two are one bug: our `current_period_end` must mean **paid through**,
 * because that is what the entitlement gate, the 3-day grace window and the
 * dunning emails all read it as. Stripe's `current_period_end` means "the
 * period being invoiced", paid or not. Only a paid status may carry it over.
 *
 * Recovery is unaffected: `handlePaymentSucceeded` re-reads the subscription
 * from Stripe, mirrors the then-current period and resets the usage window, so
 * a late payment heals the row without manual intervention.
 */

/**
 * Stripe statuses under which the current period is PAID FOR, and may therefore
 * advance our `current_period_*`.
 *
 * `trialing` belongs here: a Stripe-managed trial is a card-on-file commitment
 * whose period is legitimately entitled (same reading as `isPayingCustomer` in
 * services/subscriptions.ts). Every other status means the latest invoice is
 * unpaid, was never attempted, or the subscription is over — none of which may
 * move the paid-through boundary.
 *
 * Deliberately NOT the same set as `LIVE_SUBSCRIPTION_STATUSES`
 * (`active | trialing | past_due`): that one answers "is this row currently
 * entitling somebody" (a `past_due` row inside its grace still is). This one
 * answers "has this period been paid for" — where `past_due` is exactly the
 * case that has not.
 */
export const PAID_STRIPE_STATUSES = ['active', 'trialing'] as const;

/** A Stripe status under which the current period is paid for. */
export type PaidStripeStatus = (typeof PAID_STRIPE_STATUSES)[number];

/**
 * May a payload carrying this Stripe status advance our billing period?
 * Anything not explicitly paid is refused — an unrecognised future status is
 * treated as unpaid, which withholds entitlement rather than granting it.
 *
 * Declared as a type predicate so callers that need the narrowed literal (e.g.
 * `subscriptionLinking.adoptStripeSubscription`, which writes the status
 * straight into our column) get it from this one guard instead of re-listing
 * the pair inline — which is what they used to do.
 */
export function isPaidStripeStatus(status: string): status is PaidStripeStatus {
    return (PAID_STRIPE_STATUSES as readonly string[]).includes(status);
}

/**
 * The outcome of translating a Stripe status. `write: false` is a deliberate
 * "leave the existing status alone" — not an error to swallow:
 *
 *  - `pre_activation` (`incomplete`): Stripe's first-invoice state, which per
 *    its docs applies only to a subscription that has never activated. An
 *    existing row reaching this is not a downgrade we understand, and silently
 *    downgrading a paying customer on a status we cannot explain is the exact
 *    failure `LAZY_EXPIRY_CANARIES` was added to catch. Preserve and log.
 *  - `unknown`: a status Stripe added after this map was written. Same
 *    treatment plus a Sentry report, so the gap is visible rather than
 *    silently entitling (or silently blocking) whoever hits it first.
 */
export type StripeStatusMapping =
    | { write: true; status: SubscriptionStatus }
    | { write: false; reason: 'pre_activation' | 'unknown' };

/**
 * Every status in Stripe's enum, mapped onto ours. Typed as a total record so
 * TypeScript fails the build if Stripe's SDK types gain a status this map does
 * not answer for — the compiler is the reminder, not a code review.
 *
 * `unpaid → past_due` (not `canceled`) is load-bearing in two directions:
 *   - Entitlement: paired with the period gate above, `past_due` carries the
 *     last PAID period, whose 3-day grace has long expired by the time Stripe
 *     gives up retrying — so the gate blocks, which is what Stripe asks for.
 *   - Notification: the `service_suspended` dunning sweep selects on
 *     `status = 'past_due'` (services/dunningNotices.ts). Mapping to `canceled`
 *     would block the merchant AND silence the email telling them why, because
 *     the `customer.subscription.deleted` webhook never fires under the
 *     dashboard's "mark unpaid" setting.
 *
 * `incomplete_expired → canceled`: the initial payment never succeeded and
 * Stripe will not bill this subscription again. That is terminal, and our
 * `canceled` is the terminal state the gate blocks with no grace.
 */
const STRIPE_STATUS_MAP: Record<Stripe.Subscription.Status, StripeStatusMapping> = {
    active: { write: true, status: 'active' },
    trialing: { write: true, status: 'trialing' },
    past_due: { write: true, status: 'past_due' },
    canceled: { write: true, status: 'canceled' },
    paused: { write: true, status: 'paused' },
    unpaid: { write: true, status: 'past_due' },
    incomplete_expired: { write: true, status: 'canceled' },
    incomplete: { write: false, reason: 'pre_activation' },
};

/**
 * Translate a Stripe subscription status into ours. Never returns a value
 * outside `SubscriptionStatus` — that is the entire point: the local column is
 * read by `checkSubscriptionStatus`, which grants entitlement to anything it
 * does not recognise.
 */
export function mapStripeSubscriptionStatus(status: string): StripeStatusMapping {
    return STRIPE_STATUS_MAP[status as Stripe.Subscription.Status] ?? { write: false, reason: 'unknown' };
}
