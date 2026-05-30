/**
 * Stable, Unicode-aware slug for in-article heading anchors (blog table of contents).
 *
 * The previous implementation stripped every non-[A-Za-z0-9_] character, so an
 * Arabic heading lost all of its letters and collapsed to "-": every TOC link
 * pointed at "#-" and none of the in-article jumps worked. This keeps letters and
 * numbers from any script (Arabic included) so each heading gets a unique, readable
 * anchor, and only falls back to a hash when a heading has no slug-able characters
 * at all (e.g. emoji-only).
 *
 * Used by both the TOC builder and the <h2>/<h3> renderers in blog/[slug].tsx, so
 * the generated ids must stay identical on both sides — keep a single source here.
 */

/** Deterministic base36 hash — stable fallback id for headings with no slug-able chars. */
function hashString(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function slugify(text: string): string {
  const slug = text
    .replace(/\*\*/g, '')
    .toLowerCase()
    // Keep letters/numbers from any script (\p{L}\p{N}) plus underscores; drop the rest.
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `section-${hashString(text)}`;
}
