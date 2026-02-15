/**
 * Live Site Screenshot Script
 *
 * Captures full-page screenshots from jawab24.com in multiple viewports
 * and both languages. Output goes to ~/Downloads/jawab24-screenshots/<page>/
 *
 * Usage:
 *   node scripts/screenshots/live.mjs                   # all public pages
 *   node scripts/screenshots/live.mjs --page pricing    # just pricing
 *   node scripts/screenshots/live.mjs --page landing    # just landing
 *   node scripts/screenshots/live.mjs --page pricing,landing  # multiple
 */

import { chromium } from 'playwright';
import path from 'path';
import { mkdirSync } from 'fs';

const BASE_URL = 'https://jawab24.com';

const OUT_ROOT = path.join(process.env.HOME, 'Downloads', 'jawab24-screenshots');

const VIEWPORTS = [
  { name: 'desktop-1280',     width: 1280, height: 800 },
  { name: 'desktop-1920',     width: 1920, height: 1080 },
  { name: 'tablet-portrait',  width: 768,  height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'mobile-portrait',  width: 390,  height: 844 },
  { name: 'mobile-landscape', width: 844,  height: 390 },
];

const LANGUAGES = ['en', 'ar'];

const ALL_PAGES = [
  { name: 'landing',  path: '' },
  { name: 'pricing',  path: '/pricing' },
  { name: 'login',    path: '/login' },
  { name: 'terms',    path: '/terms' },
  { name: 'privacy',  path: '/privacy' },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const pageFlag = args.indexOf('--page');

  if (pageFlag === -1) return ALL_PAGES;

  const value = args[pageFlag + 1];
  if (!value) {
    console.error('Error: --page requires a value (e.g. --page pricing)');
    process.exit(1);
  }

  const requested = value.split(',').map(s => s.trim());
  const filtered = ALL_PAGES.filter(p => requested.includes(p.name));

  if (filtered.length === 0) {
    console.error(`Error: no matching pages for "${value}". Available: ${ALL_PAGES.map(p => p.name).join(', ')}`);
    process.exit(1);
  }

  return filtered;
}

async function run() {
  const pages = parseArgs();
  const browser = await chromium.launch();
  let count = 0;

  for (const pg of pages) {
    const outDir = path.join(OUT_ROOT, pg.name);
    mkdirSync(outDir, { recursive: true });

    for (const vp of VIEWPORTS) {
      for (const lang of LANGUAGES) {
        const url = `${BASE_URL}/${lang}${pg.path}`;
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
        });
        const page = await context.newPage();

        console.log(`  ${lang} ${pg.name} @ ${vp.name} (${vp.width}x${vp.height})`);

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(4000);

        const filename = `${pg.name}-${lang}-${vp.name}.png`;
        await page.screenshot({
          path: path.join(outDir, filename),
          fullPage: true,
        });

        count++;
        await context.close();
      }
    }
  }

  await browser.close();
  console.log(`\nDone! ${count} screenshots saved to: ~/Downloads/jawab24-screenshots/`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
