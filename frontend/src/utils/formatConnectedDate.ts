/**
 * Formats a page's `createdAt` date into a human-readable "Connected X days ago" string.
 *
 * @param dateStr - ISO date string (or null)
 * @param tPages - namespace-scoped translator for 'pages' (e.g. useTranslations('pages'))
 * @param noDataFallback - fallback string when dateStr is null (e.g. tc('noData'))
 */
export function formatConnectedDate(
  dateStr: string | null,
  tPages: (key: 'connectedToday' | 'connectedDayAgo' | 'connectedAgo', params?: Record<string, string | number>) => string,
  noDataFallback?: string,
): string {
  if (!dateStr) return noDataFallback ?? '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days < 1) return tPages('connectedToday');
  if (days === 1) return tPages('connectedDayAgo');
  return tPages('connectedAgo', { count: days });
}
