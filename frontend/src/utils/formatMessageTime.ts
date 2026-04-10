import { format, formatDistanceToNow } from 'date-fns';
import type { Locale } from 'date-fns';

/**
 * Format a date as absolute time (PPp). Used for title/tooltip.
 */
export function formatFullTime(
  dateValue: string | Date | null | undefined,
  dateLocale?: Locale
): string {
  if (!dateValue) return '-';
  try {
    return format(new Date(dateValue), 'PPp', { locale: dateLocale });
  } catch {
    return String(dateValue);
  }
}

/**
 * Format a date as relative time (<24 h) or absolute time (≥24 h).
 * Used for bubble timestamps in message/comment modals.
 */
export function formatMessageTime(
  dateValue: string | Date | null | undefined,
  dateLocale?: Locale
): string {
  if (!dateValue) return '-';
  try {
    const d = new Date(dateValue);
    const isRecent = Date.now() - d.getTime() < 24 * 60 * 60 * 1000;
    return isRecent
      ? formatDistanceToNow(d, { addSuffix: true, locale: dateLocale })
      : format(d, 'PPp', { locale: dateLocale });
  } catch {
    return String(dateValue);
  }
}
