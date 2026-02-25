import { test, expect } from '@playwright/test';

/**
 * Comments Page E2E Tests
 */

const MOCK_PAGES = [
  { id: 'page_1', facebookPageId: 'fb_123', name: 'Test Page', autoReplyEnabled: true, commentsCount: 10 },
];

const MOCK_COMMENT_STATS = {
  total: 10,
  unreplied: 3,
  needsAttention: 1,
  repliedToday: 5,
  autoReplied: 6,
  resolved: 1,
  byMethod: { ai: 4, template: 2, manual: 1 },
};

const MOCK_COMMENTS = {
  data: [
    {
      id: 'c1',
      postId: 'p1',
      message: 'What are your business hours?',
      fromName: 'Jane Doe',
      replied: true,
      replyText: 'We are open 9-5 daily.',
      replyMethod: 'ai',
      pageId: 'page_1',
      createdAt: new Date().toISOString(),
      postMessage: 'Check out our new schedule!',
    },
    {
      id: 'c2',
      postId: 'p2',
      message: 'How much does it cost?',
      fromName: 'John Smith',
      replied: false,
      replyText: null,
      replyMethod: null,
      pageId: 'page_1',
      createdAt: new Date().toISOString(),
      postMessage: 'Special pricing this week!',
    },
    {
      id: 'c3',
      postId: 'p1',
      message: 'I need help with my order',
      fromName: 'Sara Ahmed',
      replied: false,
      replyText: null,
      replyMethod: null,
      pageId: 'page_1',
      createdAt: new Date().toISOString(),
      needsAttention: true,
      flagReason: 'human_requested',
    },
  ],
  pagination: { nextCursor: null },
};

test.describe('Comments Page', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));

    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: { id: 'u1', email: 'test@test.com', name: 'Test' }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true },
          version: 0,
        })
      );
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { sidebarOpen: true, language: 'en', _hasHydrated: false, isOnboardingVisible: false }, version: 0 })
      );
      localStorage.setItem('jawab24_onboarding_complete', 'true');
    });

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/comments/stats')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COMMENT_STATS) });
      }
      if (url.includes('/comments')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COMMENTS) });
      }
      if (url.includes('/pages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_PAGES }) });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
  });

  test('should render comments page with header and content', async ({ page }) => {
    await page.goto('/en/comments');

    await expect(page).toHaveTitle(/Comments/i, { timeout: 15000 });
    await expect(page.locator('h1').filter({ hasText: /Comments/i }).first()).toBeVisible({ timeout: 15000 });

    // Should show comment text from mock data
    await expect(page.locator('text=What are your business hours?').first()).toBeVisible({ timeout: 10000 });
  });

  test('should show search input', async ({ page }) => {
    await page.goto('/en/comments');
    await expect(page.locator('input').first()).toBeVisible({ timeout: 10000 });
  });

  test('should show filter chips with counts', async ({ page }) => {
    await page.goto('/en/comments');

    // Wait for page to load
    await expect(page.locator('h1').filter({ hasText: /Comments/i }).first()).toBeVisible({ timeout: 15000 });

    // Should show "Needs Action" filter chip with unreplied count
    await expect(page.locator('button').filter({ hasText: /Needs Action/i }).first()).toBeVisible({ timeout: 10000 });

    // Should show "All" filter chip
    await expect(page.locator('button').filter({ hasText: /All/i }).first()).toBeVisible({ timeout: 10000 });

    // Should show "Auto-replied" filter chip
    await expect(page.locator('button').filter({ hasText: /Auto-replied/i }).first()).toBeVisible({ timeout: 10000 });
  });

  test('should default to Needs Action filter', async ({ page }) => {
    await page.goto('/en/comments');

    await expect(page.locator('h1').filter({ hasText: /Comments/i }).first()).toBeVisible({ timeout: 15000 });

    // The "Needs Action" chip should have active styling (brand color)
    const needsActionBtn = page.locator('button').filter({ hasText: /Needs Action/i }).first();
    await expect(needsActionBtn).toBeVisible({ timeout: 10000 });

    // URL should NOT have filter=all param (needs_action is default)
    expect(page.url()).not.toContain('filter=all');
  });

  test('should show post context on comment cards', async ({ page }) => {
    await page.goto('/en/comments');

    await expect(page.locator('h1').filter({ hasText: /Comments/i }).first()).toBeVisible({ timeout: 15000 });

    // Should show post message text from mock data
    await expect(page.locator('text=Check out our new schedule!').first()).toBeVisible({ timeout: 10000 });
  });

  test('should handle legacy filter=pending param without crashing', async ({ page }) => {
    await page.goto('/en/comments?filter=pending');

    // Should NOT crash — should fall back to "Needs Action" filter
    await expect(page.locator('h1').filter({ hasText: /Comments/i }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();

    // The "Needs Action" chip should be active (fallback from invalid "pending")
    const needsActionBtn = page.locator('button[aria-pressed="true"]').filter({ hasText: /Needs Action/i });
    await expect(needsActionBtn).toBeVisible({ timeout: 10000 });
  });

  test('should handle legacy filter=flagged param without crashing', async ({ page }) => {
    await page.goto('/en/comments?filter=flagged');

    await expect(page.locator('h1').filter({ hasText: /Comments/i }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  test('should not crash when APIs fail', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      await route.fulfill({ status: 500, body: 'Error' });
    });

    await page.goto('/en/comments');
    await expect(page).toHaveTitle(/Comments/i, { timeout: 15000 });
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });
});
