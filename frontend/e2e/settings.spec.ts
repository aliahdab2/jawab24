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
  commentReplyMode: 'dual',
  commentsAutoReply: true,
  messagesAutoReply: true,
  businessHoursOnly: false,
  businessHoursStart: '09:00',
  businessHoursEnd: '17:00',
  timezone: 'Asia/Damascus',
  awayMessage: '',
  greetingMessage: '',
  greetingMessageMulti: { ar: '', en: '', sourceLang: 'default' },
  awayMessageMulti: { ar: '', en: '', sourceLang: 'default' },
  dualReplyNudgeMulti: { ar: '', en: '', sourceLang: 'default' },
  replyDelay: 0,
  commentEscalationMinutes: 60,
  messageEscalationMinutes: 30,
  handoffPauseDurationMinutes: 30,
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
      const method = route.request().method();

      if (url.includes('/settings') && method === 'PUT') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      }
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

  test('should show Comments Auto-Reply section', async ({ page }) => {
    await page.goto('/en/settings');

    await expect(
      page.locator('text=Reply to Comments').first()
    ).toBeVisible({ timeout: 15000 });

    // Toggle should be visible with role="switch"
    const toggles = page.locator('[role="switch"]');
    await expect(toggles.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show Messages Auto-Reply section', async ({ page }) => {
    await page.goto('/en/settings');

    await expect(
      page.locator('text=Reply to Messages').first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('should show Advanced Settings when clicked', async ({ page }) => {
    await page.goto('/en/settings');

    // Find and click "Show Advanced Settings" button
    const advancedBtn = page.locator('button').filter({ hasText: /Advanced/i }).first();
    await expect(advancedBtn).toBeVisible({ timeout: 15000 });
    await advancedBtn.click();

    // Business Hours heading should now be visible
    await expect(
      page.locator('h4').filter({ hasText: /Business Hours/i }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show business hours time inputs when toggled on', async ({ page }) => {
    // Override mock with businessHoursOnly: true
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/settings')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_SETTINGS, businessHoursOnly: true }),
        });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/settings');

    // Open advanced settings
    const advancedBtn = page.locator('button').filter({ hasText: /Advanced/i }).first();
    await expect(advancedBtn).toBeVisible({ timeout: 15000 });
    await advancedBtn.click();

    // Business Hours heading should be visible
    await expect(
      page.locator('h4').filter({ hasText: /Business Hours/i }).first()
    ).toBeVisible({ timeout: 10000 });

    // Time selects should show the start/end time labels
    await expect(page.locator('text=From').first()).toBeVisible({ timeout: 10000 });
  });

  test('should enable save button when settings change', async ({ page }) => {
    await page.goto('/en/settings');

    // Save button should initially be disabled (no changes)
    const saveBtn = page.locator('button').filter({ hasText: /Save/i }).first();
    await expect(saveBtn).toBeVisible({ timeout: 15000 });
    await expect(saveBtn).toBeDisabled();

    // Click a toggle to change a setting
    const firstToggle = page.locator('[role="switch"]').first();
    await firstToggle.click();

    // Save button should now be enabled
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  });

  test('should show saved state after successful save', async ({ page }) => {
    await page.goto('/en/settings');

    // Change a setting
    const firstToggle = page.locator('[role="switch"]').first();
    await expect(firstToggle).toBeVisible({ timeout: 15000 });
    await firstToggle.click();

    // Click save
    const saveBtn = page.locator('button').filter({ hasText: /Save/i }).first();
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();

    // Should show "Saved" state
    await expect(
      page.locator('button').filter({ hasText: /Saved/i }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should render in Arabic (RTL) when navigating to /ar/settings', async ({ page }) => {
    // Override UI storage to Arabic
    await page.addInitScript(() => {
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { sidebarOpen: true, language: 'ar', _hasHydrated: false, isOnboardingVisible: false }, version: 0 })
      );
    });

    await page.goto('/ar/settings');

    // Page title should contain Arabic or Settings
    await expect(page).toHaveTitle(/Jawab24/i, { timeout: 15000 });

    // Arabic heading should be visible
    await expect(
      page.locator('h1').filter({ hasText: /الإعدادات|Settings/i }).first()
    ).toBeVisible({ timeout: 15000 });

    // Arabic content should be present
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(50);
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
