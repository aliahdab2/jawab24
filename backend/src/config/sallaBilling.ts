import { normalizeArabic, type MarketplaceBilledCode } from '@jawab24/shared';
import { LIVE_SUBSCRIPTION_STATUSES } from './shopifyBilling';
import { config } from './index';

/**
 * Salla App Store plan → local plan mapping, and the Salla rail's share of the
 * billing-mirror vocabulary. The Zid twin is `config/zidBilling.ts`; the
 * cross-rail pieces (`LIVE_SUBSCRIPTION_STATUSES`, `hasLiveStripeBilling`) live
 * in one home each and are imported, never re-declared (Rule 10.8).
 *
 * Salla Partners apps-policy **Article 5**: payment for a paid app "تتم عبر
 * منصة سلة" — through Salla, with Salla's commission. Steering a merchant who
 * came to us through the Salla App Store into an off-platform payment rail is
 * a delisting risk, and unpublishing a live Salla app is not self-serve (it
 * needs a booked meeting with Salla), so the downside is not recoverable by us.
 *
 * D-103 (2026-08-26): the listing carries exactly the two `ecommerceEnabled`
 * plans — «الأعمال» (business) 146 SAR and «الاحترافي» (pro) 296 SAR ex-VAT,
 * monthly, 14-day trial — identical to Zid (D-095 numbers).
 *
 * Ruling: like Shopify's D-I and Zid's D-070, an identifier that resolves to
 * nothing must FAIL LOUD — no activation, Sentry. Activating a paying merchant
 * onto a guessed plan silently gives them the wrong limits, which is worse
 * than a visible stall the reconciler retries.
 *
 * ⚠️ Two things differ from Zid and both are load-bearing:
 *
 * 1. **Salla base plans carry NO plan id** (docs.salla.dev 421413m0: `item_slug`
 *    is null for `item_type=plan`, and no `plan_id` field exists), and the
 *    documented payload examples show `plan_name: null` for recurring base
 *    plans. So the name is matched first when present, and the **ex-VAT price**
 *    is the fallback identity — 146 and 296 are distinct by construction
 *    (D-103), which is what makes a price an acceptable key at all.
 *
 * 2. **The envelope is uncaptured.** No live paid subscription has ever
 *    round-tripped (the app is unpublished), so every field is read tolerantly
 *    and marked [provisional] — the same posture the Zid rail took before its
 *    first live envelope.
 */

/**
 * Plan slugs sellable through the Salla App Store (D-103, same set as Zid's
 * D-071). Starter/basic are deliberately absent: `ecommerceEnabled=false`, so
 * an app whose entire value on Salla is the store integration would be sold as
 * a plan that cannot use it.
 */
export type SallaBillablePlanSlug = 'business' | 'pro';

/** Wire code returned to clients when a Stripe path is refused under Article 5.
 *  Typed from the shared code set — see `marketplaceBilledCodes.ts`. */
export const SALLA_BILLED_CODE: MarketplaceBilledCode = 'SALLA_BILLED';

/**
 * Display names, normalized at module load through the same `normalizeArabic`
 * the lookup applies, so the table and the probe are folded identically and a
 * hamza difference can never split them. English spellings are accepted too —
 * the payload's language is not contractually pinned (all doc examples are
 * English, the portal wizard is filled in Arabic).
 */
const SALLA_PLAN_NAME_TO_SLUG: Record<string, SallaBillablePlanSlug> = Object.fromEntries(
    ([
        ['الأعمال', 'business'],
        ['الاحترافي', 'pro'],
        ['business', 'business'],
        ['pro', 'pro'],
    ] as Array<[string, SallaBillablePlanSlug]>).map(
        ([name, slug]) => [normalizeArabic(name).toLowerCase(), slug],
    ),
);

/**
 * The D-103 ex-VAT monthly prices, as the fallback identity for a payload whose
 * `plan_name` arrives null (the documented shape for recurring base plans).
 * Keyed on the numeric value so "146", "146.00" and 146 all resolve alike.
 * A price that maps to nothing fails loud upstream — never nearest-match.
 */
const SALLA_PLAN_PRICE_TO_SLUG = new Map<number, SallaBillablePlanSlug>([
    [146, 'business'],
    [296, 'pro'],
]);

/** Parse Salla's price field ("20.00" | 20 | null) to a number, or null. */
export function parseSallaPrice(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

/**
 * Resolve a Salla plan identifier to a local plan slug. Returns null for
 * anything unknown; callers MUST treat null as fail-loud, never as a default.
 *
 * Name wins when it resolves (it is the human-stated identity and survives a
 * price change); the ex-VAT price is the fallback for the null-name payloads
 * the docs show. Both inputs optional because the envelope is [provisional].
 */
export function mapSallaPlanToSlug(plan: {
    name?: string | null;
    price?: unknown;
}): SallaBillablePlanSlug | null {
    if (plan.name) {
        const byName = SALLA_PLAN_NAME_TO_SLUG[normalizeArabic(plan.name).toLowerCase()];
        if (byName) return byName;
    }
    const price = parseSallaPrice(plan.price);
    if (price !== null) {
        const byPrice = SALLA_PLAN_PRICE_TO_SLUG.get(price);
        if (byPrice) return byPrice;
    }
    return null;
}

/**
 * Is this row a Salla-billed relationship the Stripe-suppression rule applies
 * to? The canceled exemption is load-bearing and matches `isShopifyBilled` /
 * `isZidBilled`: a canceled mirror means the merchant uninstalled from the App
 * Store and MUST be free to come back through Stripe. A 'paused' mirror
 * (installed but not subscribed) still counts as salla-billed — re-subscribing
 * inside Salla is the recovery path, never Stripe.
 */
export function isSallaBilled(row: {
    paymentMethod?: string | null;
    status?: string | null;
}): boolean {
    return row.paymentMethod === 'salla' && row.status !== 'canceled';
}

/**
 * Where a Salla merchant manages their own subscription. The App Store listing
 * URL is the only Salla-side destination we will ever be able to name, and it
 * exists only after the listing publishes — until `SALLA_APP_STORE_URL` is set
 * this returns undefined, and consumers must treat undefined as "suppress
 * Stripe but show no link", never as "no suppression" (same contract as
 * `buildZidManageUrl`).
 */
export function buildSallaManageUrl(): string | undefined {
    return config.salla.appStoreUrl || undefined;
}

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
