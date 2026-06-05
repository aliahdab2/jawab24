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

/** Format a USD price (in cents) with the locale's currency style, no decimals.
 *  Arabic uses Latin numerals (`ar-u-nu-latn`) to match the rest of the pricing UI. */
export function formatUsd(cents: number, locale?: string): string {
  const numberLocale = locale === 'ar' ? 'ar-u-nu-latn' : locale || 'en';
  return new Intl.NumberFormat(numberLocale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Color identity (ring + glow + surface tint) for a plan card — the single
 * source of truth shared by the public pricing grid (`PlanCard`) and the hidden
 * high-volume page (`ScalePlanCard`). Layout emphasis (`md:scale`, z-index) and
 * badge sizing stay local to each card; only the duplicated color/shadow strings
 * live here.
 */
export type PlanAccent = 'current' | 'amber' | 'blue' | 'plain';

export function planAccentClasses(accent: PlanAccent): { ring: string; surface: string } {
  switch (accent) {
    case 'current':
      return { ring: 'ring-2 ring-emerald-400 shadow-[0_20px_40px_rgba(16,185,129,0.18)]', surface: 'bg-emerald-50/40 dark:bg-emerald-950/40' };
    case 'amber':
      return { ring: 'ring-2 ring-amber-400 shadow-[0_20px_40px_rgba(217,161,12,0.15)]', surface: 'bg-amber-50/30 dark:bg-amber-950/30' };
    case 'blue':
      return { ring: 'ring-2 ring-blue-500 shadow-[0_20px_40px_rgba(59,130,246,0.18)]', surface: 'bg-card' };
    case 'plain':
    default:
      return { ring: 'border-theme-border shadow-[0_4px_6px_rgba(0,0,0,0.07)]', surface: 'bg-card' };
  }
}

/** Gradient pill (color only) for a plan badge; sizing stays local to each card. */
export function planBadgeGradient(accent: 'amber' | 'blue'): string {
  return accent === 'amber'
    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-[0_4px_8px_rgba(180,130,0,0.3)]'
    : 'bg-gradient-to-r from-blue-500 to-brand-500 text-white shadow-[0_4px_8px_rgba(0,0,0,0.2)]';
}
