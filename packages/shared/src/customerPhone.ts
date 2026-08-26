/**
 * Customer-phone normalization for outbound messaging.
 *
 * NOT the merchant-facing `businessPhone.ts` normalizer — that one parses
 * merchant-typed Business Info entries. This one prepares a phone we received
 * from an e-commerce order webhook (Salla/Zid/Shopify) for a messaging provider.
 *
 * The WhatsApp Cloud API identifies recipients the way its own webhooks do:
 * `contacts[].wa_id` / `messages[].from` are digits-only international numbers
 * with no `+`, no spaces and no separators (e.g. `966501234567`). Order webhooks
 * hand us the same number in looser shapes, so normalize once, here, instead of
 * at each send site (the SMS path does its own `+`-strip in `sms.ts` for Vonage).
 */

/** Arabic-Indic and Extended Arabic-Indic digits → ASCII. Order matters: index = value. */
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Shortest plausible international number (country code + subscriber). */
const MIN_INTERNATIONAL_DIGITS = 8;
/** E.164 caps the whole number at 15 digits. */
const MAX_INTERNATIONAL_DIGITS = 15;

/**
 * Normalize a customer phone for the WhatsApp Cloud API: digits only, no `+`.
 *
 * Returns `undefined` when the value cannot be a dialable international number,
 * so callers fail loudly (a visible skip) instead of handing Meta a malformed
 * recipient and reading back an opaque error.
 *
 * ⚠️ A LOCAL number (leading `0`, no country code) cannot be repaired here —
 * guessing a country code would silently message a stranger. Such numbers are
 * rejected; the caller reports why.
 */
export function normalizeCustomerPhoneForWhatsApp(phone: string | null | undefined): string | undefined {
    if (!phone) return undefined;

    let digits = '';
    for (const char of phone.trim()) {
        const arabicIndex = ARABIC_INDIC_DIGITS.indexOf(char);
        if (arabicIndex >= 0) { digits += String(arabicIndex); continue; }
        const extendedIndex = EXTENDED_ARABIC_INDIC_DIGITS.indexOf(char);
        if (extendedIndex >= 0) { digits += String(extendedIndex); continue; }
        if (char >= '0' && char <= '9') digits += char;
    }

    // `00` is the international access prefix — the same number as `+`.
    if (digits.startsWith('00')) digits = digits.slice(2);

    // A leading zero that survived is a national trunk prefix: the country code
    // is missing and unknowable from the number alone.
    if (digits.startsWith('0')) return undefined;

    if (digits.length < MIN_INTERNATIONAL_DIGITS || digits.length > MAX_INTERNATIONAL_DIGITS) return undefined;

    return digits;
}
