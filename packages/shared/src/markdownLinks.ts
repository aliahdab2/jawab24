/**
 * Markdown link/image syntax → plain text, for channels that render none of it.
 *
 * Messenger, Instagram and WhatsApp show `[label](url)` and `![alt](url)` as
 * literal brackets. The model never produced them until real storefront links
 * entered its catalog block (D-097, 2026-08-23): the same afternoon 4 of the
 * Salla page's 82 replies carried them — `![فستان](https://…/p348732197)`, a
 * "picture" that was a product page in image syntax — against 0 in the other
 * 40,181 AI replies of the month. This is the deterministic boundary fix:
 * applied once at the backend's reply dispatch, it holds for any model and any
 * prompt, and costs nothing to a reply that carries no markdown.
 *
 *   `![alt](url)`   → `url`          (the customer can open it; the "alt" was
 *                                     the model's caption for an image it does
 *                                     not have — the product card carries the
 *                                     real picture)
 *   `[label](url)`  → `label: url`   (`url` alone when the label IS the url)
 *
 * Deliberately narrow: links and images only, the two shapes measured in
 * production. Emphasis/headings are not touched — they were not observed, and
 * stripping `*` would damage legitimate text (prices like «3*2»).
 */

/** A URL inside `(…)`: no whitespace, no closing paren (Arabic paths are fine). */
const MD_IMAGE_RE = /!\[([^\]]*)\]\(\s*(https?:\/\/[^\s)]+)\s*\)/g;
const MD_LINK_RE = /\[([^\]]+)\]\(\s*(https?:\/\/[^\s)]+)\s*\)/g;

export function stripMarkdownLinks(text: string): string {
    if (!text || text.indexOf('](') === -1) return text;
    return text
        .replace(MD_IMAGE_RE, (_m, _alt: string, url: string) => url)
        .replace(MD_LINK_RE, (_m, label: string, url: string) => {
            const l = label.trim();
            return l === url || l === '' ? url : `${l}: ${url}`;
        });
}
