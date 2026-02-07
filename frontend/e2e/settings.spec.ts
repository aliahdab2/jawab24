import { test, expect } from '@playwright/test';

/**
 * Settings Page E2E Tests
 */

const MOCK_SETTINGS = {
  dashboardLanguage: 'en',
  defaultReplyLanguage: 'auto',
  autoDetectLanguage: true,
  aiEnabled: true,
  aiModel: 'gpt-4o-mini',
  notificationsEnabled: true,
  emailNotifications: false,
  webhookRetries: 3,
  commentReplyMode: 'auto',
  commentsAutoReply: true,
  messagesAutoReply: true,
  businessHoursOnly: false,
  businessHoursStart: '09:00',
  businessHoursEnd: '17:00',
  awayMessage: '',
  greetingMessage: '',
  replyDelay: 0,
  dualReplyConfig: { en: '', ar: '' },
  commentEscalationMinutes: 60,
  messageEscalationMinutes: 30,
};

test.describe('Settings Page', () => {
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
      if (url.includes('/settings')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
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

  test('should render settings page with form fields', async ({ page }) => {
    await page.goto('/en/settings');

    await expect(page).toHaveTitle(/Settings.*Jawab24/i);
    await expect(page.locator('h1').filter({ hasText: /Settings/i }).first()).toBeVisible({ timeout: 15000 });

    // Should show language selector (visible by default)
    await expect(page.locator('text=English').first()).toBeVisible({ timeout: 10000 });
  });

  test('should show save button', async ({ page }) => {
    await page.goto('/en/settings');

    await expect(
      page.locator('button').filter({ hasText: /Save/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('should not crash when APIs fail', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      await route.fulfill({ status: 500, body: 'Error' });
    });

    await page.goto('/en/settings');
    await expect(page).toHaveTitle(/Settings.*Jawab24/i, { timeout: 15000 });
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });
});
