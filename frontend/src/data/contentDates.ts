/**
 * Publish / revision dates shared by every data-driven public page (blog posts,
 * comparison pages, integration pages).
 *
 * Both fields are plain calendar dates (YYYY-MM-DD). `updated` is the last
 * SUBSTANTIVE revision — facts re-verified, a section added, a claim corrected.
 * Omit it when the page has never been revised, and do NOT bump it for link
 * fixes, terminology sweeps or typo commits: a reader and a search engine both
 * read it as "the information was checked on this date".
 *
 * Readers: the page's JSON-LD `datePublished` / `dateModified`, the visible
 * «آخر تحديث» line, and the sitemap `<lastmod>` (`scripts/generate-sitemap.js`,
 * which parses these literals out of the data modules — regenerate after
 * changing one). Until 2026-08-22 none of those existed, so a comparison page
 * rewritten in August still told Google and Bing it was last touched in March.
 */
export interface ContentDates {
  /** First published. */
  date: string;
  /** Last substantive revision; absent when never revised. */
  updated?: string;
}

/** The date a page's content last changed — `updated` when revised, else the publish date. */
export function contentLastModified(content: ContentDates): string {
  return content.updated ?? content.date;
}
