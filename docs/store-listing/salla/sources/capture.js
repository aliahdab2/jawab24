/*
 * Capture the three raw app screenshots for the Salla App Store gallery.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The 2026-07-18 gallery was rendered from `raw-*.png` files that were never
 * committed. When the owner asked for a re-shoot with realistic names on
 * 2026-09-03, `node render.js` could not help — the app captures underneath the
 * frames were gone, and the shoot had to be rebuilt from nothing. So the capture
 * itself is now a script in the repo, and the raws are committed beside it.
 *
 * WHAT IT DOES
 *   reset the scratch database → demo login (which seeds) → prune to ONE Salla
 *   merchant → refresh the client's auth snapshot from the server's own /auth/me
 *   → shoot three screens.
 *
 * The login is a real login, so the session cookies are real signed cookies —
 * nothing is forged, and every pixel is the app rendering real API responses.
 * The `merchant` staging step edits DATA in a throwaway database; it does not
 * touch the DOM.
 *
 * PREREQUISITES
 *   1. A scratch database, migrated and with plans seeded:
 *        createdb jawab24_salla_shots
 *        cd backend && DATABASE_URL=<scratch> npx tsx src/migrate.ts
 *        cd backend && DATABASE_URL=<scratch> npx tsx src/scripts/seed-plans.ts
 *   2. The worktree stack running against it (ports are the Rule 18 worktree band):
 *        backend    PORT=3200 AI_SERVICE_URL=http://localhost:3202 DATABASE_URL=<scratch>
 *        ai-worker  PORT=3202
 *        frontend   NEXT_PUBLIC_API_URL=http://localhost:3200 npm run dev -- -p 3201
 *      The ai-worker must be up: gallery-2 is a REAL model reply, not a mock.
 *   3. DEMO_MODE_ENABLED=true in backend/.env (it is, in the checked-in dev env).
 *
 * RUN
 *   node docs/store-listing/salla/sources/capture.js
 *   node docs/store-listing/salla/sources/render.js     # frames the raws
 *   cp sources/gallery-*.png ..                          # publish
 *
 * Override SHOT_BASE / SHOT_API / SHOT_DATABASE_URL if your ports differ.
 */
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '../../../..');
const { chromium } = require(path.join(REPO, 'node_modules/playwright'));

const BASE = process.env.SHOT_BASE || 'http://localhost:3201';
const API = process.env.SHOT_API || 'http://localhost:3200';
const OUT = __dirname;
const STAGE = path.join(__dirname, 'stage.sh');

const stage = (arg) => console.log(execFileSync('bash', [STAGE, arg], { encoding: 'utf-8' }).trim());

/** Dev-server chrome is not product UI. */
const HIDE = 'nextjs-portal, [data-nextjs-toast] { display: none !important; }';

async function main() {
  stage('reset');

  const browser = await chromium.launch();
  const context = await browser.newContext({
    // 1366x768 is the gallery frame's own aspect AND a real laptop size. Captured
    // any wider, the app UI is scaled down into the frame's 1160px window and the
    // text reads tiny — that is what a 1600px first attempt produced.
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 2.5,
    locale: 'ar',
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/ar/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('button', { hasText: 'الوضع التجريبي' }).first().click();
  await page.waitForURL('**/dashboard', { timeout: 120000 });
  await page.waitForTimeout(3000);

  stage('merchant');

  // The login snapshot in localStorage is now stale — zustand persists `user` and
  // does NOT re-read it on navigation. Refresh it from the server's own /auth/me
  // rather than hand-writing values: the store then holds exactly what the API says.
  await page.evaluate(async (api) => {
    const me = await (await fetch(`${api}/auth/me`, { credentials: 'include' })).json();
    const ws = await (await fetch(`${api}/workspaces`, { credentials: 'include' })).json();
    localStorage.setItem('auth-storage', JSON.stringify({
      state: { user: me, isAuthenticated: true, workspaces: ws, activeWorkspaceId: ws[0]?.id ?? null, _hasHydrated: true },
      version: 0,
    }));
  }, API);

  const shot = async (name, url, prepare) => {
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: HIDE });
    await page.waitForTimeout(1500);
    if (prepare) await prepare(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, name) });
    console.log('captured', name);
  };

  await shot('raw-stores.png', '/ar/integrations');

  await shot('raw-comments.png', '/ar/comments', async (p) => {
    // Land on the auto-replied tab: the caption is «يرد على تعليقات فيسبوك وإنستغرام
    // تلقائياً», so the shot must show replies, not a backlog of unanswered comments.
    await p.locator('button', { hasText: 'تم الرد تلقائياً' }).first().click();
    await p.waitForTimeout(1500);
  });

  await shot('raw-testreply.png', '/ar/pages', async (p) => {
    await p.locator('button', { hasText: 'اختبار الرد الذكي' }).first().click();
    await p.waitForTimeout(1500);
    const box = p.locator('textarea').last();
    await box.fill('السلام عليكم، كم سعر العباية السوداء؟ وهل متوفر مقاس M؟');
    await p.keyboard.press('Enter');
    // A real OpenAI round trip through the local ai-worker (~4 s observed; the wait
    // is generous because a cold worker is slower than a warm one).
    await p.waitForTimeout(20000);
  });

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
