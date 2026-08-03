/* Render final PNGs at exact pixel sizes (deviceScaleFactor 1).
 *
 * Run from the repo root checkout (playwright resolves from the root
 * node_modules): `cd docs/store-listing/shopify/sources && node render.js`.
 * From a worktree without node_modules, point NODE_PATH at an installed
 * checkout: `NODE_PATH=<checkout>/node_modules node render.js`.
 *
 * Shot jobs are skipped until their raw capture (raw-<n>-<lang>.png, the
 * unframed 2x app screenshot) exists — so the icon renders on day one and
 * shots join as captures land. Finals land here; move them up one level.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const OUT = __dirname;

/* Shopify spec: icon 1200x1200 no alpha; screenshots 1600x900. */
const jobs = [{ html: 'icon.html', out: 'icon-1200.png', w: 1200, h: 1200 }];
for (let n = 1; n <= 6; n++) {
  for (const lang of ['en', 'ar']) {
    jobs.push({
      html: `shot-${n}-${lang}.html`,
      out: `shot-${n}-${lang}.png`,
      w: 1600,
      h: 900,
      needs: `raw-${n}-${lang}.png`,
    });
  }
}

(async () => {
  const browser = await chromium.launch();
  for (const j of jobs) {
    if (j.needs && !fs.existsSync(path.join(OUT, j.needs))) {
      console.log('skipped', j.out, '(missing', j.needs + ')');
      continue;
    }
    const page = await browser.newPage({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 1 });
    await page.goto('file://' + path.join(OUT, j.html));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, j.out) });
    await page.close();
    console.log('rendered', j.out);
  }
  await browser.close();
})();
