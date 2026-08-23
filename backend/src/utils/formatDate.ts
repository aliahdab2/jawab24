/**
 * Locale-aware date and number formatting for merchant-facing surfaces (emails,
 * in-app notification bodies).
 *
 * Intl throws on a malformed locale tag, and these run inside cron jobs where a
 * throw would abort the whole batch — so every formatter falls back to a plain
 * ISO slice rather than propagating.
 */

/**
 * Arabic renders its own numerals (٢٠), and a bare `ar` tag does NOT get you
 * them — Node's ICU resolves `ar` to Latin digits, so «20 أغسطس» is what
 * shipped. `ar-u-nu-arab` asks for the Arabic-Indic numbering system
 * explicitly.
 *
 * Applied at the single point every merchant-facing formatter passes through,
 * so the digest's two layouts (single-lead card, multi-lead table) cannot
 * disagree about which numeral system Arabic uses. Deliberately NOT applied to
 * phone numbers — those must stay Latin to remain dialable from a `tel:` link.
 */
function numeralLocale(lang: string): string {
    return lang === 'ar' || lang.startsWith('ar-') ? 'ar-u-nu-arab' : lang;
}

function formatWith(
    d: Date,
    lang: string,
    options: Intl.DateTimeFormatOptions,
    isoFallbackChars: number,
): string {
    try {
        return new Intl.DateTimeFormat(numeralLocale(lang), options).format(d);
    } catch {
        return d.toISOString().slice(0, isoFallbackChars).replace('T', ' ');
    }
}

/**
 * A count rendered in the locale's own numerals — the counterpart to the dates
 * above, for numbers interpolated into a translated string (`{count}`).
 *
 * `t()` substitutes placeholders as raw strings, so without this an Arabic
 * message reads «منذ 3 ساعات»: Latin digits inside Arabic text, next to a date
 * that now renders ٢٠. Falls back to the plain decimal on a malformed tag, for
 * the same cron-safety reason as the date formatters.
 */
export function formatCount(n: number, lang: string): string {
    try {
        return new Intl.NumberFormat(numeralLocale(lang)).format(n);
    } catch {
        return String(n);
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
