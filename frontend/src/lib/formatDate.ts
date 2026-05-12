/**
 * Format an ISO timestamp as a short month + day string ("Jun 11" / "11 يونيو")
 * for showing when the current billing period resets. Used on the dashboard
 * plan-usage tile and the quota-warning banner — keep them in sync via this
 * single helper so the two surfaces never drift on format.
 *
 * Returns `null` for missing/invalid input so callers can render conditionally.
 */
export function formatQuotaResetDate(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}
