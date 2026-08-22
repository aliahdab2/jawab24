import { normalizeArabic, type MarketplaceBilledCode } from '@jawab24/shared';
import { config } from './index';

/**
 * Zid App Market plan → local plan mapping, and the Zid rail's share of the
 * billing-mirror vocabulary. The Shopify twin is `config/shopifyBilling.ts`;
 * the cross-rail pieces (`LIVE_SUBSCRIPTION_STATUSES`, `hasLiveStripeBilling`)
 * are imported from there rather than re-declared, so the entitlement boundary
 * has one home on every rail (Rule 10.8).
 *
 * Ruling: like Shopify's D-I, an identifier that resolves to nothing must FAIL
 * LOUD — no activation, Sentry. Activating a paying merchant onto a guessed
 * plan silently gives them the wrong limits, which is worse than a visible
 * stall the reconciler retries.
 *
 * ⚠️ Two things differ from Shopify and both are load-bearing:
 *
 * 1. **Zid's plan names come back in ARABIC** («الأعمال», «الاحترافي»), so
 *    Shopify's "lowercase display name == slug" shortcut does NOT port. The
 *    plan **id** is matched first because it is stable across a rename; the
 *    Arabic name is only a fallback, folded through the shared
 *    `normalizeArabic` so an أ/ا spelling drift on Zid's side cannot silently
 *    demote a paying merchant to `unknown_plan`.
 *
 * 2. **The envelope is uncaptured.** `EC3` (a Rejected app cannot be installed)
 *    blocks every live validation, so `GET /v1/market/app/subscription` has
 *    never been round-tripped. Field shapes are therefore read tolerantly and
 *    marked [provisional] — the same posture `services/zid.ts` already takes
 *    after D-020/D-053, where the FIRST Zid implementation was built on an
 *    assumed contract and had to be rewritten.
 */

/**
 * Plan slugs sellable through the Zid App Market (D-071).
 *
 * Starter is deliberately absent: Starter has `ecommerceEnabled=false`, so an
 * app whose entire value on Zid is the store integration would be sold as a
 * plan that cannot use it. A merchant who wants Starter buys it on jawab24.com.
 *
 * Unlike Shopify's list, this is a bare union rather than a runtime array: the
 * two lookup tables below ARE the sellable set, so a separate array would be a
 * second place to forget when a tier is added.
 */
export type ZidBillablePlanSlug = 'business' | 'pro';

/** Wire code returned to clients when a Stripe path is refused for a Zid merchant.
 *  Typed from the shared code set — see `marketplaceBilledCodes.ts`. */
export const ZID_BILLED_CODE: MarketplaceBilledCode = 'ZID_BILLED';

/**
 * The Partner-Dashboard plan ids, which are what a subscription payload
 * identifies a plan by when it carries an id at all.
 *
 * PROVISIONAL pricing (owner defers the final numbers until WHT is confirmed):
 * 3740 «الأعمال» 189 SAR · 3741 «الاحترافي» 379 SAR, recurring monthly with a
 * 14-day trial. A stray free plan 3956 «اختبار» exists in the dashboard and is
 * queued for deletion; it is absent here ON PURPOSE — an unmapped id fails loud
 * rather than activating someone on a guessed tier.
 */
const ZID_PLAN_ID_TO_SLUG: Record<string, ZidBillablePlanSlug> = {
    '3740': 'business',
    '3741': 'pro',
};

/**
 * Arabic display names, normalized at module load through the same
 * `normalizeArabic` the lookup applies, so the table and the probe are folded
 * identically and a hamza difference can never split them.
 */
const ZID_PLAN_NAME_TO_SLUG: Record<string, ZidBillablePlanSlug> = Object.fromEntries(
    ([
        ['الأعمال', 'business'],
        ['الاحترافي', 'pro'],
        // The English names the dashboard shows beside the Arabic ones. Cheap to
        // accept, and the payload's language is not contractually pinned.
        ['business', 'business'],
        ['pro', 'pro'],
    ] as Array<[string, ZidBillablePlanSlug]>).map(
        ([name, slug]) => [normalizeArabic(name).toLowerCase(), slug],
    ),
);

/**
 * Zid plans that are REAL but grant nothing — the free «اختبار» plan (id 3956)
 * the Partner Dashboard keeps for testing. `mapZidPlanToSlug` returns null for
 * these, which is correct (they entitle no tier), but they are NOT the "we do
 * not recognise this identifier" case fail-loud exists for: they are known, they
 * resolve to no entitlement by design, and a reviewer or we ourselves will
 * subscribe to one. Left to fail loud they page a human every reconcile pass
 * (JAWAB24-BACKEND-27 fired every ~6h off our own dev store, Users Impacted: 0)
 * — noise that trains the on-call to ignore the very alert that guards paying
 * merchants from being activated on a guessed tier.
 *
 * Matched by id first for the same reason as the slug table: the id survives a
 * rename, the Arabic name is the fallback.
 */
const ZID_NON_ENTITLING_PLAN_IDS = new Set(['3956']);

const ZID_NON_ENTITLING_PLAN_NAMES = new Set(
    ['اختبار', 'test'].map(name => normalizeArabic(name).toLowerCase()),
);

/**
 * Is this a known Zid plan that deliberately grants no entitlement? Callers use
 * it ONLY to downgrade an unmapped plan from fail-loud to a silent skip — it
 * must never activate anything.
 */
export function isZidNonEntitlingPlan(plan: {
    id?: string | number | null;
    name?: string | null;
}): boolean {
    if (plan.id !== undefined && plan.id !== null
        && ZID_NON_ENTITLING_PLAN_IDS.has(String(plan.id).trim())) {
        return true;
    }
    return !!plan.name && ZID_NON_ENTITLING_PLAN_NAMES.has(normalizeArabic(plan.name).toLowerCase());
}

/**
 * Resolve a Zid plan identifier to a local plan slug. Returns null for anything
 * unknown; callers MUST treat null as fail-loud, never as a default.
 *
 * Both inputs are optional because the payload shape is unconfirmed — whichever
 * of the two the envelope actually carries will resolve, and if it carries both
 * the id wins.
 */
export function mapZidPlanToSlug(plan: {
    id?: string | number | null;
    name?: string | null;
}): ZidBillablePlanSlug | null {
    if (plan.id !== undefined && plan.id !== null) {
        const byId = ZID_PLAN_ID_TO_SLUG[String(plan.id).trim()];
        if (byId) return byId;
    }
    if (plan.name) {
        const byName = ZID_PLAN_NAME_TO_SLUG[normalizeArabic(plan.name).toLowerCase()];
        if (byName) return byName;
    }
    return null;
}

/**
 * Is this row a Zid-billed relationship the Stripe-suppression rule applies to?
 *
 * The canceled exemption is load-bearing and matches `isShopifyBilled`: a
 * canceled mirror means the merchant uninstalled from the App Market and MUST
 * be free to come back through Stripe. A 'paused' mirror (installed but not
 * subscribed) still counts as zid-billed — re-subscribing inside Zid is the
 * recovery path, never Stripe.
 */
export function isZidBilled(row: {
    paymentMethod?: string | null;
    status?: string | null;
}): boolean {
    return row.paymentMethod === 'zid' && row.status !== 'canceled';
}

/**
 * Where a Zid merchant manages their own subscription.
 *
 * Unlike Salla (free-tier only, so there is nowhere to send anyone), Zid SELLS
 * our paid plans — refusing Stripe without offering a destination would be a
 * dead end of exactly the class the embedded flow just fixed. Returns undefined
 * until `ZID_APP_MARKET_URL` is configured: the App Market URL shape is not in
 * Zid's docs and has never been observed, and inventing one would send
 * merchants to a 404. Consumers must treat undefined as "suppress Stripe but
 * show no link", never as "no suppression".
 */
export function buildZidManageUrl(): string | undefined {
    return config.zid.appMarketUrl || undefined;
}
