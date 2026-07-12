/**
 * Format an ISO timestamp as a short month + day string ("Jun 11" / "11 يونيو")
 * for showing when the current billing period resets. Used on the dashboard
 * plan-usage tile and the quota-warning banner — keep them in sync via this
 * single helper so the two surfaces never drift on format.
 *
 * `withTime` appends the local time ("Jun 11, 02:00") — the quota resets at a
 * specific moment, not a calendar day, so surfaces where the merchant is
 * actively waiting for the reset (the limit-reached banner) show the hour.
 *
 * Returns `null` for missing/invalid input so callers can render conditionally.
 */
export function formatQuotaResetDate(
  iso: string | null | undefined,
  locale: string,
  opts?: { withTime?: boolean },
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  if (opts?.withTime) {
    return date.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}
