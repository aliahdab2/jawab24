/**
 * Convert a Stripe Unix timestamp (seconds) to a Date, or null if the value is
 * missing/invalid. Stripe occasionally sends null for `current_period_*` and
 * `trial_end` (e.g. paused subscriptions, or when a subscription item drives
 * the period in newer API versions). Passing those to `new Date()` yields an
 * Invalid Date, which Drizzle's timestamp encoder rejects with RangeError.
 *
 * Shared by the payment controller (changePlan) and the Stripe webhook handlers.
 */
export function stripeTsToDate(ts: number | null | undefined): Date | null {
    if (ts === null || ts === undefined) return null;
    const ms = ts * 1000;
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
}
