/**
 * Shared WhatsApp deep-link helpers.
 *
 * The same `https://wa.me/<digits>?text=<encoded>` pattern is used by the
 * top-up modal, the payments-unavailable notice, the floating help button,
 * and the landing footer — keep it in one place so any future change
 * (link format, query params, number format) is a single edit.
 */

import { PHONE_REGEX } from '@jawab24/shared';

/** Public default support number (Sweden +46). Hardcoded historically; envable later. */
export const DEFAULT_SUPPORT_WHATSAPP_NUMBER = '46700224720';

/**
 * Build a wa.me deep link. Strips non-digits from the number (supports
 * inputs like `+46 700 224 720`). Returns an empty string when the input
 * has no digits at all — callers should treat that as "WhatsApp unavailable"
 * and hide the link rather than render an invalid URL.
 *
 * `message` is optional: when omitted/empty the link carries no `?text=`
 * (used by the Post Reply WhatsApp button, which is number-only by design).
 */
export function buildWhatsAppUrl(number: string, message?: string): string {
    const cleaned = number.replace(/[^0-9]/g, '');
    if (!cleaned) return '';
    return message
        ? `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`
        : `https://wa.me/${cleaned}`;
}

/**
 * Extract the phone digits from a wa.me link (`https://wa.me/<digits>[?…]`),
 * or null when the URL isn't a wa.me deep link. Inverse of buildWhatsAppUrl —
 * used by the Post Reply modal to reopen a stored WhatsApp button in
 * phone-number editing mode instead of showing the raw URL.
 */
export function extractWhatsAppNumber(url: string): string | null {
    try {
        const u = new URL(url);
        if (u.protocol !== 'https:' || u.hostname !== 'wa.me') return null;
        const digits = u.pathname.replace(/^\//, '');
        // Same bound as PHONE_REGEX (E.164: leading 1-9, then 1–14 more) so a number
        // buildWhatsAppUrl accepted always round-trips back through extract.
        return /^[1-9]\d{1,14}$/.test(digits) ? digits : null;
    } catch {
        return null;
    }
}

/**
 * Normalize a merchant-typed phone number to E.164 (`+<country><number>`), or
 * null when it can't be a valid international number. Accepts the messy forms
 * merchants actually paste — `+963 944 123 456`, `00963-944123456`,
 * `963944123456` — but rejects local formats (leading 0 without a country
 * code), because wa.me requires the country code. Validation itself is the
 * shared E.164 rule (PHONE_REGEX) so frontend and backend can't drift.
 */
export function normalizeInternationalPhone(input: string): string | null {
    let v = input.trim().replace(/[\s\-().]/g, '');
    if (v.startsWith('00')) v = `+${v.slice(2)}`;
    else if (/^[1-9]\d+$/.test(v)) v = `+${v}`;
    return PHONE_REGEX.test(v) ? v : null;
}
