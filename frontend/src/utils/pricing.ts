/**
 * Shared pricing display helpers.
 *
 * Yearly prices come from the DB (`plan.yearlyPrice`).
 * If a plan has no yearly price set, we fall back to monthly * 10
 * (save 2 months ≈ 17%) so the pricing page still works.
 */

const FALLBACK_ANNUAL_MONTHS = 10;

/** Total price in cents for the selected billing interval. */
export function getDisplayPrice(
  monthlyCents: number,
  interval: 'month' | 'year',
  yearlyCents?: number | null,
): number {
  if (interval !== 'year') return monthlyCents;
  return yearlyCents ?? monthlyCents * FALLBACK_ANNUAL_MONTHS;
}

/** Monthly equivalent in cents when billed annually. */
export function getMonthlyEquivalent(
  monthlyCents: number,
  interval: 'month' | 'year',
  yearlyCents?: number | null,
): number {
  if (interval !== 'year') return monthlyCents;
  const yearly = yearlyCents ?? monthlyCents * FALLBACK_ANNUAL_MONTHS;
  return Math.round(yearly / 12);
}

/** How much the user saves per year in cents. */
export function getAnnualSavings(
  monthlyCents: number,
  yearlyCents?: number | null,
): number {
  const yearly = yearlyCents ?? monthlyCents * FALLBACK_ANNUAL_MONTHS;
  return monthlyCents * 12 - yearly;
}
