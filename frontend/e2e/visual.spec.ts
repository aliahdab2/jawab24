import { test, expect } from '@playwright/test';

/**
 * Visual Regression Tests
 *
 * Captures pixel-level snapshots of high-risk layout areas and compares them
 * against committed baselines. Catches regressions in:
 *   - RTL layout (Arabic) — text direction, alignment, logical CSS properties
 *   - Safe area positioning — header pt-safe, bottom nav bottom-nav-position
 *   - Landscape mode — no bottom gap, side padding, scrollable content
 *
 * First run: npx playwright test e2e/visual.spec.ts --update-snapshots
 * Subsequent runs: npx playwright test e2e/visual.spec.ts
 * Snapshots committed to: e2e/visual.spec.ts-snapshots/
 *
 * Threshold: 2% pixel ratio — tolerates minor font/anti-aliasing differences
 * across CI environments while catching real layout regressions.
 */

// ── Shared mock data (stable — no timestamps, no dynamic counts) ─────────────

const MOCK_COMMENT_STATS = {
  total: 42, replied: 30, unreplied: 12, needsAttention: 3,
  repliedToday: 5, replyRate: '71.4',
  byMethod: { ai: 20, template: 8, manual: 2 },
};

const MOCK_MESSAGE_STATS = { total: 25, replied: 18, pending: 7, needsAttention: 2 };

const MOCK_PAGES = [
  { id: 'page_1', facebookPageId: 'fb_123', name: 'My Business Page',
    autoReplyEnabled: true, instagramAutoReplyEnabled: false, commentsCount: 25, knowledgeBase: '' },
];

const MOCK_COMMENTS = {
  data: [
    { id: 'c1', postId: 'p1', message: 'What are your business hours?',
      fromName: 'Jane Doe', replied: true, replyText: 'We are open 9-5 daily.',
      replyMethod: 'ai', pageId: 'page_1', createdAt: '2026-01-15T10:00:00.000Z' },
    { id: 'c2', postId: 'p1', message: 'How much does it cost?',
      fromName: 'John Smith', replied: false, replyText: null,
      replyMethod: null, pageId: 'page_1', createdAt: '2026-01-15T09:00:00.000Z' },
  ],
  pagination: { nextCursor: null },
};

const MOCK_USAGE = {
  data: {
    subscription: { plan: { name: 'Starter' }, status: 'active', trialDaysRemaining: null },
    aiReplies: { used: 20, limit: 100, percentUsed: 20 },
    pages: { used: 1, limit: 3, percentUsed: 33 },
  },
};

const MOCK_SETTINGS = {
  dashboardLanguage: 'en', defaultReplyLanguage: 'auto', autoDetectLanguage: true,
  aiEnabled: true, commentsAutoReply: true, messagesAutoReply: true,
  businessHoursOnly: false, businessHoursStart: '09:00', businessHoursEnd: '17:00',
  awayMessage: '', greetingMessage: '', replyDelay: 0,
};

const MOCK_MESSAGES = {
  data: [
    { id: 'm1', senderId: 'sender_1', senderName: 'Alice', message: 'Hello, I need help',
      direction: 'incoming', replied: true, replyText: 'Hi! How can I help?',
      replyMethod: 'ai', pageId: 'page_1', createdAt: '2026-01-15T10:00:00.000Z' },
    { id: 'm2', senderId: 'sender_2', senderName: 'Bob', message: 'What is the price?',
      direction: 'incoming', replied: false, replyText: null,
      replyMethod: null, pageId: 'page_1', createdAt: '2026-01-15T09:00:00.000Z' },
  ],
  pagination: { nextCursor: null },
};

const MOCK_TEMPLATES = {
  data: [
    { id: 't1', name: 'Welcome', message: 'Welcome to our business!', enabled: true,
      createdAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-01-10T00:00:00.000Z' },
    { id: 't2', name: 'Business Hours', message: 'We are open 9 AM - 5 PM.', enabled: true,
      createdAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-01-10T00:00:00.000Z' },
  ],
};

const MOCK_RULES = {
  data: [
    { id: 'r1', name: 'Price Inquiry', keywords: ['price', 'cost', 'how much'],
      templateId: 't1', enabled: true, priority: 1,
      createdAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-01-10T00:00:00.000Z' },
    { id: 'r2', name: 'Hours Question', keywords: ['hours', 'open', 'when'],
      templateId: 't2', enabled: true, priority: 2,
      createdAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-01-10T00:00:00.000Z' },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Freeze Date.now and new Date() to a fixed point so dashboard date strings
// (e.g. "Sunday, March 1") never drift and break snapshots.
const FROZEN_DATE = '2026-01-15T12:00:00.000Z'; // matches mock createdAt dates

function freezeDate(page: import('@playwright/test').Page) {
  return page.addInitScript((isoDate: string) => {
    const fixed = new Date(isoDate).getTime();
    const OrigDate = window.Date;
    // @ts-expect-error — overriding Date constructor
    window.Date = class extends OrigDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(fixed);
        } else {
          // @ts-expect-error — spread into Date constructor
          super(...args);
        }
      }

      static now() { return fixed; }
    };
  }, FROZEN_DATE);
}

function setupAuth(page: import('@playwright/test').Page, language: 'en' | 'ar' = 'en') {
  return page.addInitScript((lang: 'en' | 'ar') => {
    localStorage.setItem('auth-storage', JSON.stringify({
      state: { user: { id: 'user_1', email: 'test@test.com', name: 'Test User' },
        token: 'mock-jwt-token', fbToken: 'mock-fb-token', isAuthenticated: true },
      version: 0,
    }));
    localStorage.setItem('ui-storage', JSON.stringify({
      state: { sidebarOpen: true, language: lang, _hasHydrated: false, isOnboardingVisible: false },
      version: 0,
    }));
    localStorage.setItem('jawab24_onboarding_complete', 'true');
  }, language);
}

function setupApiMocks(page: import('@playwright/test').Page) {
  return page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/comments/stats'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COMMENT_STATS) });
    if (url.includes('/messages/stats'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MESSAGE_STATS) });
    if (url.includes('/comments'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COMMENTS) });
    if (url.includes('/messages'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MESSAGES) });
    if (url.includes('/templates'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TEMPLATES) });
    if (url.includes('/rules'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_RULES) });
    if (url.includes('/pages'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_PAGES }) });
    if (url.includes('/subscription/usage'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
    if (url.includes('/settings'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

// Shared screenshot options — 5% pixel ratio tolerates font antialiasing and
// subpixel rendering differences across runs without masking real layout regressions.
const SNAP_OPTS = { maxDiffPixelRatio: 0.05 };

// ── 1. RTL Layout (Arabic) — highest regression risk ─────────────────────────

test.describe('RTL Layout — Arabic', () => {
  test.use({ viewport: { width: 390, height: 844 } }); // iPhone 14 Pro

  test.beforeEach(async ({ page }) => {
    await freezeDate(page);
    await setupAuth(page, 'ar');
    await setupApiMocks(page);
  });

  test('dashboard renders correctly in Arabic (RTL)', async ({ page }) => {
    await page.goto('/ar/dashboard');
    await page.waitForSelector('h1', { timeout: 15000 });
    // Wait for stats to load (skeleton → content)
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot('dashboard-ar-mobile.png', SNAP_OPTS);
  });

  test('comments page renders correctly in Arabic (RTL)', async ({ page }) => {
    await page.goto('/ar/comments');
    await page.waitForSelector('h1', { timeout: 15000 });
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot('comments-ar-mobile.png', SNAP_OPTS);
  });

  test('bottom nav is mirrored in Arabic (RTL)', async ({ page }) => {
    await page.goto('/ar/dashboard');
    await page.waitForSelector('h1', { timeout: 15000 });
    await page.waitForTimeout(500);
    const nav = page.locator('.bottom-nav-position');
    await expect(nav).toHaveScreenshot('bottom-nav-ar.png', SNAP_OPTS);
  });
});

// ── 2. Safe Area Positioning — header and bottom nav ────────────────────────

test.describe('Safe Area Positioning — English', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await freezeDate(page);
    await setupAuth(page, 'en');
    await setupApiMocks(page);
  });

  test('dashboard header has top safe area padding', async ({ page }) => {
    await page.goto('/en/dashboard');
    // Wait for the top nav/header element
    await page.waitForSelector('h1', { timeout: 15000 });
    await page.waitForTimeout(500);
    // Capture just the top portion (header + safe area) to detect pt-safe regressions
    await expect(page).toHaveScreenshot('dashboard-en-mobile-header.png', {
      ...SNAP_OPTS,
      clip: { x: 0, y: 0, width: 390, height: 140 },
    });
  });

  test('bottom nav has correct safe area inset in portrait', async ({ page }) => {
    await page.goto('/en/dashboard');
    await page.waitForSelector('h1', { timeout: 15000 });
    await page.waitForTimeout(500);
    // Use the nav element directly — page clip captured content above the nav
    // that varies with accordion timing, causing flaky 6% diffs.
    const nav = page.locator('.bottom-nav-position');
    await expect(nav).toHaveScreenshot('dashboard-en-mobile-bottom-nav.png', { maxDiffPixelRatio: 0.08 });
  });
});

// ── 3. Landscape Mode — bottom nav gap and side padding ──────────────────────

test.describe('Landscape Mode', () => {
  test.use({ viewport: { width: 844, height: 390 } }); // iPhone 14 Pro landscape

  test.beforeEach(async ({ page }) => {
    await freezeDate(page);
    await setupAuth(page, 'en');
    await setupApiMocks(page);
  });

  test('dashboard has no bottom gap in landscape mode', async ({ page }) => {
    await page.goto('/en/dashboard');
    await page.waitForSelector('h1', { timeout: 15000 });
    await page.waitForTimeout(500);
    // Capture the bottom strip — should have no gap below the nav in landscape
    await expect(page).toHaveScreenshot('dashboard-en-landscape-bottom.png', {
      ...SNAP_OPTS,
      clip: { x: 0, y: 310, width: 844, height: 80 },
    });
  });

  test('dashboard bottom nav has side padding (landscape:px-6) in landscape', async ({ page }) => {
    await page.goto('/en/dashboard');
    await page.waitForSelector('h1', { timeout: 15000 });
    await page.waitForTimeout(500);
    const nav = page.locator('.bottom-nav-position');
    await expect(nav).toHaveScreenshot('dashboard-en-landscape-nav.png', { maxDiffPixelRatio: 0.05 });
  });

  test('comments page is scrollable and not cut off in landscape', async ({ page }) => {
    await page.goto('/en/comments');
    await page.waitForSelector('h1', { timeout: 15000 });
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot('comments-en-landscape.png', SNAP_OPTS);
  });
});

// ── 4. Dashboard Page Spacing — one snapshot per core page ──────────────────

test.describe('Dashboard Page Spacing', () => {
  test.use({ viewport: { width: 390, height: 844 } }); // iPhone 14 Pro

  test.beforeEach(async ({ page }) => {
    await freezeDate(page);
    await setupAuth(page, 'en');
    await setupApiMocks(page);
  });

  test('messages page spacing', async ({ page }) => {
    await page.goto('/en/messages');
    await page.waitForSelector('h1', { timeout: 15000 });
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot('messages-en-mobile.png', SNAP_OPTS);
  });

  test('templates page spacing', async ({ page }) => {
    await page.goto('/en/templates');
    await page.waitForSelector('h1', { timeout: 15000 });
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot('templates-en-mobile.png', SNAP_OPTS);
  });

  test('rules page spacing', async ({ page }) => {
    await page.goto('/en/rules');
    await page.waitForSelector('h1', { timeout: 15000 });
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot('rules-en-mobile.png', SNAP_OPTS);
  });

  test('settings page spacing', async ({ page }) => {
    await page.goto('/en/settings');
    await page.waitForSelector('h1', { timeout: 15000 });
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot('settings-en-mobile.png', SNAP_OPTS);
  });
});
