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
const { chromium, expect } = require(path.join(REPO, 'node_modules/@playwright/test'));

/** Cards whose tops are within this many px of each other are one visual row. */
const ROW_TOLERANCE_PX = 40;

/** Ceiling for the latency badge the gallery publishes. Production p50 is 2.72 s
 *  (D-049); this allows headroom for a locally-run worker without advertising a
 *  number worse than a merchant would actually see. */
const MAX_SHOWN_LATENCY_MS = 3500;

/** Re-asks allowed before the shoot gives up. Each one is a real, billed model call. */
const MAX_REPLY_ATTEMPTS = 5;

/** Four+ Arabic letters in a row — a sentence, not a stray character. */
const ARABIC_RUN = /[\u0600-\u06FF]{4,}/;

/** Latin OR Arabic-Indic digits — the model answers «٤٥٠ ريال» as often as «450». */
const PRICE_DIGIT = /[0-9\u0660-\u0669\u06F0-\u06F9]/;

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

  /**
   * Shoot one screen — and REFUSE to shoot a wrong one.
   *
   * Every guard below replaces a comment that used to just describe the trap.
   * Prose does not fail a build: on 2026-09-04 three separate traps each cost a
   * capture round, and each was invisible until someone opened the PNG. A shoot
   * that exits 0 on a spinner, a quota message, or a demo-shaped sidebar is not
   * reproducible — it is repeatable, which is not the same thing.
   */
  const shot = async (name, url, prepare) => {
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: HIDE });

    // The sidebar prints «مستخدم تجريبي» for any facebook_id starting with `demo_`
    // (Sidebar.tsx → useIsDemoUser). stage.sh already fails on that, but the client
    // reads a PERSISTED snapshot, so a stale localStorage can still paint it here.
    await expect(page.getByText('مستخدم تجريبي')).toHaveCount(0);
    // Same class: the demo banner keys off the same check (auth.demoBanner).
    await expect(page.getByText('أنت في الوضع التجريبي')).toHaveCount(0);

    if (prepare) await prepare(page);

    // Park the pointer off-canvas: `prepare` clicks things, and a button left in its
    // hover/active state is a visible artifact in a marketing screenshot (the «مسح»
    // button sat tinted red in one 2026-09-04 gallery-2 because a rejected reply
    // attempt had just cleared the thread).
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, name) });
    console.log('captured', name);
  };

  await shot('raw-stores.png', '/ar/integrations', async (p) => {
    // The card must show a synced catalog. An unsynced store renders «المنتجات
    // المزامنة: 0», which makes the caption («اربط متجرك … في دقيقة») a lie.
    await expect(p.getByText('أزياء الخليج').first()).toBeVisible();
    const meta = p.getByText(/المنتجات المزامنة:\s*\d+/).first();
    await expect(meta).toBeVisible();
    const count = Number((await meta.textContent()).match(/(\d+)/)[1]);
    if (count < 1) throw new Error(`store shows ${count} synced products — sync it before shooting`);
  });

  await shot('raw-comments.png', '/ar/comments', async (p) => {
    const cards = p.getByRole('button', { name: /^فتح تعليق من/ });

    // Land on the auto-replied tab: the caption is «يرد على تعليقات فيسبوك وإنستغرام
    // تلقائياً», so the shot must show replies, not a backlog of unanswered comments.
    await p.locator('button', { hasText: 'تم الرد تلقائياً' }).first().click();

    // ⛔ WAIT FOR THE FILTER TO APPLY, do not assume the click was synchronous.
    // `expect(cards.first()).toBeVisible()` passes instantly on the PREVIOUS tab's
    // cards, so the checks below silently graded the wrong list — the first version
    // of this guard read «بحاجة اهتمام» and passed a shot of «تم الرد تلقائياً».
    // An auto-replied card always has TWO <p> (comment + reply); an unreplied one has
    // one. "Every card has a reply" is therefore the filter having actually landed.
    await expect
      .poll(async () => {
        const n = await cards.count();
        if (n === 0) return -1;
        const counts = await Promise.all(
          Array.from({ length: n }, (_, k) => cards.nth(k).locator('p').count()),
        );
        return counts.every((c) => c >= 2) ? n : 0;
      }, { timeout: 15000, message: 'the «تم الرد تلقائياً» filter never applied' })
      .toBeGreaterThan(0);

    // ⛔ WHICH CARDS ARE ACTUALLY IN THE SHOT IS A GEOMETRIC QUESTION, not a DOM one.
    // The list is a two-column grid that fills BY COLUMN: dom[0] and dom[1] are the
    // right column top-to-bottom, dom[2] and dom[3] the left. So the visually-first
    // ROW is dom[0] and dom[2]. A guard that checked the first two in DOM order read
    // one whole column, passed, and let a shot ship whose first row held an English
    // conversation — which is exactly what happened on 2026-09-04.
    //
    // The requirement comes from the approved shot-list (.planning/SALLA_LISTING_BRIEF.md
    // §4, shot 3): «Customer comment in Arabic + AI reply showing product detail».
    // It asks for an Arabic pair to be PRESENT, not for English to be absent — a
    // bilingual row is a fair advert for a product that answers in both. So: the top
    // row must contain at least one fully-Arabic conversation, and it must quote a
    // price, because that is what the listing claims the replies do.
    const boxes = await Promise.all(
      Array.from({ length: await cards.count() }, async (_, k) => ({
        k,
        y: (await cards.nth(k).boundingBox())?.y ?? Infinity,
      })),
    );
    const topY = Math.min(...boxes.map((b) => b.y));
    const topRow = boxes.filter((b) => b.y - topY < ROW_TOLERANCE_PX);
    if (topRow.length === 0) throw new Error('no comment cards are visible to shoot');

    const conversations = await Promise.all(
      topRow.map(async ({ k }) => {
        const ps = cards.nth(k).locator('p');
        return {
          comment: (await ps.nth(0).innerText()).trim(),
          reply: (await ps.nth(1).innerText()).trim(),
        };
      }),
    );

    const arabicPair = conversations.find(
      (c) => ARABIC_RUN.test(c.comment) && ARABIC_RUN.test(c.reply),
    );
    if (!arabicPair) {
      throw new Error(
        'the top row of the comments shot has no Arabic conversation. The approved ' +
        'shot-list requires «Customer comment in Arabic»; re-order the fixtures and ' +
        `re-run. Top row was: ${JSON.stringify(conversations.map((c) => c.comment))}`,
      );
    }
    if (!PRICE_DIGIT.test(arabicPair.reply)) {
      throw new Error(
        'the Arabic reply in the top row quotes no number, so it is not showing the ' +
        `product detail the caption promises: "${arabicPair.reply}"`,
      );
    }
  });

  await shot('raw-testreply.png', '/ar/pages', async (p) => {
    await p.locator('button', { hasText: 'اختبار الرد الذكي' }).first().click();
    const box = p.locator('textarea').last();
    await expect(box).toBeVisible();

    // ⛔ THE REPLY IS A REAL MODEL CALL, SO IT IS NOT THE SAME TWICE. Across the
    // 2026-09-04 shoots the same question came back as a clean one-liner at 3377 ms
    // and, on the next run, as a three-line answer with two raw product URLs at
    // 4883 ms. Whether the storefront's flagship screenshot is good was luck.
    //
    // So the acceptance criteria are written down and the question is re-asked until
    // one is met. This samples for a REPRESENTATIVE reply, not a flattering outlier:
    // the latency ceiling is the measured production p50 band (2.72 s, D-049) plus
    // headroom for a cold local worker — we will not advertise slower than typical,
    // and we will not pretend to be faster either.
    for (let attempt = 1; ; attempt++) {
      await box.fill('السلام عليكم، كم سعر العباية السوداء؟ وهل متوفر مقاس M؟');
      await p.keyboard.press('Enter');

      // Wait on the reply itself, never a stopwatch: a fixed sleep shoots whatever is
      // on screen when it expires, which is how a spinner gets into a gallery.
      const reply = p.getByTestId('test-reply-assistant-bubble').last();
      await expect(reply).toBeVisible({ timeout: 60000 });
      const text = (await reply.innerText()).trim();
      const latency = Number(
        ((await p.getByText(/مللي ثانية/).last().innerText()).match(/(\d+)/) || [])[1],
      );

      const reject =
        // A quota wall, an error or a refusal renders in this same bubble and looks
        // like a successful shoot in the PNG.
        ['تم الوصول للحد الشهري', 'حدث خطأ', 'عذراً'].find((b) => text.includes(b)) ? 'error/quota reply' :
        // The caption promises the reply quotes real prices.
        !PRICE_DIGIT.test(text) ? 'reply quotes no number' :
        // Raw product URLs are real behaviour but read as clutter at gallery size,
        // and push the bubble to three lines. A presentation choice for this asset —
        // NOT a claim that replies never carry links.
        /https?:\/\//.test(text) ? 'reply contains raw URLs' :
        latency > MAX_SHOWN_LATENCY_MS ? `latency ${latency} ms is above the ${MAX_SHOWN_LATENCY_MS} ms ceiling` :
        null;

      if (!reject) {
        console.log(`reply accepted on attempt ${attempt} (${latency} ms): ${text}`);
        break;
      }
      console.log(`attempt ${attempt} rejected — ${reject}`);
      if (attempt >= MAX_REPLY_ATTEMPTS) {
        throw new Error(
          `no acceptable reply in ${MAX_REPLY_ATTEMPTS} attempts (last: ${reject}). ` +
          'Warm the ai-worker and re-run; do not ship the rejected shot.',
        );
      }
      await p.locator('button', { hasText: 'مسح' }).first().click();
      await expect(p.getByTestId('test-reply-assistant-bubble')).toHaveCount(0);
    }
  });

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
