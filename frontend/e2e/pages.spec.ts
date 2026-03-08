import { test, expect } from '@playwright/test';
import { t } from './i18n';

/**
 * Pages Page E2E Tests
 *
 * Verifies the pages management page renders correctly with mocked API data.
 */

const MOCK_PAGES = [
  {
    id: 'page_1',
    facebookPageId: 'fb_123',
    name: 'My Business Page',
    autoReplyEnabled: true,
    instagramAutoReplyEnabled: false,
    commentsCount: 25,
    knowledgeBase: 'We sell electronics.',
  },
  {
    id: 'page_2',
    facebookPageId: 'fb_456',
    name: 'Second Page',
    autoReplyEnabled: false,
    instagramAutoReplyEnabled: false,
    commentsCount: 0,
    knowledgeBase: '',
  },
];

const MOCK_USAGE = {
  data: {
    subscription: {
      plan: { name: 'Starter' },
      status: 'active',
      trialDaysRemaining: null,
    },
    aiReplies: { used: 10, limit: 100, percentUsed: 10 },
    pages: { used: 1, limit: 3, percentUsed: 33 },
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

test.describe('Pages Page', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));

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
      localStorage.setItem('jawab24_onboarding_complete', 'true');
    });
  });

  test('should render page cards with mock data', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();

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
          body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }),
        });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/pages');

    // Page header should show "My Pages"
    await expect(
      page.locator('h1').filter({ hasText: t('pages.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Page name should be visible
    await expect(page.getByText('My Business Page').first()).toBeVisible();
    await expect(page.getByText('Second Page').first()).toBeVisible();
  });

  test('should show empty state when no pages', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();

      if (url.includes('/pages')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
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
          body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }),
        });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/pages');

    await expect(
      page.locator('h1').filter({ hasText: t('pages.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Should not crash — page should have content
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(20);
  });

  test('should toggle Facebook auto-reply OFF successfully', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (method === 'PATCH' && url.includes('/auto-reply')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_PAGES[0], autoReplyEnabled: false }),
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
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
      }
      if (url.includes('/settings')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/pages');

    await expect(page.getByText('My Business Page').first()).toBeVisible({ timeout: 15000 });

    // Toggle order: page_1 FB (ON), page_1 IG (OFF), page_2 FB (OFF)
    // The first toggle (page_1 FB) should be ON
    const allToggles = page.locator('button[role="switch"]');
    const firstToggle = allToggles.nth(0);
    await expect(firstToggle).toHaveAttribute('aria-checked', 'true');

    // Click to toggle OFF
    await firstToggle.click();

    // Toggle should now be OFF
    await expect(firstToggle).toHaveAttribute('aria-checked', 'false');
  });

  test('should show error toast when enabling Facebook toggle hits page limit', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (method === 'PATCH' && url.includes('/auto-reply')) {
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Page limit reached',
            code: 'PAGE_LIMIT_REACHED',
            limit: 1,
            used: 1,
          }),
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
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
      }
      if (url.includes('/settings')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/pages');

    await expect(page.getByText('Second Page').first()).toBeVisible({ timeout: 15000 });

    // No instagramUsername in mock data, so only FB toggles exist
    // Toggle order: page_1 FB (ON), page_2 FB (OFF)
    const allToggles = page.locator('button[role="switch"]');
    const page2FbToggle = allToggles.nth(1);
    await expect(page2FbToggle).toHaveAttribute('aria-checked', 'false');

    // Click to try enabling — should fail with 403
    await page2FbToggle.click();

    // Toast should appear with limit message
    await expect(page.getByText(t('pages.pageLimitReached'), { exact: false }).first()).toBeVisible({ timeout: 5000 });

    // Toggle should revert back to OFF
    await expect(page2FbToggle).toHaveAttribute('aria-checked', 'false');
  });

  test('should handle API failures gracefully', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/profile')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }),
        });
      }
      if (url.includes('/settings')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_SETTINGS),
        });
      }
      await route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto('/en/pages');

    // Should not crash — error boundary should NOT appear
    await expect(page.locator('text=Something went wrong')).not.toBeVisible({ timeout: 10000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(20);
  });
});
