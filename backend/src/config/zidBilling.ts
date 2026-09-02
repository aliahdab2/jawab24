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
 * Plan slugs sellable through the Zid App Market (D-071, extended by D-120).
 *
 * Starter joined the shelf on 2026-08-31 (D-120): it now carries
 * `ecommerceEnabled=true`, and a ~56 SAR entry rung is how we stop being the
 * most expensive newcomer on a shelf where Radad sells at ~99 SAR. The upgrade
 * ladder to Business lives in Starter's limits (1 page / 1,500 replies).
 *
 * Unlike Shopify's list, this is a bare union rather than a runtime array: the
 * two lookup tables below ARE the sellable set, so a separate array would be a
 * second place to forget when a tier is added.
 */
export type ZidBillablePlanSlug = 'starter' | 'business' | 'pro';

/** Wire code returned to clients when a Stripe path is refused for a Zid merchant.
 *  Typed from the shared code set — see `marketplaceBilledCodes.ts`. */
export const ZID_BILLED_CODE: MarketplaceBilledCode = 'ZID_BILLED';

/**
 * The Partner-Dashboard plan ids, which are what a subscription payload
 * identifies a plan by when it carries an id at all.
 *
 * Pricing (D-095 / D-103 / D-120, website parity): 4177 «المبتدئ» 56 SAR ·
 * 3740 «الأعمال» 146 SAR · 3741 «الاحترافي» 296 SAR ex-VAT, recurring monthly
 * with a 14-day trial. The free system plan 3956 «اختبار» cannot be deleted
 * (Zid `cannot_delete_system_plan`) — nor edited: the partner dashboard
 * rejects every save on it («Failed to add plan», proven 2026-09-02) — and it
 * is absent here ON PURPOSE: an unmapped id fails loud rather than activating
 * someone on a guessed tier.
 */
const ZID_PLAN_ID_TO_SLUG: Record<string, ZidBillablePlanSlug> = {
    '4177': 'starter',
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
        ['المبتدئ', 'starter'],
        ['الأعمال', 'business'],
        ['الاحترافي', 'pro'],
        // The English names the dashboard shows beside the Arabic ones. Cheap to
        // accept, and the payload's language is not contractually pinned.
        ['starter', 'starter'],
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

export type ZidDashboardLocale = 'ar' | 'en';
export type ZidDashboardAppPage = 'embedded' | 'plans';

/**
 * A merchant-dashboard deep link into OUR app:
 * `https://dashboard.zid.sa/{ar-sa|en-sa}/stores/{merchantId}/apps/{appId}/{page}`.
 *
 * Observed live 2026-08-30 on the dev store: the app's Overview page links
 * "Upgrade plan" / "Manage" to `/plans`, and Zid's own post-install redirect
 * lands on `/embedded`. `stores/{id}` and the locale segment may be any valid
 * value — Zid's Hermes resolves the real store and language from the merchant's
 * dashboard session — but the merchant's own values are used when known.
 */
export function buildZidDashboardAppUrl(
    merchantId: string,
    page: ZidDashboardAppPage,
    locale: ZidDashboardLocale = 'ar',
): string {
    const localeSegment = locale === 'en' ? 'en-sa' : 'ar-sa';
    return `https://dashboard.zid.sa/${localeSegment}/stores/${encodeURIComponent(merchantId)}/apps/${encodeURIComponent(config.zid.appId)}/${page}`;
}

/**
 * Where a Zid merchant manages their own subscription: the plans page of OUR
 * app inside THEIR dashboard.
 *
 * Unlike Salla (free-tier only, so there is nowhere to send anyone), Zid SELLS
 * our paid plans — refusing Stripe without offering a destination was a dead
 * end of exactly the class the embedded flow fixed: the pricing banner said
 * "managed in the Zid App Market" with nothing to click. The URL shape was
 * kept unguessed until it was observed (D-073); it was, on 2026-08-30. Needs
 * the store's merchant id (`platformData.merchantId`, captured at install);
 * without one there is still no link. `ZID_APP_MARKET_URL`, when set, wins as
 * an explicit override. Consumers must treat undefined as "suppress Stripe but
 * show no link", never as "no suppression".
 */
export function buildZidManageUrl(
    merchantId?: string | null,
    locale: ZidDashboardLocale = 'ar',
): string | undefined {
    if (config.zid.appMarketUrl) return config.zid.appMarketUrl;
    const id = merchantId?.trim();
    if (!id || !config.zid.appId) return undefined;
    return buildZidDashboardAppUrl(id, 'plans', locale);
}
