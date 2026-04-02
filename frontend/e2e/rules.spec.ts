import { test, expect } from '@playwright/test';
import { t, tAr } from './i18n';

/**
 * Rules Page E2E Tests
 *
 * Verifies the auto-reply rules page renders correctly with mocked API data.
 * Uses imported translation files so tests stay in sync when titles change.
 */

const MOCK_TEMPLATES = [
  {
    id: 'tpl_1',
    name: 'Welcome',
    translations: { en: 'Hello! Welcome to our page.', ar: 'مرحبا! أهلا بك في صفحتنا.' },
    active: true,
  },
];

const MOCK_RULES = [
  {
    id: 'rule_1',
    name: 'Greeting Rule',
    keywords: ['hello', 'hi', 'مرحبا'],
    templateId: 'tpl_1',
    enabled: true,
    priority: 1,
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

test.describe('Rules Page', () => {
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

  test('should render rule cards with mock data', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();

      if (url.includes('/rules')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: MOCK_RULES }),
        });
      }
      if (url.includes('/templates')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: MOCK_TEMPLATES }),
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

    await page.goto('/en/rules');

    // Page header
    await expect(
      page.locator('h1').filter({ hasText: t('rules.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Rule name should be visible
    await expect(page.getByText('Greeting Rule').first()).toBeVisible();
  });

  test('should show empty state when no rules', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();

      if (url.includes('/rules')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      }
      if (url.includes('/templates')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: MOCK_TEMPLATES }),
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

    await page.goto('/en/rules');

    await expect(
      page.locator('h1').filter({ hasText: t('rules.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(20);
  });

  test('should show first-match-wins hint text', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/rules')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_RULES }) });
      if (url.includes('/templates')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_TEMPLATES }) });
      if (url.includes('/subscription/usage')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
      if (url.includes('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      if (url.includes('/auth/profile')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/rules');

    await expect(
      page.locator('h1').filter({ hasText: t('rules.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Should show the first-match-wins hint
    const hintText = page.getByText('First match wins').first();
    await hintText.scrollIntoViewIfNeeded();
    await expect(hintText).toBeVisible({ timeout: 10000 });
  });

  test('should open create rule modal and fill form', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (url.includes('/rules') && method === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'rule_new', name: 'Price Rule', keywords: ['price', 'cost'], templateId: 'tpl_1', priority: 2, active: true }),
        });
      }
      if (url.includes('/rules')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_RULES }) });
      if (url.includes('/templates')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_TEMPLATES }) });
      if (url.includes('/subscription/usage')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
      if (url.includes('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      if (url.includes('/auth/profile')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/rules');

    await expect(
      page.locator('h1').filter({ hasText: t('rules.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Click "Add Rule" button
    const addBtn = page.locator('button').filter({ hasText: t('rules.addRule') }).first();
    await addBtn.click();

    // Modal should open
    await expect(page.getByText(t('rules.ruleName')).first()).toBeVisible({ timeout: 5000 });

    // Fill in rule name
    const nameInput = page.locator('input').first();
    await nameInput.fill('Price Rule');
    await expect(nameInput).toHaveValue('Price Rule');

    // Fill in keywords
    const keywordsInput = page.locator('input').nth(1);
    await keywordsInput.fill('price, cost');
    await expect(keywordsInput).toHaveValue('price, cost');
  });

  test('should show rule toggle and keywords', async ({ page }) => {
    const RULES_WITH_TOGGLE = [
      { id: 'rule_1', name: 'Greeting Rule', keywords: ['hello', 'hi'], templateId: 'tpl_1', active: true, priority: 1 },
      { id: 'rule_2', name: 'Price Rule', keywords: ['price', 'cost'], templateId: 'tpl_1', active: false, priority: 2 },
    ];

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/rules')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: RULES_WITH_TOGGLE }) });
      if (url.includes('/templates')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_TEMPLATES }) });
      if (url.includes('/subscription/usage')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
      if (url.includes('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      if (url.includes('/auth/profile')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/rules');

    await expect(
      page.locator('h1').filter({ hasText: t('rules.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Both rules should be visible
    await expect(page.getByText('Greeting Rule').first()).toBeVisible();
    await expect(page.getByText('Price Rule').first()).toBeVisible();

    // Keywords should be displayed
    await expect(page.getByText('hello').first()).toBeVisible();
    await expect(page.getByText('price').first()).toBeVisible();

    // Toggle switches should be present (at least one per rule + possible page-level toggles)
    const toggles = page.locator('[role="switch"]');
    const count = await toggles.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('should render rules page in Arabic (RTL)', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { sidebarOpen: true, language: 'ar', _hasHydrated: false, isOnboardingVisible: false }, version: 0 })
      );
    });

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/rules')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_RULES }) });
      if (url.includes('/templates')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_TEMPLATES }) });
      if (url.includes('/subscription/usage')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
      if (url.includes('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      if (url.includes('/auth/profile')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/ar/rules');

    // Arabic heading
    await expect(
      page.locator('h1').filter({ hasText: tAr('rules.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Rule name should still be visible (rule names are user-defined, not translated)
    await expect(page.getByText('Greeting Rule').first()).toBeVisible();

    // Arabic hint text
    const arHint = page.getByText(tAr('rules.firstMatchHint'), { exact: false }).first();
    await arHint.scrollIntoViewIfNeeded();
    await expect(arHint).toBeVisible({ timeout: 10000 });

    // Add Rule button in Arabic
    await expect(
      page.locator('button').filter({ hasText: tAr('rules.addRule') }).first()
    ).toBeVisible();
  });

  test('should open create rule modal in Arabic', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { sidebarOpen: true, language: 'ar', _hasHydrated: false, isOnboardingVisible: false }, version: 0 })
      );
    });

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/rules')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_RULES }) });
      if (url.includes('/templates')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_TEMPLATES }) });
      if (url.includes('/subscription/usage')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
      if (url.includes('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      if (url.includes('/auth/profile')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/ar/rules');

    await expect(
      page.locator('h1').filter({ hasText: tAr('rules.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Click Arabic "Add Rule" button
    const addBtn = page.locator('button').filter({ hasText: tAr('rules.addRule') }).first();
    await addBtn.click();

    // Modal should open with Arabic label
    await expect(page.getByText(tAr('rules.ruleName')).first()).toBeVisible({ timeout: 5000 });

    // Fill in rule name
    const nameInput = page.locator('input').first();
    await nameInput.fill('قاعدة الأسعار');
    await expect(nameInput).toHaveValue('قاعدة الأسعار');
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

    await page.goto('/en/rules');
    await page.waitForLoadState('networkidle');

    // Page should not show an unrecoverable crash
    await expect(page.locator('text=Something went wrong')).not.toBeVisible({ timeout: 10000 });

    // Verify the page rendered — wait for any visible text content
    await expect(async () => {
      const bodyText = await page.locator('body').innerText();
      expect(bodyText.length).toBeGreaterThan(20);
    }).toPass({ timeout: 10000 });
  });
});
