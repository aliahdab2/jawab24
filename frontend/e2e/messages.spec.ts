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
      if (url.includes('/pages')) {
        // /pages returns a PLAIN ARRAY (not { data: [...] }) — matches pagesApi.getAll().
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'page_1', facebookPageId: 'fb_123', name: 'Test Page', autoReplyEnabled: true }]) });
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

  test('should hide page filter when only one active page', async ({ page }) => {
    // Default mock has no /pages route — add one with 1 page
    await page.route('**/api/pages**', async (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'page_1', name: 'Only Page', autoReplyEnabled: true }]) });
    });

    await page.goto('/en/messages');
    await expect(page.locator('h1').filter({ hasText: t('messages.title') }).first()).toBeVisible({ timeout: 15000 });

    // Only 1 active page — dropdown should NOT appear
    await expect(page.getByText(t('common.allPages'))).not.toBeVisible();
  });

  test('should show page filter when multiple active pages', async ({ page }) => {
    await page.route('**/api/pages**', async (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { id: 'page_1', name: 'Page One', autoReplyEnabled: true },
        { id: 'page_2', name: 'Page Two', autoReplyEnabled: true },
      ]) });
    });

    await page.goto('/en/messages');
    await expect(page.locator('h1').filter({ hasText: t('messages.title') }).first()).toBeVisible({ timeout: 15000 });

    // Dropdown should be visible
    await expect(page.getByText(t('common.allPages')).first()).toBeVisible({ timeout: 10000 });
  });

  /**
   * Desktop half of the mobile chip fix (mobile-layout.spec.ts owns the phone).
   *
   * The chips grow to fill the row below `sm` only. From `sm` up the row shares
   * its line with the search box, so a chip that kept growing there would eat
   * the search field — that is what `sm:flex-none` prevents, and this is the
   * only test that would notice if the variant stopped applying.
   */
  test('the filter chips keep their natural width beside the search box', async ({ page }) => {
    await page.goto('/en/messages');
    await expect(page.locator('h1').filter({ hasText: t('messages.title') }).first()).toBeVisible({ timeout: 15000 });

    const row = page.getByRole('group', { name: t('messages.title') });
    await expect(row).toBeVisible({ timeout: 10000 });

    const spend = await row.evaluate((el) => {
      const chips = Array.from(el.querySelectorAll('button'));
      const rowWidth = el.getBoundingClientRect().width;
      const used = chips.reduce((sum, c) => sum + c.getBoundingClientRect().width, 0);
      return { rowWidth, used };
    });

    // Content-sized: the four chips leave the row with room to spare. If they
    // stretched, `used` would meet `rowWidth` — the mobile behaviour leaking up.
    expect(spend.used, 'the chips stretched on a wide screen').toBeLessThan(spend.rowWidth - 40);

    // And the search box still has its own width beside them.
    const search = page.getByRole('search');
    const searchBox = (await search.first().boundingBox())!;
    expect(searchBox.width, 'the search box was squeezed').toBeGreaterThan(200);
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
      // /pages returns a plain array (not { data: [...] })
      if (url.includes('/pages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
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

  test('opening a conversation adds ?conversation= to the URL', async ({ page }) => {
    await setupPage(page);
    await page.locator('text=Bob Wilson').first().click();

    // Modal opens — then URL reflects the selection
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 8000 });
    await expect(page).toHaveURL(/\?conversation=sender_1/);
  });

  test('browser back closes the modal without leaving /messages', async ({ page }) => {
    await setupPage(page);
    await page.locator('text=Bob Wilson').first().click();

    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 8000 });
    await expect(page).toHaveURL(/\?conversation=sender_1/);

    await page.goBack();

    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/en\/messages(\?|$)/);
    await expect(page).not.toHaveURL(/conversation=/);
  });

  test('X button closes the modal and strips the query param', async ({ page }) => {
    await setupPage(page);
    await page.locator('text=Bob Wilson').first().click();

    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 8000 });

    await page.locator(`.modal-overlay button[aria-label="${t('comments.close')}"]`).click();

    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 5000 });
    await expect(page).not.toHaveURL(/conversation=/);
  });
});
