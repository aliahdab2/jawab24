import { test, expect } from '@playwright/test';

/**
 * Dashboard E2E Tests
 *
 * Verifies the dashboard page renders correctly with mocked API data.
 * These tests would have caught the broken deployment where the dashboard
 * displayed only the app icon instead of actual content.
 */

const MOCK_COMMENT_STATS = {
  total: 42,
  replied: 30,
  unreplied: 12,
  needsAttention: 3,
  repliedToday: 5,
  replyRate: '71.4',
  byMethod: { ai: 20, template: 8, manual: 2 },
};

const MOCK_MESSAGE_STATS = {
  total: 15,
  replied: 10,
  pending: 5,
  needsAttention: 1,
};

const MOCK_PAGES = [
  {
    id: 'page_1',
    facebookPageId: 'fb_123',
    name: 'Test Business Page',
    autoReplyEnabled: true,
    commentsCount: 42,
  },
];

const MOCK_COMMENTS = {
  data: [
    {
      id: 'c1',
      text: 'Hello, what are your hours?',
      authorName: 'Test User',
      replied: true,
      replyText: 'We are open 9-5!',
      replyMethod: 'ai',
      pageId: 'page_1',
      createdAt: new Date().toISOString(),
    },
  ],
};

const MOCK_USAGE = {
  data: {
    subscription: {
      plan: { name: 'Starter' },
      status: 'active',
      trialDaysRemaining: null,
    },
    aiReplies: { used: 20, limit: 100, percentUsed: 20 },
    pages: { used: 1, limit: 1, percentUsed: 100 },
  },
};

const MOCK_SETTINGS = {
  commentsAutoReply: true,
  messagesAutoReply: true,
  greetingMessage: '',
  replyDelay: 0,
  commentEscalationMinutes: 60,
  messageEscalationMinutes: 30,
};

test.describe('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));

    // Set auth state in localStorage before navigating
    // This mimics an authenticated user session
    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: {
            user: { id: 'user_1', email: 'test@test.com', name: 'Test User' },
            token: 'mock-jwt-token',
            fbToken: 'mock-fb-token',
            isAuthenticated: true,
          },
          version: 0,
        })
      );
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({
          state: {
            sidebarOpen: true,
            language: 'en',
            _hasHydrated: false,
            isOnboardingVisible: false,
          },
          version: 0,
        })
      );
      // Mark onboarding as complete so it doesn't show
      localStorage.setItem('jawab24_onboarding_complete', 'true');
    });

    // Mock all API endpoints
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();

      if (url.includes('/comments/stats')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_COMMENT_STATS),
        });
      }
      if (url.includes('/messages/stats')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_MESSAGE_STATS),
        });
      }
      if (url.includes('/comments')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_COMMENTS),
        });
      }
      if (url.includes('/pages')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: MOCK_PAGES }),
        });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_USAGE),
        });
      }
      if (url.includes('/settings')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_SETTINGS),
        });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'user_1',
            email: 'test@test.com',
            name: 'Test User',
          }),
        });
      }

      // Default: return empty 200 for unmatched API calls
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      });
    });
  });

  test('should render dashboard with stats cards and content', async ({ page }) => {
    await page.goto('/en/dashboard');

    // The page title should be set (DashboardLayout sets "Dashboard | Jawab24")
    await expect(page).toHaveTitle(/Dashboard.*Jawab24/i);

    // Dashboard header must be visible - en.json: "dashboard.title" = "Home", ar.json: "الرئيسية"
    await expect(
      page.locator('h1').filter({ hasText: /Home|الرئيسية/i }).first()
    ).toBeVisible({ timeout: 15000 });

    // Comment stats section should render with actual numbers (not just the icon)
    await expect(page.getByText('42', { exact: true }).first()).toBeVisible({ timeout: 15000 });

    // Message stats should also be visible
    await expect(page.getByText('15', { exact: true }).first()).toBeVisible({ timeout: 15000 });

    // Navigation should be present (bottom nav on mobile or sidebar on desktop)
    const hasNav = await page.locator('nav').count();
    expect(hasNav).toBeGreaterThan(0);
  });

  test('should not show only an image or icon as page content', async ({ page }) => {
    await page.goto('/en/dashboard');

    // Wait for dashboard content to render (not networkidle — Next.js HMR keeps connections open)
    await expect(
      page.locator('h1').filter({ hasText: /Home|الرئيسية/i }).first()
    ).toBeVisible({ timeout: 15000 });

    // The page should have meaningful text content, not just an image
    // This catches the specific bug where only app-icon.png was displayed
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(50);

    // There should be no full-viewport images covering the page
    const fullPageImages = await page.locator('img').evaluateAll((imgs) =>
      imgs.filter((img) => {
        const rect = img.getBoundingClientRect();
        return rect.width > window.innerWidth * 0.8 && rect.height > window.innerHeight * 0.8;
      }).length
    );
    expect(fullPageImages).toBe(0);
  });

  test('should render dashboard skeleton then content (not blank/error)', async ({ page }) => {
    await page.goto('/en/dashboard');

    // Within 15 seconds, actual stat values should appear
    // This catches hydration failures where the page stays blank
    await expect(
      page.locator('text=/\\d+/').first()
    ).toBeVisible({ timeout: 15000 });

    // The error boundary should NOT be showing
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=حدث خطأ ما')).not.toBeVisible();
  });

  test('should not crash when user has no active subscription', async ({ page }) => {
    // Regression test for: "Cannot read properties of null (reading 'status')"
    // Happens when usage.subscription is null (new user without a plan yet)
    await page.route('**/api/subscription/usage**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            subscription: null,
            aiReplies: { used: 0, limit: 0, percentUsed: 0 },
            pages: { used: 0, limit: 0, percentUsed: 0 },
          },
        }),
      });
    });

    await page.goto('/en/dashboard');

    // Page should render without crashing
    await expect(page).toHaveTitle(/Dashboard.*Jawab24/i, { timeout: 15000 });
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Cannot read properties')).not.toBeVisible();

    // Header should be visible
    await expect(
      page.locator('h1').filter({ hasText: /Home|الرئيسية/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('should link each "Your Pages" widget item to the specific page card', async ({ page }) => {
    await page.goto('/en/dashboard');

    // Wait for the page item to appear in the widget
    const pageLink = page.getByRole('link', { name: /Test Business Page/i });
    await expect(pageLink).toBeVisible({ timeout: 15000 });

    // The href must deep-link to the individual page card via hash, not just /pages
    const href = await pageLink.getAttribute('href');
    expect(href).toContain('/pages#page-page_1');
  });

  test('should link stat cards with valid filter values only', async ({ page }) => {
    await page.goto('/en/dashboard');

    // Wait for stat cards to render
    await expect(page.getByText('42', { exact: true }).first()).toBeVisible({ timeout: 15000 });

    // All comment filter links must use valid filter values (not pending/flagged/replied_today)
    const commentLinks = page.locator('a[href*="/comments?filter="]');
    const commentCount = await commentLinks.count();
    for (let i = 0; i < commentCount; i++) {
      const href = await commentLinks.nth(i).getAttribute('href');
      expect(href).toMatch(/filter=(needs_action|all|auto_replied)/);
    }

    // All message filter links must also use valid values
    const messageLinks = page.locator('a[href*="/messages?filter="]');
    const messageCount = await messageLinks.count();
    for (let i = 0; i < messageCount; i++) {
      const href = await messageLinks.nth(i).getAttribute('href');
      expect(href).toMatch(/filter=(needs_action|all|auto_replied)/);
    }
  });

  test('should show proper empty state for messages when all stats are zero', async ({ page }) => {
    // Override messages stats to return all zeros
    await page.route('**/api/messages/stats**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 0, replied: 0, pending: 0, needsAttention: 0 }),
      });
    });

    await page.goto('/en/dashboard');
    await expect(
      page.locator('h1').filter({ hasText: /Home|الرئيسية/i }).first()
    ).toBeVisible({ timeout: 15000 });

    // Should show proper empty state text, NOT opacity-50 stat cards
    await expect(page.locator('text=/No messages yet/i')).toBeVisible({ timeout: 10000 });
  });

  test('should show empty state gracefully when APIs fail', async ({ page }) => {
    // Override API mocks to return errors
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/profile')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }),
        });
      }
      await route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto('/en/dashboard');

    // Dashboard should still render (with empty/fallback state), NOT crash
    await expect(page).toHaveTitle(/Dashboard.*Jawab24/i, { timeout: 15000 });

    // The error boundary should NOT be triggered
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();

    // Page should have some content (header, nav, etc.)
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(20);
  });
});
