import type { UsageSummary } from '@jawab24/shared';

/**
 * The client half of the marketplace-billing guard (D-073).
 *
 * The backend refuses every Stripe surface for a marketplace-billed account
 * (400 `SHOPIFY_BILLED` / `SALLA_BILLED` / `ZID_BILLED`). This module is the
 * friendly layer that stops the merchant reaching a refusal at all — and it
 * reads the SAME field the backend computes at its one choke point
 * (`subscription.marketplaceBilling`), so the UI and the API cannot disagree
 * and dead-end someone.
 *
 * Before this existed the UI open-coded `paymentMethod === 'shopify'` and
 * `sallaBilled` in four places and knew nothing about Zid, so a Zid merchant
 * walked into a generic error toast with no explanation and no destination.
 */

export type MarketplaceSlug = NonNullable<
    UsageSummary['subscription']['marketplaceBilling']
>['marketplace'];

/**
 * Per-marketplace copy keys, listed explicitly rather than interpolated
 * (`${slug}ManagedBody`) so every key stays greppable.
 *
 * What this actually enforces, precisely: `Record<MarketplaceSlug, …>` makes a
 * new rail a COMPILE ERROR until it has an ENTRY here. It does NOT verify that
 * the entry's strings name real i18n keys — `t()` is currently unchecked
 * repo-wide, because `global.d.ts` augments next-intl v3's `IntlMessages` while
 * we run v4, which reads messages from `AppConfig` and otherwise falls back to
 * `Record<string, any>`. So a typo here still ships a raw key to a merchant.
 * Verify new keys exist in BOTH locale files, and load the page in `/en` and
 * `/ar` — `translation:validate` checks parity, not existence at a call site.
 *
 * The bodies deliberately differ: Shopify's says the subscription came from the
 * App Store, Salla's says paid plans are still coming (we ship free-tier-only
 * there), and Zid's names the App Market. Flattening them into one string would
 * lose the only information the banner carries.
 */
export const MARKETPLACE_COPY: Record<
    MarketplaceSlug,
    { toast: string; body: string; name: string }
> = {
    shopify: { toast: 'shopifyManagedToast', body: 'shopifyManagedBody', name: 'marketplaceNames.shopify' },
    salla: { toast: 'sallaManagedToast', body: 'sallaManagedBody', name: 'marketplaceNames.salla' },
    zid: { toast: 'zidManagedToast', body: 'zidManagedBody', name: 'marketplaceNames.zid' },
};

/**
 * Which marketplace — if any — owns this account's paid plans.
 *
 * Reads only `marketplaceBilling`. The legacy `sallaBilled` boolean is still on
 * the wire for older BUNDLED app builds (see its doc comment in
 * `packages/shared`), but the web bundle ships with its own backend, so there
 * is no version skew to absorb here and reading both would just be a second
 * place to drift.
 */
export function getMarketplaceBilling(
    usage: UsageSummary | null | undefined,
): { marketplace: MarketplaceSlug; manageUrl?: string } | null {
    return usage?.subscription?.marketplaceBilling ?? null;
}
