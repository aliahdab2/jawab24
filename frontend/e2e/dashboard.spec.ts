import { test, expect } from '@playwright/test';
import en from '../src/i18n/en.json';

/**
 * Dashboard E2E Tests
 *
 * Verifies the dashboard page renders correctly with mocked API data.
 * Tests cover the Command Center metrics strip, Smart Status Banner,
 * recent comments, pages widget, and graceful error handling.
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
  byMethod: { ai: 5, template: 3, manual: 2 },
};

const MOCK_ANALYTICS = {
  period: { from: '2026-01-26', to: '2026-02-25', days: 30 },
  totals: {
    comments: 42,
    messages: 15,
    replied: 40,
    unreplied: 17,
    replyRate: '70.2',
    flagged: 2,
  },
  byMethod: { ai: 25, template: 11, manual: 4 },
  byIntent: {},
  byLanguage: {},
  byPlatform: {},
  flags: {},
  responseTime: { avgSeconds: 45, p50Seconds: 30, p95Seconds: 120 },
};

const MOCK_PAGES = [
  {
    id: 'page_1',
    facebookPageId: 'fb_123',
    name: 'Test Business Page',
    autoReplyEnabled: true,
    commentsCount: 42,
    repliesCount: 30,
    replyRate: 71,
    instagramUsername: 'testbiz',
    instagramAutoReplyEnabled: false,
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
];

const MOCK_TWO_PAGES = [
  ...MOCK_PAGES,
  {
    id: 'page_2',
    facebookPageId: 'fb_456',
    name: 'Second Page',
    autoReplyEnabled: false,
    commentsCount: 10,
    repliesCount: 5,
    replyRate: 50,
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
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
      if (url.includes('/analytics/overview')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_ANALYTICS),
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

  test('should render dashboard with Command Center metrics', async ({ page }) => {
    await page.goto('/en/dashboard');

    // The page title should be set (DashboardLayout sets "Dashboard | Jawab24")
    await expect(page).toHaveTitle(/Dashboard.*Jawab24/i);

    // Dashboard header must be visible
    await expect(
      page.locator('h1').filter({ hasText: en['dashboard.greeting'] }).first()
    ).toBeVisible({ timeout: 15000 });

    // Command Center should show Smart Replies count: 20 (comments AI) + 5 (messages AI) = 25
    await expect(page.getByText('25', { exact: true }).first()).toBeVisible({ timeout: 15000 });

    // Replied Today should show 5
    await expect(page.getByText('5', { exact: true }).first()).toBeVisible({ timeout: 15000 });

    // Reply Rate from analytics should show 70.2%
    await expect(page.getByText('70.2%')).toBeVisible({ timeout: 15000 });

    // Navigation should be present (bottom nav on mobile or sidebar on desktop)
    const hasNav = await page.locator('nav').count();
    expect(hasNav).toBeGreaterThan(0);
  });

  test('should show needs-attention banner with correct counts', async ({ page }) => {
    await page.goto('/en/dashboard');

    // Wait for dashboard to load
    await expect(
      page.locator('h1').filter({ hasText: en['dashboard.greeting'] }).first()
    ).toBeVisible({ timeout: 15000 });

    // SmartStatusBanner uses unreplied (12) + pending (5) = 17
    await expect(page.getByText(/17.*items need your attention/i)).toBeVisible({ timeout: 15000 });

    // Breakdown should show comment and message counts (in the header button)
    const commentsLabel = en['comments.title'].toLowerCase();
    const messagesLabel = en['messages.title'].toLowerCase();
    const breakdown = `12 ${commentsLabel} · 5 ${messagesLabel}`;
    await expect(page.getByText(breakdown)).toBeVisible();

    // Banner should be expandable (has a chevron toggle)
    const expandButton = page.getByRole('button', { name: /items need your attention/i });
    await expect(expandButton).toHaveAttribute('aria-expanded', 'false');
  });

  test('should hide banner when no items need action', async ({ page }) => {
    // Override stats to have unreplied = 0 and pending = 0
    await page.route('**/api/comments/stats**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...MOCK_COMMENT_STATS, unreplied: 0 }),
      });
    });
    await page.route('**/api/messages/stats**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...MOCK_MESSAGE_STATS, pending: 0 }),
      });
    });

    await page.goto('/en/dashboard');

    await expect(
      page.locator('h1').filter({ hasText: en['dashboard.greeting'] }).first()
    ).toBeVisible({ timeout: 15000 });

    // Banner should NOT be visible when count is 0
    await expect(page.getByText(/items need your attention/i)).not.toBeVisible({ timeout: 5000 });
  });

  test('should not show only an image or icon as page content', async ({ page }) => {
    await page.goto('/en/dashboard');

    // Wait for dashboard content to render
    await expect(
      page.locator('h1').filter({ hasText: en['dashboard.greeting'] }).first()
    ).toBeVisible({ timeout: 15000 });

    // The page should have meaningful text content, not just an image
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
    await expect(
      page.locator('text=/\\d+/').first()
    ).toBeVisible({ timeout: 15000 });

    // The error boundary should NOT be showing
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=حدث خطأ ما')).not.toBeVisible();
  });

  test('should not crash when user has no active subscription', async ({ page }) => {
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
      page.locator('h1').filter({ hasText: en['dashboard.greeting'] }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('should auto-expand single page accordion on load', async ({ page }) => {
    await page.goto('/en/dashboard');

    // Wait for dashboard to load
    await expect(
      page.locator('h1').filter({ hasText: en['dashboard.greeting'] }).first()
    ).toBeVisible({ timeout: 15000 });

    // With only 1 page, the accordion should auto-expand
    const pageButton = page.locator('button[id^="page-header-"]', { hasText: /Test Business Page/i });
    await expect(pageButton).toBeVisible({ timeout: 15000 });
    await expect(pageButton).toHaveAttribute('aria-expanded', 'true');

    // The expanded panel should show the "Manage Page" CTA link
    const manageLink = page.getByRole('link', { name: new RegExp(en['dashboard.pageAccordion.managePage'], 'i') });
    await expect(manageLink).toBeVisible();

    // The href must deep-link to the individual page card via hash
    const href = await manageLink.getAttribute('href');
    expect(href).toContain('/pages#page-page_1');
  });

  test('should toggle accordion and show page stats', async ({ page }) => {
    // Use two pages so nothing auto-expands
    await page.route('**/api/pages**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_TWO_PAGES }),
      });
    });

    await page.goto('/en/dashboard');

    await expect(
      page.locator('h1').filter({ hasText: en['dashboard.greeting'] }).first()
    ).toBeVisible({ timeout: 15000 });

    // Both page buttons should be visible and collapsed
    const firstButton = page.locator('button[id^="page-header-"]', { hasText: /Test Business Page/i });
    const secondButton = page.locator('button[id^="page-header-"]', { hasText: /Second Page/i });
    await expect(firstButton).toBeVisible({ timeout: 15000 });
    await expect(secondButton).toBeVisible({ timeout: 15000 });
    await expect(firstButton).toHaveAttribute('aria-expanded', 'false');
    await expect(secondButton).toHaveAttribute('aria-expanded', 'false');

    // Click first page to expand it
    await firstButton.click();
    await expect(firstButton).toHaveAttribute('aria-expanded', 'true');

    // Stats should be visible in the expanded panel
    const panel = page.locator('#page-panel-page_1');
    await expect(panel.getByText('42')).toBeVisible();
    await expect(panel.getByText('71%')).toBeVisible();

    // Click second page — first should collapse, second should expand
    await secondButton.click();
    await expect(firstButton).toHaveAttribute('aria-expanded', 'false');
    await expect(secondButton).toHaveAttribute('aria-expanded', 'true');

    // Click second page again to collapse it
    await secondButton.click();
    await expect(secondButton).toHaveAttribute('aria-expanded', 'false');
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
