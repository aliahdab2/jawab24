/**
 * Shared date formatting utilities.
 *
 * - formatFullTime / formatMessageTime — use date-fns with a Locale (bubble timestamps)
 * - formatRelativeTime — uses 'time' i18n namespace (relative labels with ICU plurals)
 * - formatConnectedDate — uses 'pages' i18n namespace (connected X days ago)
 * - formatTimestampDate / formatDaysAgo — Intl-only, no translator needed
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

/** Format a date as absolute time (PPp). Used for title/tooltip, and for any FUTURE
 *  timestamp shown to the merchant (a scheduled post's publish time) where a relative
 *  string would hide the date being scheduled against. */
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
 * Format a FUTURE instant the merchant is scheduling against, with its UTC offset.
 *
 * The offset is not decoration: a scheduled post's publish time is an absolute instant
 * from Graph, rendered in the browser's timezone. A merchant whose device sits in a
 * different zone than the one they scheduled in would otherwise read a time that
 * silently disagrees with what Facebook's composer showed them, with nothing on screen
 * to explain the difference.
 */
export function formatScheduledTime(
    dateValue: string | Date | null | undefined,
    dateLocale?: Locale,
): string {
    if (!dateValue) return '-';
    try {
        return format(new Date(dateValue), 'PPp (OOOO)', { locale: dateLocale });
    } catch {
        return String(dateValue);
    }
}

/**
 * Format a date as relative time (<24 h) or absolute time (≥24 h).
 * Used for bubble timestamps in message/comment modals.
 *
 * PAST timestamps only. `Date.now() - d` is negative for anything upcoming, so every
 * future date falls into the "recent" branch and renders as a vague "in 16 days" —
 * use `formatFullTime` for scheduled/future times (e.g. a post's publish time).
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

/**
 * A full ISO TIMESTAMP as a short calendar date ("20 أغسطس 2026").
 *
 * Distinct from formatPlainDate below, which takes a bare YYYY-MM-DD and must
 * hand-parse it to dodge the UTC-midnight trap. A timestamp carries its own
 * instant, so Date can parse it directly. Returns `fallback` for null/invalid
 * input rather than "Invalid Date".
 */
export function formatTimestampDate(
    iso: string | null | undefined,
    intlLocale: string,
    fallback = '—',
): string {
    if (!iso) return fallback;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return fallback;
    return d.toLocaleDateString(intlLocale, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * "today" / "3 days ago" for a past timestamp, via Intl.RelativeTimeFormat —
 * no i18n namespace needed, unlike formatRelativeTime above. Beyond `maxDays`
 * (default 30) a relative label stops being useful, so it falls back to the
 * absolute date. Future timestamps also render absolute: "in 3 days" reads as
 * wrong for a last-activity column.
 */
export function formatDaysAgo(
    iso: string | null | undefined,
    intlLocale: string,
    { maxDays = 30, fallback = '—' }: { maxDays?: number; fallback?: string } = {},
): string {
    if (!iso) return fallback;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return fallback;
    const days = Math.round((Date.now() - d.getTime()) / 86_400_000);
    if (days < 0 || days > maxDays) return formatTimestampDate(iso, intlLocale, fallback);
    return new Intl.RelativeTimeFormat(intlLocale, { numeric: 'auto' }).format(-days, 'day');
}

/**
 * Display a bare calendar date ("2026-08-04") the way a person writes it.
 *
 * Two traps this exists to avoid — do not "simplify" them away:
 * - `new Date('2026-08-04')` is UTC midnight, which renders as the PREVIOUS
 *   day in any timezone west of Greenwich. The components are parsed by hand
 *   and fed to the local-time Date constructor instead.
 * - `ar-SA` resolves to the Islamic calendar in some engines; catalog and
 *   fact-list dates are authored Gregorian, so the calendar is forced.
 *
 * The year renders only when it differs from the current year — «٤ أغسطس»
 * this year, «4 أغسطس 2027» next. Anything that is not YYYY-MM-DD is returned
 * unchanged: malformed data should be visible, not swallowed.
 */
export function formatPlainDate(
    iso: string | null | undefined,
    intlLocale: string,
): string | null {
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    const [, y, mo, d] = m;
    const date = new Date(Number(y), Number(mo) - 1, Number(d));
    // Date() rolls out-of-range components over (month 99 → some later year)
    // instead of failing — only a round-trip proves the input was a real day.
    if (
        date.getFullYear() !== Number(y) ||
        date.getMonth() !== Number(mo) - 1 ||
        date.getDate() !== Number(d)
    ) return iso;
    const withYear = y !== todayISODate().slice(0, 4);
    return new Intl.DateTimeFormat(intlLocale, {
        calendar: 'gregory',
        day: 'numeric',
        month: 'long',
        ...(withYear ? { year: 'numeric' } : {}),
    }).format(date);
}

/** The two pieces a calendar-agenda date chip needs («4» / «أغسطس»), from the
 *  same safe parsing as formatPlainDate. Null when the input isn't a plain
 *  calendar date. */
export function formatPlainDateParts(
    iso: string | null | undefined,
    intlLocale: string,
): { day: string; month: string } | null {
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    const [, y, mo, d] = m;
    const date = new Date(Number(y), Number(mo) - 1, Number(d));
    if (
        date.getFullYear() !== Number(y) ||
        date.getMonth() !== Number(mo) - 1 ||
        date.getDate() !== Number(d)
    ) return null;
    const fmt = (opts: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat(intlLocale, { calendar: 'gregory', ...opts }).format(date);
    return { day: fmt({ day: 'numeric' }), month: fmt({ month: 'short' }) };
}
