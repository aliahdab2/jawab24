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
 * Decode the named entities our own markup emits, plus the basic five.
 *
 * Order matters and mirrors the original inline chain: `&amp;` resolves first,
 * so a double-encoded `&amp;lt;` still lands on `<`.
 */
function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–')
        .replace(/&middot;/g, '·')
        .replace(/&rsquo;/g, '’')
        .replace(/&lsquo;/g, '‘')
        .replace(/&rdquo;/g, '”')
        .replace(/&ldquo;/g, '“')
        .replace(/&hellip;/g, '…')
        .replace(/&minus;/g, '−');
}

/**
 * Strips HTML tags and decodes common HTML entities from a string.
 * Used when storing product descriptions fetched from e-commerce platform APIs.
 *
 * Collapses ALL whitespace — newlines included — into single spaces, which is
 * right for a one-line product blurb and wrong for anything that has to keep
 * its shape. For that, see `htmlToPlainText` below.
 */
export function stripHtml(html: string): string {
    return decodeHtmlEntities(html.replace(/<[^>]*>/g, ''))
        .replace(/\s+/g, ' ')
        .trim();
}

/** Wraps a parked link index. NUL cannot occur in the markup we generate. */
const SLOT = '\u0000';

/**
 * Render an HTML email body as the `text/plain` alternative part.
 *
 * Not a general-purpose converter: it handles the markup our own templates emit
 * and nothing else. Two things `stripHtml` deliberately does not do, both
 * required here — block elements must become line breaks rather than spaces,
 * and a link's destination has to survive, because a text part that drops every
 * URL is worse to receive than no text part at all.
 *
 * Links are PARKED as placeholders before tags are stripped. Writing
 * `label <href>` inline and stripping afterwards destroys the URL: the angle
 * brackets just written are indistinguishable from a tag to the stripper. That
 * bug was live in the first draft of this function and silently ate every
 * destination in the message.
 */
export function htmlToPlainText(html: string): string {
    const links: string[] = [];

    const parked = html
        .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
        // The preheader is a display:none div holding the inbox preview line.
        // It is chrome, not content, and it usually repeats the opening
        // paragraph verbatim — which reads as a stutter in a text part.
        .replace(/<div\b[^>]*display:\s*none[^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(
            /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
            (_match, href: string, label: string) => {
                const text = decodeHtmlEntities(label.replace(/<[^>]+>/g, '')).trim();
                // A link whose text already IS its destination — a bare support
                // address — reads as noise when printed twice.
                const bare = href.replace(/^mailto:/, '');
                links.push(text && text !== bare ? `${text} <${href}>` : bare);
                return `${SLOT}${links.length - 1}${SLOT}`;
            },
        )
        .replace(/<li\b[^>]*>/gi, '\n  • ')
        .replace(/<br\s*\/?>/gi, '\n')
        // Paragraph-level blocks get a blank line between them; rows and list
        // items get a single break. Relying on the source's own newlines
        // instead would make the spacing a function of template indentation.
        .replace(/<\/(p|h[1-6]|div|table|ul|ol|blockquote)>/gi, '\n\n')
        .replace(/<\/(tr|li)>/gi, '\n')
        .replace(/<[^>]+>/g, '');

    return decodeHtmlEntities(parked)
        .replace(new RegExp(`${SLOT}(\\d+)${SLOT}`, 'g'), (_m, i: string) => links[Number(i)])
        .split('\n')
        .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
