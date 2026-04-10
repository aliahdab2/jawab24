import { test, expect } from '@playwright/test';
import { t } from './i18n';

/**
 * Messages Page E2E Tests
 */

const MOCK_MESSAGE_STATS = { total: 25, replied: 18, pending: 7, needsAttention: 2 };

const MOCK_MESSAGES = {
  data: [
    {
      id: 'm1',
      senderName: 'Alice Brown',
      lastMessage: 'Hi, I need help with my order',
      replied: true,
      replyMethod: 'ai',
      pageId: 'page_1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'm2',
      senderName: 'Bob Wilson',
      lastMessage: 'Do you ship internationally?',
      replied: false,
      replyMethod: null,
      pageId: 'page_1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  pagination: { nextCursor: null },
};

test.describe('Messages Page', () => {
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
      if (url.includes('/messages/stats')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MESSAGE_STATS) });
      }
      if (url.includes('/messages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MESSAGES) });
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

  test('should render messages page with header and content', async ({ page }) => {
    await page.goto('/en/messages');

    await expect(page).toHaveTitle(/Messages.*Jawab24/i);
    await expect(page.locator('h1').filter({ hasText: t('messages.title') }).first()).toBeVisible({ timeout: 15000 });

    // Should show message sender from mock data
    await expect(page.locator('text=Alice Brown').first()).toBeVisible({ timeout: 10000 });
  });

  test('should show stat cards with numbers', async ({ page }) => {
    await page.goto('/en/messages');

    // Total messages count from mock
    await expect(page.locator('text=25').first()).toBeVisible({ timeout: 10000 });
  });

  test('should not crash when APIs fail', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      await route.fulfill({ status: 500, body: 'Error' });
    });

    await page.goto('/en/messages');
    await expect(page).toHaveTitle(/Messages.*Jawab24/i, { timeout: 15000 });
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });
});

test.describe('Message Detail Modal', () => {
  // Flat Message[] shape — matches what /messages API returns.
  // The page groups these client-side into Conversation objects by senderId.
  const MOCK_FLAT_MESSAGES = {
    data: [
      {
        id: 'msg1',
        platformMessageId: 'fb_msg1',
        senderId: 'sender_1',
        senderName: 'Bob Wilson',
        pageId: 'page_1',
        direction: 'incoming',
        message: 'Do you ship internationally?',
        replied: false,
        replyText: null,
        replyMethod: null,
        resolved: false,
        flagReason: null,
        createdAt: new Date(Date.now() - 60000).toISOString(),
        repliedAt: null,
      },
    ],
    pagination: { hasMore: false, nextCursor: null, limit: 50 },
  };

  // Full thread returned by /messages/conversation/:senderId inside the modal
  const MOCK_THREAD = [
    {
      id: 'msg1',
      platformMessageId: 'fb_msg1',
      senderId: 'sender_1',
      senderName: 'Bob Wilson',
      pageId: 'page_1',
      direction: 'incoming',
      message: 'Do you ship internationally?',
      replied: false,
      replyText: null,
      replyMethod: null,
      resolved: false,
      flagReason: null,
      createdAt: new Date(Date.now() - 60000).toISOString(),
      repliedAt: null,
    },
  ];

  const setupPage = async (page: import('@playwright/test').Page) => {
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
      if (url.includes('/messages/stats')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MESSAGE_STATS) });
      }
      // Full thread fetch inside the modal (getConversation)
      if (url.match(/\/messages\/conversation\//)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_THREAD) });
      }
      // Pause-status fetch inside the modal
      if (url.includes('/pause-status')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ paused: false, pausedUntil: null, remainingMinutes: null }) });
      }
      // Flat messages list (what the page fetches)
      if (url.includes('/messages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FLAT_MESSAGES) });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/messages');
    await expect(page.locator('h1').filter({ hasText: t('messages.title') }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Bob Wilson').first()).toBeVisible({ timeout: 10000 });
  };

  test('should open message detail modal when clicking a conversation', async ({ page }) => {
    await setupPage(page);
    await page.locator('text=Bob Wilson').first().click();

    // Modal opens — message text visible inside thread
    await expect(page.locator('text=Do you ship internationally?').first()).toBeVisible({ timeout: 8000 });
  });

  test('should show reply compose textarea in modal footer', async ({ page }) => {
    await setupPage(page);
    await page.locator('text=Bob Wilson').first().click();

    // Compose textarea should always be visible in message modal
    const textarea = page.locator(`textarea[aria-label="${t('messages.typeReply')}"]`);
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });

  test('should show resolve button for unreplied messages', async ({ page }) => {
    await setupPage(page);
    await page.locator('text=Bob Wilson').first().click();

    // Resolve / "Mark as handled" button should appear in actions row
    await expect(page.locator(`button:has-text("${t('comments.resolve')}")`).first()).toBeVisible({ timeout: 5000 });
  });

  test('should show pause smart reply button in actions row', async ({ page }) => {
    await setupPage(page);
    await page.locator('text=Bob Wilson').first().click();

    await expect(page.locator(`button:has-text("${t('messages.pauseSmartReply')}")`).first()).toBeVisible({ timeout: 5000 });
  });
});
