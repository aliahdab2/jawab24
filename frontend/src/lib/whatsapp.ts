/**
 * Shared WhatsApp deep-link helpers.
 *
 * The same `https://wa.me/<digits>?text=<encoded>` pattern is used by the
 * top-up modal, the payments-unavailable notice, the floating help button,
 * and the landing footer — keep it in one place so any future change
 * (link format, query params, number format) is a single edit.
 */

/** Public default support number (Sweden +46). Hardcoded historically; envable later. */
export const DEFAULT_SUPPORT_WHATSAPP_NUMBER = '46700224720';

/**
 * Build a wa.me deep link. Strips non-digits from the number (supports
 * inputs like `+46 700 224 720`). Returns an empty string when the input
 * has no digits at all — callers should treat that as "WhatsApp unavailable"
 * and hide the link rather than render an invalid URL.
 */
export function buildWhatsAppUrl(number: string, message: string): string {
    const cleaned = number.replace(/[^0-9]/g, '');
    if (!cleaned) return '';
    return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}
