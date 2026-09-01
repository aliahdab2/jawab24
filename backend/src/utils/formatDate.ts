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
    // Opt OUT of the locale's own numeral system, keeping its month names.
    // Exactly one caller does this (`formatInvoiceDate`); see the reasoning
    // there. Defaulting to false keeps every existing formatter unchanged.
    latinDigits = false,
): string {
    try {
        const locale = latinDigits ? lang : numeralLocale(lang);
        return new Intl.DateTimeFormat(locale, options).format(d);
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

/**
 * "1 September 2026" / "1 سبتمبر 2026" — full date, with LATIN digits in both
 * languages.
 *
 * The deliberate exception to `numeralLocale` above, and the only one. Every
 * merchant-facing surface renders Arabic in Arabic-Indic numerals because that
 * is what reads naturally in an app; an invoice is a financial document that
 * gets forwarded to an accountant, keyed into bookkeeping software, and matched
 * against a bank statement — all of which are Latin-digit contexts. Arabic
 * commercial invoices are conventionally issued this way for the same reason.
 * The `latinDigits` flag on `formatWith` is what buys this: it skips
 * `numeralLocale`, so `ar` keeps its month names while the digits stay Latin.
 *
 * Note the year is included, unlike `formatDateLong`: a document that outlives
 * the conversation that produced it cannot rely on "this year" being obvious.
 */
export function formatInvoiceDate(d: Date, lang: string): string {
    // `en` resolves to US order ("September 1, 2026"). The issuer is a Swedish
    // business invoicing customers in the Middle East and Europe, where
    // day-first is the norm and month-first is read as an error; `en-GB` also
    // matches the Arabic side's "1 سبتمبر 2026" so the two language versions of
    // one invoice agree on shape.
    return formatWith(d, lang === 'en' ? 'en-GB' : lang, { day: 'numeric', month: 'long', year: 'numeric' }, 10, true);
}
