import { hasLiveStripeBilling } from '../config/sallaBilling';
import { hasActiveStoreForBillingSubject } from './ecommerce';

/**
 * The Salla Article-5 rule, in one place: **must this account's paid plans go
 * through Salla rather than Stripe?**
 *
 * See `config/sallaBilling.ts` for why the rule exists and what the exemption
 * means. Every consumer — the payment controller's guard on the Stripe entry
 * points, and the usage-summary choke point that drives the frontend CTAs —
 * calls THIS function, so the backend's answer and the UI's answer can never
 * disagree and dead-end a merchant.
 *
 * The subscription is passed in rather than fetched: both call sites have
 * already read it, and re-reading it here would double the query count on the
 * checkout path for nothing.
 *
 * Order is deliberate — the exemption is a pure in-memory check, so an
 * already-paying Stripe merchant never pays for the store query at all.
 */
export async function mustBillThroughSalla(
    userId: string,
    subscription: { paymentMethod?: string | null; status?: string | null } | null | undefined,
): Promise<boolean> {
    if (subscription && hasLiveStripeBilling(subscription)) return false;
    return hasActiveStoreForBillingSubject('salla', userId);
}
