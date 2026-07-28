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
