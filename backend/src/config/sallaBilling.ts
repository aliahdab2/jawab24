import type { MarketplaceBilledCode } from '@jawab24/shared';
import { LIVE_SUBSCRIPTION_STATUSES } from './shopifyBilling';

/**
 * Salla Partners apps-policy **Article 5**: payment for a paid app "تتم عبر
 * منصة سلة" — through Salla, with Salla's commission. Steering a merchant who
 * came to us through the Salla App Store into an off-platform payment rail is
 * a delisting risk, and unpublishing a live Salla app is not self-serve (it
 * needs a booked meeting with Salla), so the downside is not recoverable by us.
 *
 * Jawab24 launches on Salla **free-tier-only**, which is compliant on its own —
 * but a Salla merchant who exhausts the free quota still sees the product's
 * normal upgrade CTAs, and those lead to Stripe. This module is the ONE home
 * for the rule that closes that leak, mirroring `config/shopifyBilling.ts`
 * (pure vocabulary here, the DB-touching side in `services/sallaBilling.ts`).
 *
 * Delete-me condition: when Salla billing exists (a `'salla'` subscription
 * source driven by `app.subscription.*` webhooks), the suppression becomes a
 * redirect to Salla's own plan management and this predicate is replaced by an
 * `isSallaBilled(row)` that reads the subscription, exactly like Shopify's.
 */

/** Wire code returned to clients when a Stripe path is refused under Article 5.
 *  Typed from the shared code set — see `marketplaceBilledCodes.ts`. */
export const SALLA_BILLED_CODE: MarketplaceBilledCode = 'SALLA_BILLED';

/**
 * Is this subscription row an established, currently-live **Stripe**
 * relationship?
 *
 * This is the exemption that keeps the guard honest (owner ruling 2026-08-10).
 * Article 5 governs merchants **Salla sourced to us**; a merchant who signed
 * up on jawab24.com, paid us through Stripe, and only later connected their
 * Salla store was never a Salla-sourced sale, and yanking their billing rail
 * out from under them would be both a revenue loss and a broken experience.
 *
 * ⚠️ The status check is NOT sufficient on its own and the payment-method
 * check is NOT redundant: a brand-new signup is created `status='trialing'`
 * with `payment_method` **NULL** (services/subscriptions.ts, the default trial
 * insert). Exempting on status alone would exempt every user on the platform
 * and the guard would never fire once. The `'stripe'` payment method is only
 * ever written after a real Stripe payment (the webhook handler and
 * subscriptionLinking), which is precisely the "already paying us" signal we
 * want. `'manual'` / admin-granted rows are deliberately NOT exempt — they
 * need no checkout, so blocking Stripe costs them nothing.
 *
 * `LIVE_SUBSCRIPTION_STATUSES` is imported rather than re-declared: it is the
 * documented cross-rail entitlement boundary and already serves Shopify and
 * subscription linking from that one home.
 */
export function hasLiveStripeBilling(row: {
    paymentMethod?: string | null;
    status?: string | null;
}): boolean {
    return row.paymentMethod === 'stripe'
        && (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(row.status ?? '');
}
