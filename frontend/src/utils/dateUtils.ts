/**
 * Shared date formatting utilities.
 *
 * - formatFullTime / formatMessageTime — use date-fns with a Locale (bubble timestamps)
 * - formatRelativeTime — uses 'time' i18n namespace (relative labels with ICU plurals)
 * - formatConnectedDate — uses 'pages' i18n namespace (connected X days ago)
 */
import { format, formatDistanceToNow } from 'date-fns';
import type { Locale } from 'date-fns';

/** Today as YYYY-MM-DD in the USER'S timezone (en-CA formats ISO-style).
 *  Deliberately NOT `toISOString().slice(0,10)`: that is UTC, which flips to
 *  the wrong day near midnight — the exact boundary an expiring-row UI groups
 *  by. Shared by the catalog UI and the fact-list editor. */
export function todayISODate(): string {
    return new Date().toLocaleDateString('en-CA');
}

/** Format a date as absolute time (PPp). Used for title/tooltip. */
export function formatFullTime(
    dateValue: string | Date | null | undefined,
    dateLocale?: Locale,
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
    dateLocale?: Locale,
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

/**
 * Format a date into a relative time string ("just now", "5 min ago", "2 hours ago", etc.)
 * using ICU plural-aware translation keys from the 'time' namespace.
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

/**
 * Formats a page's `createdAt` date into a human-readable "Connected X days ago" string.
 *
 * @param dateStr - ISO date string (or null)
 * @param tPages - namespace-scoped translator for 'pages'
 * @param noDataFallback - fallback string when dateStr is null (e.g. tc('noData'))
 */
export function formatConnectedDate(
    dateStr: string | null,
    tPages: (key: 'connectedToday' | 'connectedAgo', params?: Record<string, string | number>) => string,
    noDataFallback?: string,
): string {
    if (!dateStr) return noDataFallback ?? '';
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diffMs / 86_400_000);
    if (days < 1) return tPages('connectedToday');
    return tPages('connectedAgo', { count: days });
}
