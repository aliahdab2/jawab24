import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// validate-sitemap.js is a dependency-free CommonJS script (run via `node` in CI).
// Import it through createRequire so the TS test can exercise its pure core.
const require = createRequire(import.meta.url);
const { validateSitemap } = require('../../scripts/validate-sitemap.js') as {
  validateSitemap: (
    xml: string,
    opts?: {
      today?: string;
      prodOrigin?: string;
      pagesDir?: string;
      dataDir?: string;
      checkCoverage?: boolean;
    },
  ) => { errors: string[]; entryCount: number };
};

const here = dirname(fileURLToPath(import.meta.url));
const SITEMAP = readFileSync(resolve(here, '../../public/sitemap.xml'), 'utf-8');

// Far-future `today` so the real-file tests never flake on <lastmod> dates.
const OPTS = { today: '2999-12-31' };

/** Drop the <url> block that contains the given <loc> (to simulate a forgotten page). */
function removeUrlBlock(xml: string, loc: string): string {
  const escaped = loc.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp(`\\s*<url>(?:(?!</url>)[\\s\\S])*?<loc>${escaped}</loc>[\\s\\S]*?</url>`, 'g');
  return xml.replace(re, '');
}

describe('validate-sitemap', () => {
  it('passes on the committed sitemap (consistency + full route coverage)', () => {
    const { errors, entryCount } = validateSitemap(SITEMAP, OPTS);
    expect(errors).toEqual([]);
    expect(entryCount).toBeGreaterThan(0);
  });

  it('fails coverage when an indexable route is missing from the sitemap', () => {
    // /compare/speedly is a real index,follow route (compare/[slug] from competitors.ts).
    const broken = removeUrlBlock(
      removeUrlBlock(SITEMAP, 'https://jawab24.com/compare/speedly'),
      'https://jawab24.com/en/compare/speedly',
    );
    const { errors } = validateSitemap(broken, OPTS);

    expect(errors.some(e => e.includes('https://jawab24.com/compare/speedly') && e.includes('missing from sitemap'))).toBe(true);
    expect(errors.some(e => e.includes('https://jawab24.com/en/compare/speedly') && e.includes('missing from sitemap'))).toBe(true);
  });

  it('fails coverage when a static indexable page is missing', () => {
    const broken = removeUrlBlock(SITEMAP, 'https://jawab24.com/pricing');
    const { errors } = validateSitemap(broken, OPTS);
    expect(errors.some(e => e.includes('https://jawab24.com/pricing') && e.includes('route: pricing'))).toBe(true);
  });

  it('does not require auth-gated / noindex routes (e.g. dashboard, login, integrations hub)', () => {
    const { errors } = validateSitemap(SITEMAP, OPTS);
    // These routes exist under src/pages but are intentionally excluded — the
    // validator must not demand them in the sitemap.
    for (const route of ['dashboard', 'login', 'integrations', 'settings']) {
      expect(errors.some(e => e.includes(`route: ${route})`))).toBe(false);
    }
  });

  it('can run consistency checks without coverage (checkCoverage: false)', () => {
    const { errors } = validateSitemap(SITEMAP, { ...OPTS, checkCoverage: false });
    expect(errors).toEqual([]);
  });

  // ── Check 7: data-driven <lastmod> must match the data module ─────────────
  // The defect this guards: the ManyChat comparison was rewritten on 2026-08-14
  // while its hand-typed <lastmod> stayed 2026-03-08, so IndexNow (which only
  // submits URLs changed inside its window) never told Bing.
  it('fails when a data-driven <lastmod> is older than the data module says', () => {
    const stale = SITEMAP.replace(
      /(<loc>https:\/\/jawab24\.com\/compare\/manychat<\/loc>[\s\S]*?<lastmod>)[^<]+/,
      '$12026-03-08',
    );
    expect(stale).not.toBe(SITEMAP); // the mutation must have landed
    const { errors } = validateSitemap(stale, OPTS);
    expect(errors.some(e => e.includes('https://jawab24.com/compare/manychat') && e.includes('disagrees with competitors.ts'))).toBe(true);
  });

  it('fails on the EN twin too — both locales carry the date', () => {
    const stale = SITEMAP.replace(
      /(<loc>https:\/\/jawab24\.com\/en\/blog\/best-auto-reply-tools-2026<\/loc>[\s\S]*?<lastmod>)[^<]+/,
      '$12026-03-18',
    );
    expect(stale).not.toBe(SITEMAP);
    const { errors } = validateSitemap(stale, OPTS);
    expect(errors.some(e => e.includes('/en/blog/best-auto-reply-tools-2026') && e.includes('disagrees with blog-posts.ts'))).toBe(true);
  });

  it('does not second-guess static pages (they have no data module)', () => {
    const bumped = SITEMAP.replace(
      /(<loc>https:\/\/jawab24\.com\/pricing<\/loc>[\s\S]*?<lastmod>)[^<]+/,
      '$12026-01-01',
    );
    expect(bumped).not.toBe(SITEMAP);
    const { errors } = validateSitemap(bumped, OPTS);
    expect(errors.some(e => e.includes('disagrees'))).toBe(false);
  });
});
