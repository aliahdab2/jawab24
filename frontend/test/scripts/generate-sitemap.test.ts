import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// generate-sitemap.js is a dependency-free CommonJS script (run via `node` in
// pre-deploy). Import it through createRequire so the TS test can exercise it.
const require = createRequire(import.meta.url);

interface Page { path: string; label: string; lastmod: string; changefreq: string; priority: string }

const { generateSitemap, collectPages, buildSitemap } = require('../../scripts/generate-sitemap.js') as {
  generateSitemap: (pages: Page[], opts?: { prodOrigin?: string }) => string;
  collectPages: (dataDir?: string) => Page[];
  buildSitemap: (dataDir?: string) => string;
};
const { entriesFromDataFile } = require('../../scripts/lib/dataSlugs.js') as {
  entriesFromDataFile: (dataDir: string, file: string) => { slug: string; date: string | null; updated: string | null }[] | null;
};

const here = dirname(fileURLToPath(import.meta.url));
const COMMITTED = readFileSync(resolve(here, '../../public/sitemap.xml'), 'utf-8');

/** A throwaway src/data dir holding the given blog-posts.ts / competitors.ts / integrations.ts sources. */
function fakeDataDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sitemap-data-'));
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src);
  return dir;
}

const EMPTY = { 'competitors.ts': 'export const X = {};', 'integrations.ts': 'export const X = {};' };

describe('generate-sitemap', () => {
  it('the committed sitemap is exactly what the data modules produce (regenerate after a date change)', () => {
    // The pre-deploy gate runs `--check` with this same comparison; pinning it
    // here means a forgotten regeneration fails `npm test` too, not only a deploy.
    expect(COMMITTED).toBe(buildSitemap());
  });

  it('reads slug, date and updated from a data module, one record per entry', () => {
    const dir = fakeDataDir({
      'blog-posts.ts': `
        export const BLOG_POSTS = [
          { slug: 'revised', date: '2026-03-18', updated: '2026-08-14', category: 'guides', readingTime: 8 },
          { slug: 'fresh', date: '2026-07-09', category: 'guides', readingTime: 5 },
        ];`,
    });
    expect(entriesFromDataFile(dir, 'blog-posts.ts')).toEqual([
      { slug: 'revised', date: '2026-03-18', updated: '2026-08-14' },
      { slug: 'fresh', date: '2026-07-09', updated: null },
    ]);
  });

  it('uses `updated` as <lastmod> when present, else `date`', () => {
    const dir = fakeDataDir({
      ...EMPTY,
      'blog-posts.ts': `[
        { slug: 'revised', date: '2026-03-18', updated: '2026-08-14' },
        { slug: 'fresh', date: '2026-07-09' },
      ]`,
    });
    const pages = collectPages(dir);
    expect(pages.find(p => p.path === '/blog/revised')?.lastmod).toBe('2026-08-14');
    expect(pages.find(p => p.path === '/blog/fresh')?.lastmod).toBe('2026-07-09');
  });

  it('dates the blog index by its newest post, so the listing is re-crawled whenever a post changes', () => {
    const dir = fakeDataDir({
      ...EMPTY,
      'blog-posts.ts': `[
        { slug: 'old', date: '2026-03-18' },
        { slug: 'revised', date: '2026-03-18', updated: '2026-08-14' },
        { slug: 'mid', date: '2026-07-09' },
      ]`,
    });
    expect(collectPages(dir).find(p => p.path === '/blog')?.lastmod).toBe('2026-08-14');
  });

  it('refuses an entry with no parseable date — the regex extraction must fail loudly, not drop dates', () => {
    const dir = fakeDataDir({
      ...EMPTY,
      'blog-posts.ts': `[{ slug: 'undated', category: 'guides' }]`,
    });
    expect(() => collectPages(dir)).toThrow(/undated.*date/);
  });

  it('refuses an `updated` earlier than `date`', () => {
    const dir = fakeDataDir({
      ...EMPTY,
      'blog-posts.ts': `[{ slug: 'backwards', date: '2026-07-09', updated: '2026-03-18' }]`,
    });
    expect(() => collectPages(dir)).toThrow(/backwards.*before/);
  });

  it('emits an AR and an EN <url> per page with the full hreflang triplet', () => {
    const xml = generateSitemap([
      { path: '/compare/acme', label: 'Compare: acme', lastmod: '2026-08-14', changefreq: 'monthly', priority: '0.8' },
    ]);
    expect(xml).toContain('<loc>https://jawab24.com/compare/acme</loc>');
    expect(xml).toContain('<loc>https://jawab24.com/en/compare/acme</loc>');
    expect(xml.match(/<lastmod>2026-08-14<\/lastmod>/g)).toHaveLength(2);
    expect(xml.match(/hreflang="x-default" href="https:\/\/jawab24.com\/compare\/acme"/g)).toHaveLength(2);
  });

  it('maps the homepage to / and /en (no trailing slash on the EN root)', () => {
    const xml = generateSitemap([
      { path: '/', label: 'Homepage', lastmod: '2026-07-28', changefreq: 'weekly', priority: '1.0' },
    ]);
    expect(xml).toContain('<loc>https://jawab24.com/</loc>');
    expect(xml).toContain('<loc>https://jawab24.com/en</loc>');
    expect(xml).not.toContain('https://jawab24.com/en/</loc>');
  });
});
