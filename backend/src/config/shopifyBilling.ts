/**
 * Shopify App Pricing → local plan mapping.
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
 * open owner decision (plan §Open questions) — add the slug here when ruled. */
export const SHOPIFY_BILLABLE_PLAN_SLUGS = ['starter', 'business', 'pro'] as const;

export type ShopifyBillablePlanSlug = (typeof SHOPIFY_BILLABLE_PLAN_SLUGS)[number];

/**
 * Display names as configured on the App Pricing plans, lowercased. The handle
 * IS the slug (D-I), so slugs need no extra rows; this table only absorbs the
 * name → slug hop for Admin API results.
 */
const PLAN_NAME_TO_SLUG: Record<string, ShopifyBillablePlanSlug> = {
    'starter': 'starter',
    'business': 'business',
    'pro': 'pro',
};

/**
 * Resolve a Shopify plan identifier — a plan handle from the billing return
 * redirect, or an AppSubscription name from the Admin API — to a local plan
 * slug. Returns null for anything unknown; callers must treat null as a
 * fail-loud condition, never a default.
 */
export function mapShopifyPlanToSlug(handleOrName: string): ShopifyBillablePlanSlug | null {
    const normalized = handleOrName.trim().toLowerCase();
    if ((SHOPIFY_BILLABLE_PLAN_SLUGS as readonly string[]).includes(normalized)) {
        return normalized as ShopifyBillablePlanSlug;
    }
    return PLAN_NAME_TO_SLUG[normalized] ?? null;
}
