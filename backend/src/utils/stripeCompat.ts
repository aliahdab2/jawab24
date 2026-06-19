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
