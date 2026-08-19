import type Stripe from 'stripe';

/**
 * Stripe API-version compatibility accessors.
 *
 * Webhook event payloads are serialized at the API version configured on the
 * *webhook endpoint* in the Stripe Dashboard — NOT the version our SDK pins via
 * `apiVersion` (that only governs outbound SDK calls). Our endpoint renders at
 * `2025-12-15.clover` while the SDK/types are pinned to `2023-10-16`, so two
 * fields the webhook handlers depend on arrive in their *new* locations and read
 * back `undefined` against the old type shape:
 *
 *   invoice.subscription          → invoice.parent.subscription_details.subscription
 *   subscription.current_period_* → subscription.items.data[].current_period_*
 *
 * Reading the old path returned `null`, so renewals never advanced the period or
 * re-activated a `past_due` subscription (the lazy period-expiry in
 * services/subscriptions.ts then re-downgraded it on the next read). These
 * accessors read the new location with an old-path fallback, so the handlers are
 * correct regardless of which version renders a given payload — and stay correct
 * if the endpoint or SDK version is realigned later.
 *
 * See utils/stripeTime.ts for the timestamp→Date conversion applied downstream.
 */

type StripeRef = string | { id: string } | null | undefined;

function refToId(ref: StripeRef): string | null {
    if (!ref) return null;
    return typeof ref === 'string' ? ref : ref.id;
}

interface InvoiceSubscriptionCompat {
    subscription?: StripeRef;
    parent?: {
        subscription_details?: { subscription?: StripeRef } | null;
    } | null;
}

/**
 * Resolve the subscription id an invoice belongs to, across API versions.
 * Returns null for one-off invoices that carry no subscription.
 */
export function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
    const inv = invoice as unknown as InvoiceSubscriptionCompat;
    return refToId(inv.subscription) ?? refToId(inv.parent?.subscription_details?.subscription);
}

interface SubscriptionPeriodCompat {
    current_period_start?: number | null;
    current_period_end?: number | null;
    items?: {
        data?: Array<{ current_period_start?: number | null; current_period_end?: number | null }>;
    } | null;
}

/**
 * Resolve a subscription's current billing period (Unix seconds), across API
 * versions. Falls back through: legacy top-level field → first subscription
 * item's period → null. Feed the result to stripeTsToDate().
 */
export function getSubscriptionPeriod(subscription: Stripe.Subscription): {
    start: number | null;
    end: number | null;
} {
    const sub = subscription as unknown as SubscriptionPeriodCompat;
    const item = sub.items?.data?.[0];
    return {
        start: sub.current_period_start ?? item?.current_period_start ?? null,
        end: sub.current_period_end ?? item?.current_period_end ?? null,
    };
}

/**
 * The subscription's `latest_invoice` when it arrives EXPANDED, else null.
 *
 * `latest_invoice` is a bare id string on webhook payloads and on any retrieve
 * or list that did not ask for the expansion. A caller that needs the invoice's
 * `status` must therefore tell "expanded object" apart from "bare id" — and a
 * bare id must NEVER be read as "this subscription has no invoice", because
 * absent-invoice is the fully-discounted exemption in `isCurrentPeriodPaidFor`
 * and would wave an UNPAID period through. Callers that cannot tolerate a null
 * re-fetch with `stripeService.getSubscriptionWithLatestInvoice`.
 *
 * ⛔ Whatever you do with the invoice, do NOT read its `period_start` /
 * `period_end` as a paid-through boundary. Measured against the live API on
 * 2026-08-19: a `subscription_create` invoice reads a ZERO-LENGTH period
 * (`07-25T07:38 → 07-25T07:38`), and a `subscription_cycle` invoice reads the
 * period it bills in arrears — `07-13 → 08-13` on a subscription whose item
 * period had already advanced to `08-13 → 09-13`. The paid-through boundary
 * comes from `getSubscriptionPeriod` above, gated on the invoice's `status`.
 */
export function getExpandedLatestInvoice(subscription: Stripe.Subscription): Stripe.Invoice | null {
    const inv = (subscription as unknown as { latest_invoice?: unknown }).latest_invoice;
    return inv && typeof inv === 'object' ? (inv as Stripe.Invoice) : null;
}

// ---------------------------------------------------------------------------
// Invoice field accessors for the dunning emails (services/dunningNotices.ts).
//
// `hosted_invoice_url`, `amount_due` and `billing_reason` are top-level on the
// invoice in BOTH the pinned SDK version and the endpoint's `2025-12-15.clover`
// render — no relocation is known for them (unlike `invoice.subscription`
// above). They still go through runtime type guards, per this file's contract:
// a payload field we did not verify byte-for-byte is never trusted into an
// email. On a guard miss the caller falls back (dashboard URL, no-amount copy)
// instead of mailing `undefined`.
// ---------------------------------------------------------------------------

/** The Stripe-hosted payment page for an invoice — the dunning email's CTA. */
export function getInvoiceHostedUrl(invoice: Stripe.Invoice): string | null {
    const url = (invoice as unknown as { hosted_invoice_url?: unknown }).hosted_invoice_url;
    return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

/** The amount still owed on an invoice, in the currency's smallest unit. */
export function getInvoiceAmountDue(invoice: Stripe.Invoice): { amountCents: number; currency: string } | null {
    const inv = invoice as unknown as { amount_due?: unknown; currency?: unknown };
    if (typeof inv.amount_due !== 'number' || typeof inv.currency !== 'string') return null;
    return { amountCents: inv.amount_due, currency: inv.currency };
}

/**
 * Why the invoice exists — 'subscription_cycle' for a renewal,
 * 'subscription_create' for the first invoice at checkout (whose failure is
 * in-checkout UX, not dunning material).
 */
export function getInvoiceBillingReason(invoice: Stripe.Invoice): string | null {
    const reason = (invoice as unknown as { billing_reason?: unknown }).billing_reason;
    return typeof reason === 'string' ? reason : null;
}
