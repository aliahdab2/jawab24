import { test, expect, type Page } from '@playwright/test';
import { t, tAr } from './i18n';

/**
 * Mobile layout guarantees for the inbox filter row.
 *
 * The defect this pins was invisible to unit tests, because it is about LAYOUT
 * at a real width: jsdom has no layout engine, so a row that overflows its
 * container "passes" there. This runs in a real browser at 360 px — the
 * tightest common phone — and in Arabic, where the labels are widest.
 *
 * The filter chips used to sit on one horizontally-scrolling line with
 * `scrollbar-hide`, no fade and no peeking chip, so «تمت المعالجة» was
 * unreachable unless the merchant guessed to swipe (reported 2026-08-19).
 *
 * Scope: the filter row, and the settings controls that share its failure mode
 * — an element wider than the phone. The page-card assertions that lived here
 * went out with the card redesign (reverted 2026-08-19) — restore them with it,
 * not before.
 */

const NARROW = { width: 360, height: 740 };

const MOCK_PAGES = [
  {
    id: 'page_1',
    facebookPageId: 'fb_123',
    name: 'صفحة الاختبار',
    autoReplyEnabled: true,
    instagramAutoReplyEnabled: false,
    whatsappAutoReplyEnabled: false,
    commentsCount: 72325,
    repliesCount: 61378,
    replyRate: 85,
    kbFilled: true,
  },
];

/** Enough of a settings payload for the Auto-Reply board to render its controls. */
const MOCK_SETTINGS = {
  aiEnabled: true,
  commentsAutoReply: true,
  messagesAutoReply: true,
  commentReplyMode: 'dual',
  businessHoursOnly: false,
  replyDelay: 0,
  greetingMessageMulti: { ar: '', en: '', sourceLang: 'default' },
  awayMessageMulti: { ar: '', en: '', sourceLang: 'default' },
  dualReplyNudgeMulti: { ar: '', en: '', sourceLang: 'default' },
};

/**
 * Five-digit totals on purpose. The counts are what a chip cannot shrink below,
 * so a leads row that fills its width must be measured at the widest number a
 * merchant actually reaches — not at the zeroes of a fresh account.
 */
const MOCK_LEADS = { data: [], total: 72325 };

const MOCK_STATS = {
  total: 137, convTotal: 137,
  autoReplied: 120, convAutoReplied: 120,
  actionRequired: 0, convActionRequired: 0,
  resolved: 27, convHandled: 27,
  pending: 0,
};

/**
 * `/comments/stats` is NOT the inbox shape: the comments page derives its
 * auto-replied chip from `byMethod`, so the inbox fixture crashes it outright
 * («Cannot read properties of undefined (reading 'ai')») and the row under test
 * never renders.
 */
const MOCK_COMMENT_STATS = { ...MOCK_STATS, unreplied: 0, byMethod: { ai: 100, template: 15, postReply: 5 } };

async function authenticate(page: Page, language: 'ar' | 'en') {
  await page.addInitScript((lang) => {
    localStorage.setItem('auth-storage', JSON.stringify({
      state: {
        user: { id: 'user_1', email: 'test@test.com', name: 'Test User' },
        token: 'mock-jwt-token', fbToken: 'mock-fb-token', isAuthenticated: true,
      },
      version: 0,
    }));
    localStorage.setItem('ui-storage', JSON.stringify({
      state: { sidebarOpen: false, language: lang, _hasHydrated: false, isOnboardingVisible: false },
      version: 0,
    }));
    localStorage.setItem('jawab24_onboarding_complete', 'true');
  }, language);
}

/**
 * Endpoints this spec depends on, keyed by the path SUFFIX the app requests.
 *
 * Matching on a suffix rather than a `**\/api/**` glob is deliberate: the API
 * base is an env var with no fixed prefix — `http://localhost:3000` in a dev
 * worktree, `.../api` behind nginx in the gate's build — so a prefix glob
 * matches nothing in one of the two and every call quietly hits a real socket.
 *
 * Everything NOT listed here is left alone. Next.js fetches its own manifests
 * over the same fetch/xhr resource types, and answering those with a stub
 * breaks the client router outright (`matchers.some is not a function`), which
 * looks exactly like a broken page.
 */
const API: Array<[string, unknown]> = [
  ['/messages/stats', MOCK_STATS],
  ['/comments/stats', MOCK_COMMENT_STATS],
  ['/messages', { data: [], pagination: { nextCursor: null } }],
  ['/comments', { data: [], pagination: { nextCursor: null } }],
  // A BARE array — that is what `GET /pages` sends (controllers/pages.ts maps
  // the rows straight into reply.send). The inbox reads it without a fallback,
  // so a `{ data: [...] }` fixture crashes it with «pages is not iterable»
  // while the channels page, which tolerates both shapes, looks fine.
  ['/pages', MOCK_PAGES],
  ['/workspaces', [{ id: 'ws_test', name: 'Test', role: 'owner' }]],
  ['/auth/me', { id: 'user_1', email: 'test@test.com', name: 'Test User' }],
  ['/subscription/usage', { data: {
    subscription: { plan: { name: 'Starter' }, status: 'active', trialDaysRemaining: null },
    aiReplies: { used: 10, limit: 100, percentUsed: 10 },
    pages: { used: 1, limit: 3, percentUsed: 33 },
  } }],
  // Before '/settings': that suffix matches this pathname too, and the first
  // entry wins.
  ['/workspaces/current/settings', {}],
  ['/workspaces/current/members', [{ id: 'mem_1', userId: 'user_1', role: 'owner', joinedAt: '2026-01-01', user: { id: 'user_1', name: 'Test User', email: 'test@test.com', picture: null } }]],
  ['/workspaces/current/invites', []],
  ['/settings', MOCK_SETTINGS],
  ['/auth/profile', { id: 'user_1', email: 'test@test.com', name: 'Test User' }],
  ['/notifications/unread-count', { count: 0 }],
  ['/leads/count', { count: 0 }],
  ['/leads', MOCK_LEADS],
];

async function mockApi(page: Page) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    // NEVER answer a navigation: `/messages` and `/pages` are page routes as
    // well as endpoints, and stubbing the document serves JSON as the page.
    if (request.resourceType() === 'document') return route.continue();

    const url = new URL(request.url());
    if (url.pathname.startsWith('/_next')) return route.continue();

    const match = API.find(([suffix]) => url.pathname.endsWith(suffix));
    if (!match) return route.continue();

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(match[1]),
    });
  });
}


test.describe('mobile layout @360', () => {
  test.use({ viewport: NARROW });

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
  });

  // Every filter must be REACHABLE, not merely present in the DOM. An element
  // scrolled past its container's edge is visible to Playwright and invisible to
  // the merchant, so assert the geometry: each chip's box inside the row's box.
  test('all four inbox filters are on screen, none clipped by the row', async ({ page }) => {
    await authenticate(page, 'ar');
    await mockApi(page);
    await page.goto('/messages');

    const row = page.getByRole('group').filter({ has: page.getByRole('button', { name: new RegExp(tAr('messages.handled')) }) }).first();
    await expect(row).toBeVisible({ timeout: 15000 });

    // The row itself must not be a hidden scroller.
    const overflows = await row.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflows, 'the chip row must not hide content behind a horizontal scroll').toBe(false);

    const rowBox = (await row.boundingBox())!;
    const centres: number[] = [];
    for (const key of ['messages.needsAction', 'messages.allMessages', 'messages.autoReplied', 'messages.handled']) {
      const chip = row.getByRole('button', { name: new RegExp(tAr(key)) }).first();
      await expect(chip).toBeVisible();
      const box = (await chip.boundingBox())!;
      expect(box.x, `${key} starts before the row`).toBeGreaterThanOrEqual(rowBox.x - 1);
      expect(box.x + box.width, `${key} is cut off at the row's edge`).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
      centres.push(box.y + box.height / 2);
    }

    // ONE line. Wrapping would also keep every chip reachable, which is why this
    // assertion exists separately: the stacked count buys back the ~50 px a
    // second row costs on the screen merchants live in, and only this catches a
    // regression to the inline chip that spends it again.
    expect(Math.max(...centres) - Math.min(...centres),
      'all four chips must share one row').toBeLessThan(4);
  });

  test('the page never scrolls sideways', async ({ page }) => {
    await authenticate(page, 'ar');
    await mockApi(page);
    await page.goto('/messages');
    await expect(page.getByRole('group').first()).toBeVisible({ timeout: 15000 });

    const sideways = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(sideways, 'the body must never scroll horizontally on a phone').toBe(false);
  });

  /**
   * The chips must SPEND the row, not sit in the middle of it. Content-sized
   * chips gave «الكل» a ~34 px pill beside a ~78 px «تحوّل» and left 57 px of
   * the row unused (reported 2026-08-19 on leads) — the most-tapped filter had
   * the smallest target.
   *
   * All THREE pages that mount the row, because the fix is in the shared
   * component and a chip row that fills on leads proves nothing about the two
   * inboxes: they carry a different chip count beside a differently-sized
   * search box. Leads is also the tight case — five chips, and its fixture
   * counts are five digits — so what this pins is that the SURPLUS is shared,
   * never that a big number gets squeezed.
   */
  const CHIP_ROWS = [
    { path: '/messages', group: 'messages.title', chips: ['messages.needsAction', 'messages.allMessages', 'messages.autoReplied', 'messages.handled'] },
    { path: '/comments', group: 'comments.title', chips: ['comments.needsAction', 'comments.allComments', 'comments.autoReplied', 'comments.handled'] },
    { path: '/leads', group: 'leads.title', chips: ['leads.filterAll', 'leads.filterNew', 'leads.filterContacted', 'leads.filterConverted', 'leads.filterReturning'] },
  ];

  for (const { path, group, chips } of CHIP_ROWS) {
    test(`the ${path} filters spend the full width of their row`, async ({ page }) => {
      await authenticate(page, 'ar');
      await mockApi(page);
      await page.goto(path);

      const row = page.getByRole('group', { name: tAr(group) });
      await expect(row).toBeVisible({ timeout: 15000 });

      const overflows = await row.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(overflows, 'the chip row must not hide content behind a horizontal scroll').toBe(false);

      const rowBox = (await row.boundingBox())!;
      const boxes: Array<{ x: number; right: number }> = [];
      for (const key of chips) {
        const chip = row.getByRole('button', { name: new RegExp(tAr(key)) }).first();
        await expect(chip).toBeVisible();
        const box = (await chip.boundingBox())!;
        boxes.push({ x: box.x, right: box.x + box.width });
        // A grown chip is also a legal tap target — the reason for growing it.
        expect(box.height, `${key} is below the 44 px touch floor`).toBeGreaterThanOrEqual(44);
      }

      // Every line of a wrapped flex row fills too, so this holds whether the
      // chips share one line or spill onto a second.
      const leftmost = Math.min(...boxes.map((b) => b.x));
      const rightmost = Math.max(...boxes.map((b) => b.right));
      expect(leftmost - rowBox.x, 'the chips leave a gap at the row start').toBeLessThanOrEqual(1);
      expect(rowBox.x + rowBox.width - rightmost, 'the chips leave a gap at the row end').toBeLessThanOrEqual(1);
    });
  }

  /**
   * Settings — «أين يظهر الرد على التعليق؟».
   *
   * The three delivery options plus the «Recommended» badge shipped as one
   * `inline-flex` line, so the control ran off the screen and dragged the whole
   * page's horizontal scroll with it (reported 2026-08-19, English).
   *
   * Both languages, and the row geometry is asserted separately from the
   * overflow for a measured reason: on the broken build English ran 31 px past
   * the 360 px screen while Arabic stayed inside it, because each segment
   * shrinks to its longest WORD and Arabic's are shorter. An "is it inside the
   * screen" check alone therefore PASSES in Arabic on the broken build —
   * overflow was the English symptom, not the whole defect. What both languages
   * share is the fix: on a phone each option owns a full-width row.
   */
  for (const lang of ['ar', 'en'] as const) {
    const tr = lang === 'ar' ? tAr : t;

    test(`the comment-reply-mode options stay on screen (${lang})`, async ({ page }) => {
      await authenticate(page, lang);
      await mockApi(page);
      await page.goto(`/${lang}/settings`);

      const group = page.getByRole('radiogroup', { name: tr('settings.autoReplyBoard.modeQuestion') });
      await expect(group).toBeVisible({ timeout: 15000 });

      const options = group.locator('label');
      await expect(options).toHaveCount(3);

      const viewport = page.viewportSize()!;
      const groupBox = (await group.boundingBox())!;
      const centres: number[] = [];
      for (let i = 0; i < 3; i++) {
        const box = (await options.nth(i).boundingBox())!;
        expect(box.x, `option ${i} starts off the screen`).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width, `option ${i} runs off the screen`).toBeLessThanOrEqual(viewport.width + 1);
        // One per row: the option is as wide as the control, not a third of it.
        // Tolerance is the control's own 1px border on each side; a regression
        // to three columns costs ~100px here, nowhere near it.
        expect(groupBox.width - box.width, `option ${i} is not a full-width row`).toBeLessThanOrEqual(2);
        expect(box.height, `option ${i} is below the 44 px touch floor`).toBeGreaterThanOrEqual(44);
        centres.push(box.y + box.height / 2);
      }
      // …and three distinct rows, not three columns sharing one.
      const sortedCentres = [...centres].sort((a, b) => a - b);
      expect(sortedCentres[0], 'the options share a row instead of stacking').toBeLessThan(sortedCentres[1] - 8);
      expect(sortedCentres[1], 'the options share a row instead of stacking').toBeLessThan(sortedCentres[2] - 8);

      const sidewaysCheck = () => page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(await sidewaysCheck(), 'settings must never scroll horizontally on a phone').toBe(false);

      // Advanced is collapsed on arrival, so half the page's controls — business
      // hours, reply delay, the escalation pickers — are not in the measurement
      // above. Open it and measure the whole page, which is what makes this a
      // sweep for "text runs off the screen" rather than a check of one control.
      await page.locator('button[aria-controls="advanced-settings-body"]').click();
      await expect(page.locator('#advanced-settings-body')).toBeVisible();
      expect(await sidewaysCheck(), 'the Advanced section must not widen the page').toBe(false);
    });
  }
});
