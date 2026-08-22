#!/usr/bin/env node

/**
 * Sitemap generator for Jawab24 — the single source of `public/sitemap.xml`.
 *
 * Until 2026-08-22 the sitemap was hand-typed, so a `<lastmod>` only ever
 * changed when a URL was *added*: the comparison pages rewritten on 2026-08-14
 * still said 2026-03-08, and `scripts/indexnow-ping.sh` — which submits only
 * URLs whose `<lastmod>` falls inside its window — never told Bing about them.
 * Every data-driven URL now takes its `<lastmod>` from the `date` / `updated`
 * literals in its data module (src/data/contentDates.ts documents the fields),
 * so revising a page and regenerating is all it takes to get it re-crawled.
 *
 * Usage:  node scripts/generate-sitemap.js          # rewrite public/sitemap.xml
 *         node scripts/generate-sitemap.js --check  # exit 1 if the committed file is stale
 *
 * `validate-sitemap.js` stays the gate (check 7 there fails on any data-driven
 * `<lastmod>` that disagrees with the data); this script is how you fix it.
 */

const fs = require('fs');
const path = require('path');
const { entriesFromDataFile, entryLastModified } = require('./lib/dataSlugs');

const PROD_ORIGIN = 'https://jawab24.com';
const SITEMAP_PATH = path.join(__dirname, '..', 'public', 'sitemap.xml');
const DATA_DIR = path.join(__dirname, '..', 'src', 'data');

// Pages with no data module behind them. Their `lastmod` is hand-maintained
// here — bump it when the page's CONTENT changes, not on every deploy.
//
// Only canonical, indexable URLs belong here (sitemaps.org / Google's sitemap
// guidelines): /login is a utility page the validator itself excludes, so it is
// deliberately absent. <changefreq> and <priority> are not emitted — Google
// documents that it ignores both, and a value nobody reads is a value nobody
// maintains.
const STATIC_PAGES = [
  { path: '/', label: 'Homepage', lastmod: '2026-07-28' },
  { path: '/pricing', label: 'Pricing', lastmod: '2026-07-28' },
  { path: '/privacy', label: 'Privacy', lastmod: '2026-05-08' },
  { path: '/terms', label: 'Terms', lastmod: '2026-05-08' },
  { path: '/contact', label: 'Contact', lastmod: '2026-05-08' },
  { path: '/help', label: 'Help Center', lastmod: '2026-07-01' },
  { path: '/what-is-jawab24', label: 'What is Jawab24', lastmod: '2026-03-08' },
  { path: '/trust', label: 'Trust & Reliability', lastmod: '2026-08-19' },
  { path: '/instagram', label: 'Instagram integration', lastmod: '2026-08-16' },
  { path: '/data-deletion', label: 'Data Deletion', lastmod: '2026-05-08' },
  { path: '/compare', label: 'Compare hub', lastmod: '2026-05-31' },
];

// Sections whose URLs and dates come from a `src/data/*.ts` module. Order is
// the order in the file; `indexPath` adds a listing page whose lastmod is the
// newest of its entries (the blog index changes whenever any post does).
const DATA_SECTIONS = [
  { file: 'competitors.ts', base: '/compare', label: 'Compare' },
  { file: 'integrations.ts', base: '/integrations', label: 'Integration' },
  { file: 'blog-posts.ts', base: '/blog', label: 'Blog', indexPath: '/blog', indexLabel: 'Blog Index' },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** One `<url>` block for one locale of a page, with the AR/EN/x-default hreflang triplet. */
function urlBlock({ path: pagePath, label, lastmod }, locale, prodOrigin) {
  const ar = `${prodOrigin}${pagePath}`;
  const en = `${prodOrigin}/en${pagePath === '/' ? '' : pagePath}`;
  const loc = locale === 'en' ? en : ar;
  return [
    `  <!-- ${escapeXml(label)} - ${locale === 'en' ? 'English' : 'Arabic'} -->`,
    '  <url>',
    `    <loc>${loc}</loc>`,
    `    <xhtml:link rel="alternate" hreflang="ar" href="${ar}"/>`,
    `    <xhtml:link rel="alternate" hreflang="en" href="${en}"/>`,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${ar}"/>`,
    `    <lastmod>${lastmod}</lastmod>`,
    '  </url>',
  ].join('\n');
}

/**
 * Resolve the data-driven pages. Throws on a missing module or an entry with no
 * parseable `date:` — the extraction is regex-based, so a data module written in
 * a shape it cannot read must fail here, not silently drop its dates.
 */
function collectPages(dataDir = DATA_DIR) {
  const pages = [];
  for (const section of DATA_SECTIONS) {
    const entries = entriesFromDataFile(dataDir, section.file);
    if (!entries) throw new Error(`${section.file} not found under ${dataDir}`);
    const sectionPages = entries.map((entry) => {
      const lastmod = entryLastModified(entry);
      if (!lastmod || !DATE_RE.test(lastmod)) {
        throw new Error(`${section.file}: "${entry.slug}" has no YYYY-MM-DD date: — every entry needs a publish date (see src/data/contentDates.ts)`);
      }
      if (entry.updated && entry.date && entry.updated < entry.date) {
        throw new Error(`${section.file}: "${entry.slug}" has updated (${entry.updated}) before date (${entry.date})`);
      }
      return {
        path: `${section.base}/${entry.slug}`,
        label: `${section.label}: ${entry.slug}`,
        lastmod,
      };
    });
    if (section.indexPath) {
      const newest = sectionPages.map(p => p.lastmod).sort().at(-1);
      pages.push({ path: section.indexPath, label: section.indexLabel, lastmod: newest });
    }
    pages.push(...sectionPages);
  }
  return pages;
}

/** Render the full sitemap. Pure — `pages` is the page list, so tests need no filesystem. */
function generateSitemap(pages, opts = {}) {
  const prodOrigin = opts.prodOrigin || PROD_ORIGIN;
  const blocks = [];
  for (const page of pages) {
    blocks.push(urlBlock(page, 'ar', prodOrigin));
    blocks.push(urlBlock(page, 'en', prodOrigin));
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- GENERATED by scripts/generate-sitemap.js — do not edit by hand. -->',
    '<!-- Static pages: edit STATIC_PAGES in that script. Blog / compare / integration',
    '     dates come from src/data/*.ts (date / updated). Run: npm run sitemap:generate -->',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    '',
    blocks.join('\n\n'),
    '</urlset>',
    '',
  ].join('\n');
}

/** The sitemap the current data produces. */
function buildSitemap(dataDir = DATA_DIR) {
  return generateSitemap([...STATIC_PAGES, ...collectPages(dataDir)]);
}

module.exports = { generateSitemap, collectPages, buildSitemap, STATIC_PAGES, DATA_SECTIONS };

// ── CLI ───────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const check = process.argv.includes('--check');
  let xml;
  try {
    xml = buildSitemap();
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
  const current = fs.existsSync(SITEMAP_PATH) ? fs.readFileSync(SITEMAP_PATH, 'utf-8') : null;
  const entryCount = (xml.match(/<url>/g) || []).length;

  if (check) {
    if (current === xml) {
      console.log(`Sitemap is current — ${entryCount} entries match the data modules.`);
      process.exit(0);
    }
    console.error('public/sitemap.xml is STALE — a page date changed (or a page was added) without regenerating.');
    console.error('Run `npm run sitemap:generate` in frontend/ and commit the result.');
    process.exit(1);
  }

  if (current === xml) {
    console.log(`Sitemap already current — ${entryCount} entries.`);
  } else {
    fs.writeFileSync(SITEMAP_PATH, xml);
    console.log(`Wrote public/sitemap.xml — ${entryCount} entries.`);
  }
  process.exit(0);
}
