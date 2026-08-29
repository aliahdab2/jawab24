/**
 * Pricing DISPLAY helpers. Frontend-only by design — do not move them into
 * `@jawab24/shared`.
 *
 * Two reasons, and the second is the one that bites:
 *
 * 1. `/pricing` and `/pricing/scale` are the paid-ads landing pages and refuse
 *    every VALUE import from `@jawab24/shared` (CommonJS, untree-shakeable: one
 *    named import drags in zod + libphonenumber-js). See the import block at the
 *    top of both pages. Re-exporting shared helpers from here would smuggle that
 *    bundle onto exactly the page those comments protect.
 * 2. The monthly × 10 fallback below is a DISPLAY rule — it keeps the grid
 *    rendering for a plan nobody has priced annually yet. It is deliberately NOT
 *    the rule for money: `services/offlinePayments.ts` refuses a yearly claim on
 *    a plan with no yearly price rather than quote an invented figure. The two
 *    look like the same arithmetic and are not the same rule (D-110).
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

/** USD is pegged at 3.75 SAR — informational "≈ SAR/mo" hint only, not a charged amount. */
const USD_TO_SAR = 3.75;

/** Approximate SAR per-month equivalent (whole riyals) for a plan's price. */
export function getSarMonthlyEquivalent(
  monthlyCents: number,
  interval: 'month' | 'year',
  yearlyCents?: number | null,
): number {
  return Math.round((getMonthlyEquivalent(monthlyCents, interval, yearlyCents) / 100) * USD_TO_SAR);
}

/**
 * Format a raw USD amount (already in dollars, not cents) for the AI-cost admin
 * panels. Defaults to 4 decimals because per-reply costs are sub-cent (~$0.0015);
 * pass `digits: 2` for large aggregate totals. Shared by AiSection and the AI
 * Cost dashboard so the `$x.xxxx` formatting lives in one place.
 */
export function formatCostUsd(usd: number, digits: number = 4): string {
  return `$${usd.toFixed(digits)}`;
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
      // Softer than the 'blue' (Most Popular) accent on purpose — Pro reads as a
      // premium touch without competing with the Business card for attention.
      return { ring: 'ring-1 ring-amber-300 dark:ring-amber-700/60 shadow-[0_12px_24px_rgba(217,161,12,0.10)]', surface: 'bg-amber-50/30 dark:bg-amber-950/30' };
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
