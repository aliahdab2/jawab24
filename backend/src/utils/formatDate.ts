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
    // Force Latin digits while keeping the locale's month names. Exactly one
    // caller does this (`formatInvoiceDate`); see the reasoning there.
    // Defaulting to false keeps every existing formatter unchanged.
    //
    // ⚠️ It appends `-u-nu-latn` rather than merely skipping `numeralLocale`.
    // Skipping is NOT enough: Arabic locales default to the `arab` numbering
    // system on their own, so a bare `ar-SY` still renders «١ أيلول ٢٠٢٦». That
    // was a real bug in this function's first version, caught by a test that
    // asserted the absence of Arabic-Indic digits.
    latinDigits = false,
): string {
    try {
        const locale = latinDigits ? `${lang}-u-nu-latn` : numeralLocale(lang);
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
    // Two locale substitutions, both matching the house invoice
    // (JW24-2026-0001, issued by hand 2026-08-08):
    //
    //  • `ar` → `ar-SY`: LEVANTINE month names. Bare `ar` gives «8 أغسطس 2026»,
    //    but the invoice says «8 آب 2026», which is what our Syrian and Lebanese
    //    customers read as a date. This is a document convention, so it is NOT
    //    generalised to the rest of the product's Arabic surfaces.
    //  • `en` → `en-GB`: day-first. Bare `en` gives US order
    //    ("September 1, 2026"), read as an error by customers in the Middle
    //    East and Europe, and it would disagree with the Arabic side's shape.
    const locale = lang === 'ar' ? 'ar-SY' : lang === 'en' ? 'en-GB' : lang;
    return formatWith(d, locale, { day: 'numeric', month: 'long', year: 'numeric' }, 10, true);
}
