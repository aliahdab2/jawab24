/**
 * Shared helper for the SEO validators (validate-sitemap.js, validate-llms.js).
 *
 * Both need the list of slugs a `src/data/*.ts` module generates pages for, and
 * neither can `import` a TS module without a build step — so both read the source
 * and pull the `slug: '...'` literals out. That extraction lives here once rather
 * than being copy-pasted into each validator (AI_INSTRUCTIONS §10.8).
 */

const fs = require('fs');
const path = require('path');

/**
 * Extract quoted `slug: '...'` literals from a data module (no TS import needed).
 * @param {string} dataDir  Directory holding the data modules (src/data).
 * @param {string} fileName e.g. 'competitors.ts'
 * @returns {string[] | null} slugs, or null when the file does not exist.
 */
function slugsFromDataFile(dataDir, fileName) {
  const p = path.join(dataDir, fileName);
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, 'utf-8');
  return [...src.matchAll(/slug:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
}

module.exports = { slugsFromDataFile };
