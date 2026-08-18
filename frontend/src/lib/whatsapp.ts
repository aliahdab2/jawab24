/**
 * Shared WhatsApp deep-link helpers.
 *
 * The same `https://wa.me/<digits>?text=<encoded>` pattern is used by the
 * top-up modal, the payments-unavailable notice, the floating help button,
 * and the landing footer — keep it in one place so any future change
 * (link format, query params, number format) is a single edit.
 *
 * DEPENDENCY-FREE ON PURPOSE. Ten of this module's eleven consumers are
 * public pages (landing footer, 404/500, pricing, sanctioned-country notice)
 * that need nothing but a wa.me string. It previously imported PHONE_REGEX
 * from '@jawab24/shared' for one E.164 check — and because that package is
 * CommonJS, webpack cannot tree-shake it, so a single regex dragged zod +
 * libphonenumber-js (66.1 kB gzip) onto every one of those pages. The
 * normaliser that needed it now lives in '@/utils/phone', beside the other
 * libphonenumber-backed helpers. Keep this file free of package imports.
 */

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
