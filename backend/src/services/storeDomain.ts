/**
 * Canonical shape of `ecommerce_stores.store_domain`, and the one way to turn
 * it back into a URL.
 *
 * The column is an IDENTITY: it is half of the unique key `(platform,
 * store_domain)`, the ON CONFLICT target of `createStore`, and what
 * `getStoreByDomain` / `deactivateStore` / `purgeStore` look up by. So the value
 * must be canonical at the border, once, and every reader must build URLs from
 * it the same way — never by prefixing `https://` inline.
 *
 * Why this exists (2026-08-23): Salla's `store/info.domain` is a FULL URL, and
 * for demo/development stores it carries a PATH
 * (`https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw`). It was stored verbatim,
 * and the catalog block then rendered `Store: https://https://demostore…` —
 * which the model handed to a customer. Shopify validates a bare
 * `*.myshopify.com` host at its OAuth border, Zid reduces its URL to a hostname
 * (`zid.ts`), Salla had nothing.
 *
 * Canonical form: `host[/path]` — scheme stripped, host lower-cased, path kept
 * byte-for-byte (Salla demo-store paths are case-sensitive slugs), no trailing
 * slash. A hostname-only reduction (Zid's) would lose the path and point every
 * link at the platform's landing page.
 *
 * Dependency-free on purpose: `salla.ts` imports it, and `salla.test.ts` mocks
 * `./ecommerce` with an explicit factory — a helper living there would be
 * `undefined` under that mock.
 */

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function normalizeStoreDomain(raw: string): string {
    const trimmed = raw.trim().replace(SCHEME, '');
    const slash = trimmed.indexOf('/');
    const host = (slash < 0 ? trimmed : trimmed.slice(0, slash)).toLowerCase();
    const path = slash < 0 ? '' : trimmed.slice(slash).replace(/\/+$/, '');
    return host + path;
}

/**
 * `https://` + the canonical domain. Tolerant of a value that still carries a
 * scheme (a row written before normalisation existed) so no reader can ever
 * double it again; never strips anything else.
 */
export function storeBaseUrl(storeDomain: string): string {
    return `https://${normalizeStoreDomain(storeDomain)}`;
}
