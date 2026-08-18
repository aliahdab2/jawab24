/**
 * Resolve which Stripe price a checkout / plan change should bill.
 *
 * Single choke point for the monthly-vs-yearly decision, shared by every
 * Stripe entry point (createCheckoutSession, createSubscriptionIntent,
 * changePlan). The yearly branch REFUSES instead of falling back: before
 * 2026-08-15 each call site silently substituted the MONTHLY price when a
 * plan had no `stripe_yearly_price_id`, so a "yearly" checkout charged the
 * monthly amount while the UI promised an annual total with a ~17% saving.
 */

export type BillingInterval = 'month' | 'year';

export type StripePriceResolution =
    | { ok: true; billingInterval: BillingInterval; stripePriceId: string }
    | { ok: false; code: 'YEARLY_NOT_AVAILABLE' | 'PRICE_NOT_CONFIGURED'; error: string };

export function resolveStripePriceForInterval(
    plan: { stripePriceId: string | null; stripeYearlyPriceId: string | null },
    rawInterval: unknown,
): StripePriceResolution {
    const billingInterval: BillingInterval = rawInterval === 'year' ? 'year' : 'month';

    if (billingInterval === 'year') {
        if (!plan.stripeYearlyPriceId) {
            return {
                ok: false,
                code: 'YEARLY_NOT_AVAILABLE',
                error: 'Yearly billing is not available for this plan',
            };
        }
        return { ok: true, billingInterval, stripePriceId: plan.stripeYearlyPriceId };
    }

    if (!plan.stripePriceId) {
        return {
            ok: false,
            code: 'PRICE_NOT_CONFIGURED',
            error: 'Plan does not have a Stripe Price ID configured',
        };
    }
    return { ok: true, billingInterval, stripePriceId: plan.stripePriceId };
}

/** Shape of a Stripe price, narrowed to what adoption matching needs. */
interface AdoptablePrice {
    id: string;
    unit_amount: number | null;
    currency: string;
    recurring?: { interval: string } | null;
}

/**
 * The idempotency core of the price-creation scripts: among a product's
 * existing prices, the one that can serve as the plan's price for a given
 * interval — same interval, exact advertised amount, same currency. Adopting a
 * match instead of creating lets a script re-run safely after a partial failure
 * (price created, DB write missed) and coexist with hand-made Dashboard prices.
 */
export function findAdoptablePrice<T extends AdoptablePrice>(
    prices: T[],
    amount: number,
    currency: string,
    interval: BillingInterval,
): T | undefined {
    return prices.find(
        p => p.recurring?.interval === interval
            && p.unit_amount === amount
            && p.currency === currency,
    );
}

/** Yearly specialisation — the original name, kept for existing callers. */
export function findAdoptableYearlyPrice<T extends AdoptablePrice>(
    prices: T[],
    yearlyAmount: number,
    currency: string,
): T | undefined {
    return findAdoptablePrice(prices, yearlyAmount, currency, 'year');
}
