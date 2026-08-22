/**
 * Shared helper for the SEO scripts (validate-sitemap.js, validate-llms.js,
 * generate-sitemap.js).
 *
 * They need the pages a `src/data/*.ts` module generates — and, for the
 * sitemap, when each was published / last revised — and none can `import` a TS
 * module without a build step. So they read the source and pull the literals
 * out. That extraction lives here once rather than being copy-pasted into each
 * script (AI_INSTRUCTIONS §10.8).
 */

const fs = require('fs');
const path = require('path');

/**
 * Extract one record per `slug: '...'` literal in a data module, with the
 * `date:` / `updated:` literals that follow it (see src/data/contentDates.ts).
 *
 * Each entry is the object literal opened by a `slug:` line; its fields are
 * read up to the next `slug:`, so `date` and `updated` must sit in the same
 * literal as their slug — which is how every data module is written.
 *
 * @param {string} dataDir  Directory holding the data modules (src/data).
 * @param {string} fileName e.g. 'competitors.ts'
 * @returns {{ slug: string, date: string | null, updated: string | null }[] | null}
 *          entries, or null when the file does not exist.
 */
function entriesFromDataFile(dataDir, fileName) {
  const p = path.join(dataDir, fileName);
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, 'utf-8');
  const slugMatches = [...src.matchAll(/slug:\s*['"]([^'"]+)['"]/g)];
  return slugMatches.map((m, i) => {
    const start = m.index;
    const end = i + 1 < slugMatches.length ? slugMatches[i + 1].index : src.length;
    const block = src.slice(start, end);
    const field = (name) => {
      const f = block.match(new RegExp(`(?:^|[\\s{,])${name}:\\s*['"]([^'"]+)['"]`));
      return f ? f[1] : null;
    };
    return { slug: m[1], date: field('date'), updated: field('updated') };
  });
}

/**
 * Extract quoted `slug: '...'` literals from a data module (no TS import needed).
 * @param {string} dataDir  Directory holding the data modules (src/data).
 * @param {string} fileName e.g. 'competitors.ts'
 * @returns {string[] | null} slugs, or null when the file does not exist.
 */
function slugsFromDataFile(dataDir, fileName) {
  const entries = entriesFromDataFile(dataDir, fileName);
  return entries ? entries.map(e => e.slug) : null;
}

/** The date an entry's content last changed — `updated` when revised, else `date`. */
function entryLastModified(entry) {
  return entry.updated || entry.date;
}

module.exports = { slugsFromDataFile, entriesFromDataFile, entryLastModified };
