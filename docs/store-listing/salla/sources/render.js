/* Render final PNGs at exact pixel sizes (deviceScaleFactor 1). */
const { chromium } = require('/Users/aliahdab/Documents/AutoReply/node_modules/playwright');
const path = require('path');
const OUT = __dirname;

const jobs = [
  { html: 'icon.html', out: 'icon-512.png', w: 512, h: 512, transparent: true },
  { html: 'gallery-1.html', out: 'gallery-1.png', w: 1366, h: 768 },
  { html: 'gallery-2.html', out: 'gallery-2.png', w: 1366, h: 768 },
  { html: 'gallery-3.html', out: 'gallery-3.png', w: 1366, h: 768 },
  { html: 'benefit-1.html', out: 'benefit-1.png', w: 1600, h: 1600 },
  { html: 'benefit-2.html', out: 'benefit-2.png', w: 1600, h: 1600 },
  { html: 'benefit-3.html', out: 'benefit-3.png', w: 1600, h: 1600 },
];

(async () => {
  const browser = await chromium.launch();
  for (const j of jobs) {
    const page = await browser.newPage({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 1 });
    await page.goto('file://' + path.join(OUT, j.html));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, j.out), omitBackground: !!j.transparent });
    await page.close();
    console.log('rendered', j.out);
  }
  await browser.close();
})();
