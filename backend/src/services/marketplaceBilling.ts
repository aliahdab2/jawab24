import { hasLiveStripeBilling, SALLA_BILLED_CODE } from '../config/sallaBilling';
import { isShopifyBilled, SHOPIFY_BILLED_CODE, buildShopifyManageUrl } from '../config/shopifyBilling';
import { isZidBilled, ZID_BILLED_CODE, buildZidManageUrl } from '../config/zidBilling';
import { hasActiveStoreForBillingSubject } from './ecommerce';

/**
 * **The** marketplace-billing guard: may this account's paid plans go through
 * Stripe, or does a marketplace own the money?
 *
 * One resolver for all three rails, replacing `mustBillThroughSalla` and the
 * open-coded `isShopifyBilled` branch that used to sit beside it in the payment
 * controller. Every consumer — the Stripe entry-point guard and the
 * usage-summary choke point that drives the frontend CTAs — calls THIS
 * function, so the backend's answer and the UI's answer can never disagree and
 * dead-end a merchant.
 *
 * Why one function instead of three predicates: each rail has the same shape
 * (is this merchant billed elsewhere, and where do they go instead?) but a
 * different *reason* — Shopify App Pricing (D-054), Salla's Article 5 (D-065),
 * Zid's App Market terms. Those reasons live in each rail's `config/*Billing.ts`
 * next to its vocabulary; what belongs here is the single ORDER in which they
 * are asked, because that order is the part a copy would get subtly wrong.
 *
 * The subscription is passed in rather than fetched: both call sites have
 * already read it, and re-reading would double the query count on the checkout
 * path for nothing.
 */

export type BillingMarketplace = 'shopify' | 'salla' | 'zid';

export interface MarketplaceBillingVerdict {
    marketplace: BillingMarketplace;
    /** Wire code returned to clients, so the frontend can translate the refusal. */
    code: string;
    /** Developer-facing fallback message; the client renders from `code`. */
    message: string;
    /**
     * Where the merchant manages their own plan. Undefined when the marketplace
     * has no self-serve destination we can name — Salla (free-tier only, so
     * there is no plan to manage) and Zid until `ZID_APP_MARKET_URL` is
     * configured. Consumers must treat undefined as "suppress Stripe but show
     * no link", NEVER as "no suppression".
     */
    manageUrl?: string;
}

type BillingSubscriptionRow = {
    paymentMethod?: string | null;
    status?: string | null;
    shopifyShopDomain?: string | null;
} | null | undefined;

/**
 * Resolve which marketplace — if any — bills this account.
 *
 * ORDER IS THE CONTRACT:
 *
 * 1. **Row-based rails first.** An existing `shopify`/`zid` mirror is positive
 *    proof that a marketplace is already charging this merchant, so it outranks
 *    every heuristic below, including the Stripe exemption. (The adopt paths
 *    refuse to overwrite a live Stripe row, so "pays Stripe AND has a mirror"
 *    should be unreachable; ordering it this way means that even if it happened
 *    we would not send them to a second checkout.)
 * 2. **The Stripe exemption.** A merchant who signed up on jawab24.com and pays
 *    us through Stripe was never a marketplace-sourced sale — yanking their
 *    billing rail out from under them would be both a revenue loss and a broken
 *    experience (owner ruling 2026-08-10, D-065). See `hasLiveStripeBilling`
 *    for why the payment-method check is NOT redundant with the status check.
 * 3. **Store-based rails.** A connected marketplace store with no mirror yet
 *    means the merchant arrived through that marketplace and must subscribe
 *    there. Salla is asked before Zid purely to keep the pre-existing Salla
 *    answer byte-for-byte unchanged for anyone who somehow has both.
 */
export async function resolveMarketplaceBilling(
    userId: string,
    subscription: BillingSubscriptionRow,
): Promise<MarketplaceBillingVerdict | null> {
    if (subscription && isShopifyBilled(subscription)) {
        return {
            marketplace: 'shopify',
            code: SHOPIFY_BILLED_CODE,
            message: 'Billing for this account is managed in Shopify admin',
            manageUrl: subscription.shopifyShopDomain
                ? buildShopifyManageUrl(subscription.shopifyShopDomain)
                : undefined,
        };
    }

    if (subscription && isZidBilled(subscription)) {
        return {
            marketplace: 'zid',
            code: ZID_BILLED_CODE,
            message: 'Paid plans for Zid merchants are billed through the Zid App Market',
            manageUrl: buildZidManageUrl(),
        };
    }

    // The exemption is a pure in-memory check, so an already-paying Stripe
    // merchant never pays for the store queries below at all.
    if (subscription && hasLiveStripeBilling(subscription)) return null;

    if (await hasActiveStoreForBillingSubject('salla', userId)) {
        return {
            marketplace: 'salla',
            code: SALLA_BILLED_CODE,
            message: 'Paid plans for Salla merchants are billed through Salla',
            // Salla launches free-tier-only: there is no Salla-side plan to
            // manage, so there is deliberately nowhere to send them.
            manageUrl: undefined,
        };
    }

    if (await hasActiveStoreForBillingSubject('zid', userId)) {
        return {
            marketplace: 'zid',
            code: ZID_BILLED_CODE,
            message: 'Paid plans for Zid merchants are billed through the Zid App Market',
            manageUrl: buildZidManageUrl(),
        };
    }

    return null;
}
