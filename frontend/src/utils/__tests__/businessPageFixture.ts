import type { Page } from '@jawab24/shared';

/**
 * A `Page` carrying exactly the confirmed merchant facts a test names.
 *
 * Shared by the three suites that exercise the /business coverage rules — the
 * readiness card, the fact rows, and `computeBusinessCoverage` itself — because
 * they must all agree on what a page LOOKS like. Three private copies of this
 * one-liner is how the suites would drift into testing different shapes of the
 * same object (they were already byte-identical bar the `name`).
 *
 * @param merchant the CONFIRMED half of business_profile — the only half any of
 *   these rules read (suggestions never count as covered).
 * @param extra    page-level fields the profile cannot carry: `ecommerceStoreId`,
 *   `storeAnswersPolicies`, …
 */
export function businessPage(
  merchant: Record<string, unknown> = {},
  extra: Partial<Page> = {},
): Page {
  return { id: 'p1', name: 'Shop', businessProfile: { merchant }, ...extra } as unknown as Page;
}

/**
 * Same page, but every named merchant field carries UNCONFIRMED fb_sync
 * provenance — the state a Facebook auto-sync leaves behind. The coverage
 * rules must treat these as suggestions to review, never as covered facts
 * (the MES «+971556087128» laundering incident, 2026-08-08).
 */
export function businessPageFbSynced(
  merchant: Record<string, unknown> = {},
  extra: Partial<Page> = {},
): Page {
  const merchantProvenance = Object.fromEntries(
    Object.keys(merchant).map((f) => [f, { source: 'fb_sync', confirmedAt: null }]),
  );
  return {
    id: 'p1', name: 'Shop',
    businessProfile: { merchant, suggestions: { ...merchant }, merchantProvenance },
    ...extra,
  } as unknown as Page;
}
