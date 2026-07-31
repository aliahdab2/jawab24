/**
 * Escape a string for safe interpolation into HTML — text nodes AND quoted
 * attribute values (hence `"` and `'`, which text-only escapers omit).
 * Shared because two callers need it: server-rendered emails and the WhatsApp
 * connect handoff page.
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Strips HTML tags and decodes common HTML entities from a string.
 * Used when storing product descriptions fetched from e-commerce platform APIs.
 */
export function stripHtml(html: string): string {
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
