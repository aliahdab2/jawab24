import { test, expect, type Page } from '@playwright/test';
import { t, tAr } from './i18n';

/**
 * Mobile layout guarantees for the inbox filter row and the page card.
 *
 * Both defects this pins were invisible to unit tests, because both are about
 * LAYOUT at a real width: jsdom has no layout engine, so a row that overflows
 * its container and a card that pushes its status below the fold both "pass"
 * there. These run in a real browser at 360 px — the tightest common phone —
 * and in Arabic, where the labels are widest.
 *
 * 1. The filter chips used to sit on one horizontally-scrolling line with
 *    `scrollbar-hide`, no fade and no peeking chip, so «تمت المعالجة» was
 *    unreachable unless the merchant guessed to swipe (reported 2026-08-19).
 * 2. The page card answered "is this page answering my customers?" last, in a
 *    footer below ~640 px of content.
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

const MOCK_STATS = {
  total: 137, convTotal: 137,
  autoReplied: 120, convAutoReplied: 120,
  actionRequired: 0, convActionRequired: 0,
  resolved: 27, convHandled: 27,
  pending: 0,
};

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
  ['/comments/stats', MOCK_STATS],
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
  ['/settings', {}],
  ['/notifications/unread-count', { count: 0 }],
  ['/leads/count', { count: 0 }],
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

  // The card's job is to answer "is this page answering my customers?". That
  // answer must be readable without scrolling — it used to live in a footer
  // below ~640 px of channel rows, stats and action boxes.
  test('the page card states its status above the fold', async ({ page }) => {
    await authenticate(page, 'ar');
    await mockApi(page);
    await page.goto('/pages');

    const pill = page.getByText(tAr('pages.statusAnswering')).first();
    await expect(pill).toBeVisible({ timeout: 15000 });

    const box = (await pill.boundingBox())!;
    expect(box.y, 'the status must sit within the first screen').toBeLessThan(NARROW.height);
  });

  // Both actions on ONE row: two stacked full-width boxes cost ~142 px on a
  // screen the merchant scrolls through once per page.
  test('the card offers Business Info and Test on a single row', async ({ page }) => {
    await authenticate(page, 'en');
    await mockApi(page);
    await page.goto('/en/pages');

    const businessInfo = page.getByRole('button', { name: t('pages.businessInfoActive') }).first();
    const testReply = page.getByRole('button', { name: t('pages.testReplyShort') }).first();
    await expect(businessInfo).toBeVisible({ timeout: 15000 });
    await expect(testReply).toBeVisible();

    const [a, b] = [(await businessInfo.boundingBox())!, (await testReply.boundingBox())!];
    // Same row: their vertical centres line up.
    expect(Math.abs((a.y + a.height / 2) - (b.y + b.height / 2))).toBeLessThan(4);
    // And both keep a thumb-sized target.
    expect(a.height).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
  });

  // A Facebook-only page should not spend two rows saying what it does not have.
  test('unconnected channels collapse into one add-a-channel row', async ({ page }) => {
    await authenticate(page, 'ar');
    await mockApi(page);
    await page.goto('/pages');

    await expect(page.getByText(tAr('pages.statusAnswering')).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(tAr('pages.instagramNotConnected'))).toHaveCount(0);
    await expect(page.getByText(tAr('pages.whatsappNotConnected'))).toHaveCount(0);
  });
});
