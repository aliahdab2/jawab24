/**
 * Locale-aware date formatting for merchant-facing surfaces (emails, in-app
 * notification bodies).
 *
 * Intl throws on a malformed locale tag, and these run inside cron jobs where a
 * throw would abort the whole batch — so every formatter falls back to a plain
 * ISO slice rather than propagating.
 */

function formatWith(
    d: Date,
    lang: string,
    options: Intl.DateTimeFormatOptions,
    isoFallbackChars: number,
): string {
    try {
        return new Intl.DateTimeFormat(lang, options).format(d);
    } catch {
        return d.toISOString().slice(0, isoFallbackChars).replace('T', ' ');
    }
}

/** "Aug 11, 09:30" — date plus time of day. Used by the lead digest table. */
export function formatDateTimeShort(d: Date, lang: string): string {
    return formatWith(d, lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }, 16);
}

/**
 * "11 August" — date only. For deadlines measured in days (a trial ending),
 * where an exact hour would imply a precision the reminder doesn't have.
 */
export function formatDateLong(d: Date, lang: string): string {
    return formatWith(d, lang, { day: 'numeric', month: 'long' }, 10);
}
