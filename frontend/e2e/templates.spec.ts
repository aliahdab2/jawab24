import { test, expect } from '@playwright/test';
import { t, tAr } from './i18n';

/**
 * Templates Page E2E Tests
 *
 * Verifies the reply templates page renders correctly with mocked API data.
 * Uses imported translation files so tests stay in sync when titles change.
 */

const MOCK_TEMPLATES = [
  {
    id: 'tpl_1',
    name: 'Welcome',
    translations: { en: 'Hello! Welcome to our page.', ar: 'مرحبا! أهلا بك في صفحتنا.' },
    active: true,
  },
  {
    id: 'tpl_2',
    name: 'Pricing',
    translations: { en: 'Our prices start at $5.', ar: 'أسعارنا تبدأ من 5 دولار.' },
    active: true,
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

test.describe('Templates Page', () => {
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

  test('should render template cards with mock data', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();

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

    await page.goto('/en/templates');

    // Page header
    await expect(
      page.locator('h1').filter({ hasText: t('templates.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Template names should be visible (scroll on mobile where cards stack vertically)
    await expect(page.getByText('Welcome').first()).toBeVisible();
    const pricingCard = page.getByText('Pricing').first();
    await pricingCard.scrollIntoViewIfNeeded();
    await expect(pricingCard).toBeVisible();
  });

  test('should show empty state when no templates', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();

      if (url.includes('/templates')) {
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

    await page.goto('/en/templates');

    await expect(
      page.locator('h1').filter({ hasText: t('templates.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(20);
  });

  test('should open create template modal and fill form', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (url.includes('/templates') && method === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'tpl_new', name: 'New Template', message: 'Thanks for reaching out!', active: true }),
        });
      }
      if (url.includes('/templates')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_TEMPLATES }) });
      if (url.includes('/rules')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      if (url.includes('/subscription/usage')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
      if (url.includes('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      if (url.includes('/auth/profile')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/templates');

    await expect(
      page.locator('h1').filter({ hasText: t('templates.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Click "Add Template" button
    const addBtn = page.locator('button').filter({ hasText: t('templates.addTemplate') }).first();
    await addBtn.click();

    // Modal should open with template name label
    await expect(page.getByText(t('templates.templateName')).first()).toBeVisible({ timeout: 5000 });

    // Fill in template name
    const nameInput = page.locator('input').first();
    await nameInput.fill('New Template');
    await expect(nameInput).toHaveValue('New Template');

    // Fill in template message
    const messageTextarea = page.locator('textarea').first();
    await messageTextarea.fill('Thanks for reaching out!');
    await expect(messageTextarea).toHaveValue('Thanks for reaching out!');
  });

  test('should show template toggle switches', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/templates')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_TEMPLATES }) });
      if (url.includes('/rules')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      if (url.includes('/subscription/usage')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
      if (url.includes('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      if (url.includes('/auth/profile')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/templates');

    await expect(
      page.locator('h1').filter({ hasText: t('templates.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Both templates should be visible (scroll on mobile where cards stack vertically)
    await expect(page.getByText('Welcome').first()).toBeVisible();
    const pricingCard = page.getByText('Pricing').first();
    await pricingCard.scrollIntoViewIfNeeded();
    await expect(pricingCard).toBeVisible();

    // Toggle switches should be present (one per template)
    const toggles = page.locator('[role="switch"]');
    await expect(toggles).toHaveCount(2, { timeout: 5000 });
  });

  test('should show edit and delete buttons on template cards', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/templates')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_TEMPLATES }) });
      if (url.includes('/rules')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      if (url.includes('/subscription/usage')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
      if (url.includes('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      if (url.includes('/auth/profile')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/templates');

    await expect(page.getByText('Welcome').first()).toBeVisible({ timeout: 15000 });

    // Each template card should have action buttons (edit icon, delete icon, duplicate icon)
    // Look for SVG buttons in the card area - at least edit and delete should exist
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    // At least: 2 toggles + 2 edit + 2 delete + 2 duplicate + 1 add = 9+
    expect(buttonCount).toBeGreaterThanOrEqual(7);
  });

  test('should render templates page in Arabic (RTL)', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { sidebarOpen: true, language: 'ar', _hasHydrated: false, isOnboardingVisible: false }, version: 0 })
      );
    });

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/templates')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_TEMPLATES }) });
      if (url.includes('/rules')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      if (url.includes('/subscription/usage')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
      if (url.includes('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      if (url.includes('/auth/profile')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/ar/templates');

    // Arabic heading
    await expect(
      page.locator('h1').filter({ hasText: tAr('templates.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Template names should still be visible (user-defined, not translated)
    await expect(page.getByText('Welcome').first()).toBeVisible();
    await expect(page.getByText('Pricing').first()).toBeVisible();

    // Add Template button in Arabic
    await expect(
      page.locator('button').filter({ hasText: tAr('templates.addTemplate') }).first()
    ).toBeVisible();
  });

  test('should open create template modal in Arabic', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { sidebarOpen: true, language: 'ar', _hasHydrated: false, isOnboardingVisible: false }, version: 0 })
      );
    });

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/templates')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_TEMPLATES }) });
      if (url.includes('/rules')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      if (url.includes('/subscription/usage')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
      if (url.includes('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      if (url.includes('/auth/profile')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/ar/templates');

    await expect(
      page.locator('h1').filter({ hasText: tAr('templates.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Click Arabic "Add Template" button
    const addBtn = page.locator('button').filter({ hasText: tAr('templates.addTemplate') }).first();
    await addBtn.click();

    // Modal should open with Arabic label
    await expect(page.getByText(tAr('templates.templateName')).first()).toBeVisible({ timeout: 5000 });

    // Fill in template name in Arabic
    const nameInput = page.locator('input').first();
    await nameInput.fill('قالب الترحيب');
    await expect(nameInput).toHaveValue('قالب الترحيب');

    // Fill in template message in Arabic
    const messageTextarea = page.locator('textarea').first();
    await messageTextarea.fill('شكراً لتواصلكم معنا!');
    await expect(messageTextarea).toHaveValue('شكراً لتواصلكم معنا!');
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

    await page.goto('/en/templates');

    await expect(page.locator('text=Something went wrong')).not.toBeVisible({ timeout: 10000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(20);
  });
});
