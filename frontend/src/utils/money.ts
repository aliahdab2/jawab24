/**
 * Money formatting + parsing shared between the catalog UI, pricing pages,
 * checkout flow, and admin screens. Prevents the `priceMinor / 100` divide
 * from being inlined a 7th, 8th, ... time and ensures locale-tolerant
 * parsing on input (accepts both "29.99" and "29,99").
 *
 * `priceMinor` is the canonical wire format: integer minor units (cents).
 * `Text` is what merchants type or see in inputs.
 */

/**
 * Convert minor-units integer to a plain decimal string suitable for
 * <input> `value`. Returns "" for null/undefined so the field reads as
 * empty, not "0". Drops trailing zeros for cleaner display ("19" not "19.00").
 */
export function priceMinorToText(priceMinor: number | null | undefined): string {
    if (priceMinor == null) return '';
    const amount = priceMinor / 100;
    // Integer amounts → no decimal. Otherwise show up to 2 places.
    return amount % 1 === 0 ? String(amount) : amount.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Parse merchant-typed text into a minor-units integer. Accepts both `.` and
 * `,` as decimal separators (Arabic / European locales). Returns null for
 * empty input or anything that doesn't parse to a non-negative finite
 * number — callers treat null as "no price set", not as an error.
 */
export function parseMoneyToPriceMinor(text: string): number | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    // Normalize locale comma decimal separator → period for Number().
    const normalized = trimmed.replace(',', '.');
    const num = Number(normalized);
    if (!Number.isFinite(num) || num < 0) return null;
    return Math.round(num * 100);
}

/**
 * Format `priceMinor` + currency for display in cards / receipts. Uses the
 * Intl.NumberFormat currency style for proper locale-aware symbols
 * ("SAR 500" in en-US, "٥٠٠٫٠٠ ر.س." in ar-SA). Returns null if the price
 * is unset or currency is missing — caller decides whether to show a
 * "contact for price" fallback.
 */
export function formatPrice(
    priceMinor: number | null | undefined,
    currency: string | null | undefined,
    locale: string,
): string | null {
    if (priceMinor == null || !currency) return null;
    const amount = priceMinor / 100;
    try {
        return new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en', {
            style: 'currency',
            currency,
            maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
        }).format(amount);
    } catch {
        return `${amount} ${currency}`;
    }
}
