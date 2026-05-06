import { test, expect } from '@playwright/test';
import { t } from './i18n';

/**
 * Knowledge Base (KB) Modal E2E Tests
 *
 * Verifies the KB editing modal renders, sections work, save button
 * is visible, raw mode toggles, and character limits display correctly.
 */

const MOCK_PAGES = [
  {
    id: 'page_1',
    facebookPageId: 'fb_123',
    name: 'My Business Page',
    autoReplyEnabled: true,
    instagramAutoReplyEnabled: false,
    commentsCount: 10,
    knowledgeBase: '📦 Products & Services\n- Basic package: 500 SAR/month\n- Premium: 1500 SAR/month\n\n📝 Other Notes\nWorking hours 9-5, Sunday to Thursday',
    kbActiveVersion: 1,
  },
  {
    id: 'page_2',
    facebookPageId: 'fb_456',
    name: 'Empty Page',
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

function setupMockRoutes(page: import('@playwright/test').Page) {
  return page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (method === 'PUT' && url.includes('/pages/') && url.includes('/knowledge-base')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    }
    if (url.includes('/pages') && url.includes('/gaps')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
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
        body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }),
      });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test.describe('Knowledge Base Modal', () => {
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

  test('should open KB modal and show title and page name', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto('/en/pages');

    await expect(page.getByText('My Business Page').first()).toBeVisible({ timeout: 15000 });

    // Click the KB button to open the modal
    const kbButton = page.getByText(t('kb.title')).first();
    await kbButton.click();

    // Modal should be visible with title
    const modal = page.locator('.modal-overlay').last();
    await expect(modal).toBeVisible();
    await expect(modal.getByText(t('kb.title'))).toBeVisible();
  });

  test('should show save button visible without scrolling', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto('/en/pages');

    await expect(page.getByText('My Business Page').first()).toBeVisible({ timeout: 15000 });

    const kbButton = page.getByText(t('kb.title')).first();
    await kbButton.click();

    // Save button should be visible
    const saveButton = page.getByRole('button', { name: t('common.save') });
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await expect(saveButton).toBeEnabled();
  });

  test('should display existing KB sections', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto('/en/pages');

    await expect(page.getByText('My Business Page').first()).toBeVisible({ timeout: 15000 });

    const kbButton = page.getByText(t('kb.title')).first();
    await kbButton.click();

    // Should show section labels from KB content
    await expect(page.getByText(t('kb.section.productsLabel')).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(t('kb.section.notesLabel')).first()).toBeVisible();
  });

  test('should toggle raw text mode', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto('/en/pages');

    await expect(page.getByText('My Business Page').first()).toBeVisible({ timeout: 15000 });

    const kbButton = page.getByText(t('kb.title')).first();
    await kbButton.click();

    // Click "Show Raw Text" toggle
    const rawToggle = page.getByText(t('kb.showRawText'));
    await expect(rawToggle).toBeVisible({ timeout: 5000 });
    await rawToggle.click();

    // Should show "Back to Sections" and a textarea with raw content
    await expect(page.getByText(t('kb.hideRawText'))).toBeVisible();
    const textarea = page.locator('textarea');
    await expect(textarea.first()).toBeVisible();

    // Toggle back
    await page.getByText(t('kb.hideRawText')).click();
    await expect(page.getByText(t('kb.showRawText'))).toBeVisible();
  });

  test('should show "Add new section" button', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto('/en/pages');

    await expect(page.getByText('My Business Page').first()).toBeVisible({ timeout: 15000 });

    const kbButton = page.getByText(t('kb.title')).first();
    await kbButton.click();

    await expect(page.getByText(t('kb.addCustomSection'))).toBeVisible({ timeout: 5000 });
  });

  test('should close modal with X button', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto('/en/pages');

    await expect(page.getByText('My Business Page').first()).toBeVisible({ timeout: 15000 });

    const kbButton = page.getByText(t('kb.title')).first();
    await kbButton.click();

    // Modal should be open
    await expect(page.getByText(t('kb.title')).last()).toBeVisible({ timeout: 5000 });

    // Click close button (X)
    const closeButton = page.locator('button').filter({ has: page.locator('svg.lucide-x') }).last();
    await closeButton.click();

    // Modal backdrop should disappear
    await expect(page.locator('.modal-overlay')).toBeHidden({ timeout: 5000 });
  });

  test('should save KB and show success state', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto('/en/pages');

    await expect(page.getByText('My Business Page').first()).toBeVisible({ timeout: 15000 });

    const kbButton = page.getByText(t('kb.title')).first();
    await kbButton.click();

    // Click save
    const saveButton = page.getByRole('button', { name: t('common.save') });
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await saveButton.click();

    // Should show saved state
    await expect(page.getByRole('button', { name: t('pages.savedStatus') })).toBeVisible({ timeout: 5000 });
  });
});
