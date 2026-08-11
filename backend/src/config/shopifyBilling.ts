import { config } from './index';

/**
 * Shopify App Pricing → local plan mapping, plus the shared billing-mirror
 * vocabulary (live-status boundary, billed predicate, admin deep link) that
 * both billing rails and every consumer surface import from HERE — one home,
 * so a ruling change is a one-site edit (Rule 10.8).
 *
 * Ruling D-I (Shopify billing design, 2026-08-01): the plan HANDLES configured
 * in the Shopify Partner Dashboard are our plan slugs, verbatim. The Admin API
 * exposes an AppSubscription's display NAME (not its handle), and the billing
 * return endpoint receives the handle as an untrusted query param — so both
 * identifiers must resolve, case-insensitively, to the same slug.
 *
 * An identifier that resolves to nothing means the dashboard and this table
 * have drifted. That must FAIL LOUD (no activation, Sentry) — activating a
 * paying merchant onto a guessed plan silently gives them the wrong limits,
 * which is worse than a visible stall the reconciler retries.
 */

/** Plan slugs sellable through Shopify App Pricing at launch. Scale tiers are an
 * open owner decision (plan §Open questions) — add the slug here when ruled.
 * Deliberately not exported: mapShopifyPlanToSlug is the only sanctioned reader. */
const SHOPIFY_BILLABLE_PLAN_SLUGS = ['starter', 'business', 'pro'] as const;

export type ShopifyBillablePlanSlug = (typeof SHOPIFY_BILLABLE_PLAN_SLUGS)[number];

/**
 * Statuses under which a subscription row is currently entitling somebody —
 * the D-H adoption-refusal boundary on BOTH billing rails: a Shopify adoption
 * must not overwrite a row in these states on another rail, and a Stripe
 * adoption must not overwrite a live shopify mirror. Distinct from the
 * canceled-exemption boundary below ('paused' is live here, exempt nowhere).
 */
export const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'] as const;

/** Wire code returned to clients when a Stripe path is refused for a Shopify merchant. */
export const SHOPIFY_BILLED_CODE = 'SHOPIFY_BILLED';

/**
 * Is this row a Shopify-billed relationship the D-G rule applies to?
 *
 * The canceled exemption is load-bearing: a canceled mirror means the merchant
 * uninstalled the app and MUST be free to come back through Stripe — so a
 * canceled row blocks nothing and shows no Shopify surfaces. A 'paused' mirror
 * (installed but not paying) still counts as shopify-billed: re-picking a plan
 * inside Shopify is the recovery path, never Stripe.
 */
export function isShopifyBilled(row: {
    paymentMethod?: string | null;
    status?: string | null;
}): boolean {
    return row.paymentMethod === 'shopify' && row.status !== 'canceled';
}

/**
 * The ONE encoding of the Shopify admin plan-management deep link
 * (admin.shopify.com/store/{store}/charges/{app_handle}/pricing_plans).
 * Shopify has changed its admin URL shape before — every consumer goes
 * through here so a future change is a one-line fix. Returns undefined until
 * SHOPIFY_APP_HANDLE is configured (the listing must exist first).
 */
export function buildShopifyManageUrl(shopDomain: string): string | undefined {
    if (!config.shopify.appHandle) return undefined;
    const storeHandle = shopDomain.replace('.myshopify.com', '');
    return `https://admin.shopify.com/store/${storeHandle}/charges/${config.shopify.appHandle}/pricing_plans`;
}

/**
 * Resolve a Shopify plan identifier — a plan handle from the billing return
 * redirect, or an AppSubscription name from the Admin API — to a local plan
 * slug. Returns null for anything unknown; callers must treat null as a
 * fail-loud condition, never a default.
 *
 * Today the lowercase display names equal the slugs, so one lookup covers
 * both. If a dashboard plan's display name ever diverges from its handle
 * (e.g. Arabic display names), add an explicit name→slug table here — do NOT
 * loosen the fail-loud contract.
 */
export function mapShopifyPlanToSlug(handleOrName: string): ShopifyBillablePlanSlug | null {
    const normalized = handleOrName.trim().toLowerCase();
    if ((SHOPIFY_BILLABLE_PLAN_SLUGS as readonly string[]).includes(normalized)) {
        return normalized as ShopifyBillablePlanSlug;
    }
    return null;
}
