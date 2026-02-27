import type { TranslationKey } from '@/i18n';

/**
 * Formats a page's `createdAt` date into a human-readable "Connected X days ago" string.
 */
export function formatConnectedDate(
  dateStr: string | null,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (!dateStr) return t('common.noData');
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days < 1) return t('pages.connectedToday' as TranslationKey);
  if (days === 1) return t('pages.connectedDayAgo' as TranslationKey);
  return t('pages.connectedAgo' as TranslationKey).replace('{count}', String(days));
}
