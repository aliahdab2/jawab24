/**
 * Centralized internal route hrefs. Use these instead of inlining literal paths
 * so renames stay a one-file change.
 *
 * Next.js i18n routing auto-prefixes the active locale — never manually prefix
 * (`/${locale}/pages`) here; that produced `/ar/ar/pages` 404s in the past.
 */

/** Pages list with auto-open Knowledge Base modal for the first thin-KB page. */
export const KB_DEEP_LINK = '/pages?openKb=true';
