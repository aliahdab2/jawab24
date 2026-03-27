/**
 * Formats a date into a relative time string ("just now", "5 min ago", "2 hours ago", etc.)
 * using ICU plural-aware translation keys from the 'time' namespace.
 *
 * @param date - Date to format (string, Date, null, or undefined)
 * @param tTime - namespace-scoped translator for 'time' (e.g. useTranslations('time'))
 */
export function formatRelativeTime(
  date: string | Date | null | undefined,
  tTime: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return tTime('justNow');
  if (diffMin < 60) return tTime('minutesAgo', { count: diffMin });
  if (diffHr < 24) return tTime('hoursAgo', { count: diffHr });
  return tTime('daysAgo', { count: diffDay });
}
