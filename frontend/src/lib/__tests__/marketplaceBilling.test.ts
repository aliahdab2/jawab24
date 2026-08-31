import { describe, expect, it } from 'vitest';
import { MARKETPLACE_COPY, getMarketplaceBilling, visiblePlansFor, type MarketplaceSlug } from '../marketplaceBilling';
import enPricing from '@/i18n/en/pricing.json';
import arPricing from '@/i18n/ar/pricing.json';
import type { Plan, UsageSummary } from '@jawab24/shared';

/**
 * `MARKETPLACE_COPY` maps each billing rail to i18n keys held as plain strings.
 * `Record<MarketplaceSlug, …>` makes a new rail a compile error until it has an
 * ENTRY — but nothing makes the entry's KEYS real, because `t()` is unchecked in
 * this repo: `global.d.ts` augments next-intl v3's `IntlMessages` while we run
 * v4, which resolves messages from `AppConfig` and otherwise falls back to
 * `Record<string, any>`. Verified with a probe: `t('thisKeyDoesNotExist')`
 * type-checks clean.
 *
 * So a typo'd key here ships a raw `pricing.zidManagedBody` to a merchant, and
 * neither `tsc` nor `translation:validate` (which checks en/ar PARITY, not
 * existence at a call site) would say a word. This test is that missing gate —
 * and unlike a one-time manual page load, it also covers the next rail.
 *
 * Retire it only if/when `t()` becomes genuinely key-checked; until then it is
 * the only automated thing standing between a typo and a raw key in the UI.
 */

/** Resolve a possibly-dotted key path (e.g. `marketplaceNames.zid`) in a namespace. */
function resolveKey(namespace: Record<string, unknown>, key: string): unknown {
    return key.split('.').reduce<unknown>(
        (node, part) =>
            node && typeof node === 'object'
                ? (node as Record<string, unknown>)[part]
                : undefined,
        namespace,
    );
}

const LOCALES = {
    en: enPricing as unknown as Record<string, unknown>,
    ar: arPricing as unknown as Record<string, unknown>,
};

describe('MARKETPLACE_COPY — every key must exist in every locale', () => {
    const slugs = Object.keys(MARKETPLACE_COPY) as MarketplaceSlug[];

    it('covers every rail the type allows (guards against an empty/partial map)', () => {
        expect(slugs).toEqual(expect.arrayContaining(['shopify', 'salla', 'zid']));
    });

    for (const slug of slugs) {
        for (const [role, key] of Object.entries(MARKETPLACE_COPY[slug])) {
            for (const [locale, namespace] of Object.entries(LOCALES)) {
                it(`${slug}.${role} → pricing.${key} resolves in ${locale}`, () => {
                    const value = resolveKey(namespace, key);
                    expect(
                        value,
                        `Missing i18n key "${key}" in ${locale}/pricing.json — the UI would render the raw key`,
                    ).toBeTypeOf('string');
                    expect((value as string).trim().length).toBeGreaterThan(0);
                });
            }
        }
    }

    /**
     * The shared CTA label takes the marketplace name as an ICU argument. If the
     * placeholder were renamed on one side only, the button would read
     * "Manage plan in {marketplace}" verbatim.
     */
    it('marketplaceManageCta carries the {marketplace} placeholder in both locales', () => {
        for (const [locale, namespace] of Object.entries(LOCALES)) {
            const value = resolveKey(namespace, 'marketplaceManageCta');
            expect(value, `marketplaceManageCta missing in ${locale}`).toBeTypeOf('string');
            expect(value as string).toContain('{marketplace}');
        }
    });
});

describe('getMarketplaceBilling', () => {
    const usage = (subscription: unknown) => ({ subscription }) as unknown as UsageSummary;

    it('returns the verdict when a marketplace owns the account', () => {
        expect(getMarketplaceBilling(usage({ marketplaceBilling: { marketplace: 'zid' } })))
            .toEqual({ marketplace: 'zid' });
    });

    it('returns null when Stripe is the rail', () => {
        expect(getMarketplaceBilling(usage({ paymentMethod: 'stripe' }))).toBeNull();
    });

    /**
     * A missing summary must read as "not marketplace-billed" so the UI stays
     * usable while usage is still loading. Safety does not depend on this: the
     * backend refuses the Stripe call regardless (400), which is why suppression
     * is a UX layer and not the guard.
     */
    it('returns null for absent/loading usage rather than throwing', () => {
        expect(getMarketplaceBilling(undefined)).toBeNull();
        expect(getMarketplaceBilling(null)).toBeNull();
        expect(getMarketplaceBilling({} as UsageSummary)).toBeNull();
    });

    /** The legacy Salla-only flag must NOT be read — it is wire-compat only. */
    it('ignores the legacy sallaBilled boolean', () => {
        expect(getMarketplaceBilling(usage({ sallaBilled: true }))).toBeNull();
    });
});

describe('visiblePlansFor — each marketplace lists only what its shelf sells', () => {
    /**
     * The grid must mirror the backend rails' billable sets
     * (`ZidBillablePlanSlug` / `ShopifyBillablePlanSlug` / `SallaBillablePlanSlug`)
     * — a card the portal cannot bill is a dead end, and a missing card is a
     * sale the shelf silently refuses. D-120 put Starter on the Zid shelf; the
     * Salla portal still sells only Business/Pro (D-103).
     */
    const plan = (slug: string, isActive = true) =>
        ({ slug, isActive, ecommerceEnabled: slug === 'business' || slug === 'pro' || slug === 'starter' }) as unknown as Plan;
    const grid = [plan('basic'), plan('starter'), plan('business'), plan('pro')];
    const slugs = (plans: Plan[]) => plans.map((p) => p.slug);

    it('zid sells Starter, Business and Pro (D-120)', () => {
        expect(slugs(visiblePlansFor(grid, { marketplace: 'zid' }))).toEqual(['starter', 'business', 'pro']);
    });

    it('shopify sells Starter, Business and Pro (mirrors SHOPIFY_BILLABLE_PLAN_SLUGS)', () => {
        expect(slugs(visiblePlansFor(grid, { marketplace: 'shopify' }))).toEqual(['starter', 'business', 'pro']);
    });

    it('salla does NOT list Starter — its portal sells only Business/Pro (D-103)', () => {
        expect(slugs(visiblePlansFor(grid, { marketplace: 'salla' }))).toEqual(['business', 'pro']);
    });

    it('no marketplace → the full active grid, exactly as before', () => {
        expect(slugs(visiblePlansFor(grid, null))).toEqual(['basic', 'starter', 'business', 'pro']);
    });

    it('inactive plans never show, marketplace or not', () => {
        const withInactive = [...grid, plan('scale-20k', false)];
        expect(slugs(visiblePlansFor(withInactive, { marketplace: 'zid' }))).toEqual(['starter', 'business', 'pro']);
        expect(slugs(visiblePlansFor(withInactive, null))).toEqual(['basic', 'starter', 'business', 'pro']);
    });

    it('a rail this bundle does not know degrades to the ecommerce flag — never throws', () => {
        // `MarketplaceSlug` is a compile-time union over runtime API data: a
        // backend deployed ahead of a stale SSG page can hand the bundle a rail
        // it has no entry for. That must not crash the pricing page.
        const unknownRail = { marketplace: 'noon' as MarketplaceSlug };
        expect(slugs(visiblePlansFor(grid, unknownRail))).toEqual(['starter', 'business', 'pro']);
    });
});
