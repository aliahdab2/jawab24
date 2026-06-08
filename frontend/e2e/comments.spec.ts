import { test, expect } from '@playwright/test';
import { t } from './i18n';

/**
 * Comments Page E2E Tests
 */

const MOCK_PAGES = [
  { id: 'page_1', facebookPageId: 'fb_123', name: 'Test Page', autoReplyEnabled: true, commentsCount: 10 },
];

const MOCK_COMMENT_STATS = {
  total: 10,
  unreplied: 3,
  needsAttention: 1,
  repliedToday: 5,
  autoReplied: 6,
  resolved: 1,
  byMethod: { ai: 4, template: 2, manual: 1 },
};

const MOCK_COMMENTS = {
  data: [
    {
      id: 'c1',
      postId: 'p1',
      message: 'What are your business hours?',
      fromName: 'Jane Doe',
      replied: true,
      replyText: 'We are open 9-5 daily.',
      replyMethod: 'ai',
      pageId: 'page_1',
      createdAt: new Date().toISOString(),
      postMessage: 'Check out our new schedule!',
    },
    {
      id: 'c2',
      postId: 'p2',
      message: 'How much does it cost?',
      fromName: 'John Smith',
      replied: false,
      replyText: null,
      replyMethod: null,
      pageId: 'page_1',
      createdAt: new Date().toISOString(),
      postMessage: 'Special pricing this week!',
    },
    {
      id: 'c3',
      postId: 'p1',
      message: 'I need help with my order',
      fromName: 'Sara Ahmed',
      replied: false,
      replyText: null,
      replyMethod: null,
      pageId: 'page_1',
      createdAt: new Date().toISOString(),
      needsAttention: true,
      flagReason: 'human_requested',
    },
  ],
  pagination: { nextCursor: null },
};

test.describe('Comments Page', () => {
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
      if (url.includes('/comments/stats')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COMMENT_STATS) });
      }
      if (url.includes('/comments')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COMMENTS) });
      }
      if (url.includes('/pages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_PAGES }) });
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

  test('should render comments page with header and content', async ({ page }) => {
    await page.goto('/en/comments');

    await expect(page).toHaveTitle(/Comments/i, { timeout: 15000 });
    await expect(page.locator('h1').filter({ hasText: t('comments.title') }).first()).toBeVisible({ timeout: 15000 });

    // Should show comment text from mock data
    await expect(page.locator('text=What are your business hours?').first()).toBeVisible({ timeout: 10000 });
  });

  test('should show search input', async ({ page }) => {
    await page.goto('/en/comments');
    await expect(page.locator('input').first()).toBeVisible({ timeout: 10000 });
  });

  test('should show filter chips with counts', async ({ page }) => {
    await page.goto('/en/comments');

    // Wait for page to load
    await expect(page.locator('h1').filter({ hasText: t('comments.title') }).first()).toBeVisible({ timeout: 15000 });

    // Should show "Needs Action" filter chip with unreplied count
    await expect(page.locator('button').filter({ hasText: t('comments.needsAction') }).first()).toBeVisible({ timeout: 10000 });

    // Should show "All" filter chip
    await expect(page.locator('button').filter({ hasText: t('common.all') }).first()).toBeVisible({ timeout: 10000 });

    // Should show "Auto-replied" filter chip
    await expect(page.locator('button').filter({ hasText: t('comments.autoReplied') }).first()).toBeVisible({ timeout: 10000 });
  });

  test('should default to Needs Action filter', async ({ page }) => {
    await page.goto('/en/comments');

    await expect(page.locator('h1').filter({ hasText: t('comments.title') }).first()).toBeVisible({ timeout: 15000 });

    // The "Needs Action" chip should have active styling (brand color)
    const needsActionBtn = page.locator('button').filter({ hasText: t('comments.needsAction') }).first();
    await expect(needsActionBtn).toBeVisible({ timeout: 10000 });

    // URL should NOT have filter=all param (needs_action is default)
    expect(page.url()).not.toContain('filter=all');
  });

  test('should show post context on comment cards', async ({ page }) => {
    await page.goto('/en/comments');

    await expect(page.locator('h1').filter({ hasText: t('comments.title') }).first()).toBeVisible({ timeout: 15000 });

    // Should show post message text from mock data
    await expect(page.locator('text=Check out our new schedule!').first()).toBeVisible({ timeout: 10000 });
  });

  test('should handle legacy filter=pending param without crashing', async ({ page }) => {
    await page.goto('/en/comments?filter=pending');

    // Should NOT crash — should fall back to "Needs Action" filter
    await expect(page.locator('h1').filter({ hasText: t('comments.title') }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();

    // The "Needs Action" chip should be active (fallback from invalid "pending")
    const needsActionBtn = page.locator('button[aria-pressed="true"]').filter({ hasText: t('comments.needsAction') });
    await expect(needsActionBtn).toBeVisible({ timeout: 10000 });
  });

  test('should handle legacy filter=flagged param without crashing', async ({ page }) => {
    await page.goto('/en/comments?filter=flagged');

    await expect(page.locator('h1').filter({ hasText: t('comments.title') }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  test('should group comments from the same person on the same post', async ({ page }) => {
    const groupedComments = {
      data: [
        {
          id: 'g1',
          postId: 'p1',
          fromId: 'user1',
          fromName: 'Jane Doe',
          message: 'Follow-up: when do you open?',
          replied: false,
          replyText: null,
          replyMethod: null,
          pageId: 'page_1',
          createdAt: new Date(Date.now() - 1000).toISOString(),
          postMessage: 'Check out our new schedule!',
        },
        {
          id: 'g2',
          postId: 'p1',
          fromId: 'user1',
          fromName: 'Jane Doe',
          message: 'What are your business hours?',
          replied: false,
          replyText: null,
          replyMethod: null,
          pageId: 'page_1',
          createdAt: new Date(Date.now() - 60000).toISOString(),
          postMessage: 'Check out our new schedule!',
        },
        {
          id: 'g3',
          postId: 'p2',
          fromId: 'user2',
          fromName: 'John Smith',
          message: 'How much does it cost?',
          replied: false,
          replyText: null,
          replyMethod: null,
          pageId: 'page_1',
          createdAt: new Date(Date.now() - 2000).toISOString(),
        },
      ],
      pagination: { nextCursor: null },
    };

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/comments/stats')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COMMENT_STATS) });
      }
      if (url.includes('/comments')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(groupedComments) });
      }
      if (url.includes('/pages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_PAGES }) });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/comments?filter=all');
    await expect(page.locator('h1').filter({ hasText: t('comments.title') }).first()).toBeVisible({ timeout: 15000 });

    // Wait for comments to render
    await expect(page.locator('text=Follow-up: when do you open?').first()).toBeVisible({ timeout: 10000 });

    // Jane's 2 comments on same post should be grouped — show count badge
    await expect(page.locator('text=2 comments').first()).toBeVisible({ timeout: 10000 });

    // Click expand to see earlier comment
    await page.locator('text=Show earlier comments').first().click();
    await expect(page.locator('text=What are your business hours?').first()).toBeVisible();
  });

  test('should not crash when APIs fail', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      await route.fulfill({ status: 500, body: 'Error' });
    });

    await page.goto('/en/comments');
    await expect(page).toHaveTitle(/Comments/i, { timeout: 15000 });
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  test('should hide page filter when only one active page', async ({ page }) => {
    await page.goto('/en/comments');
    await expect(page.locator('h1').filter({ hasText: t('comments.title') }).first()).toBeVisible({ timeout: 15000 });

    // MOCK_PAGES has only 1 page — dropdown should NOT appear
    await expect(page.getByText(t('common.allPages'))).not.toBeVisible();
  });

  test('should show page filter when multiple active pages', async ({ page }) => {
    const TWO_PAGES = [
      { id: 'page_1', facebookPageId: 'fb_123', name: 'Page One', autoReplyEnabled: true },
      { id: 'page_2', facebookPageId: 'fb_456', name: 'Page Two', autoReplyEnabled: true },
    ];

    await page.route('**/api/pages**', async (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: TWO_PAGES }) });
    });

    await page.goto('/en/comments');
    await expect(page.locator('h1').filter({ hasText: t('comments.title') }).first()).toBeVisible({ timeout: 15000 });

    // Dropdown should be visible with "All Pages" text
    await expect(page.getByText(t('common.allPages')).first()).toBeVisible({ timeout: 10000 });
  });

  test('should pass pageId to API when page filter is selected', async ({ page }) => {
    const TWO_PAGES = [
      { id: 'page_1', facebookPageId: 'fb_123', name: 'Page One', autoReplyEnabled: true },
      { id: 'page_2', facebookPageId: 'fb_456', name: 'Page Two', autoReplyEnabled: true },
    ];

    let lastCommentsUrl = '';
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/comments/stats')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COMMENT_STATS) });
      }
      if (url.includes('/comments')) {
        lastCommentsUrl = url;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COMMENTS) });
      }
      if (url.includes('/pages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: TWO_PAGES }) });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/comments');
    await expect(page.locator('h1').filter({ hasText: t('comments.title') }).first()).toBeVisible({ timeout: 15000 });

    // Click the page dropdown and select "Page Two"
    await page.getByText(t('common.allPages')).first().click();
    await page.getByText('Page Two').click();

    // Wait for the filtered API call
    await page.waitForTimeout(500);

    // URL should have page param
    expect(page.url()).toContain('page=page_2');

    // API call should include pageId
    expect(lastCommentsUrl).toContain('pageId=page_2');
  });
});

test.describe('Comments — SSE realtime updates', () => {
  test('should remove auto-replied comment from Needs Action tab without refresh', async ({ page }) => {
    page.on('pageerror', (err) => console.error(`PAGE ERROR: ${err}`));

    // Stub EventSource so the test can dispatch SSE events deterministically.
    await page.addInitScript(() => {
      class FakeEventSource {
        url: string;
        withCredentials: boolean;
        readyState = 1;
        onopen: ((e: Event) => void) | null = null;
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: Event) => void) | null = null;
        private listeners = new Map<string, Set<(e: MessageEvent) => void>>();
        constructor(url: string, init?: { withCredentials?: boolean }) {
          this.url = url;
          this.withCredentials = !!init?.withCredentials;
          (window as unknown as { __fakeES?: FakeEventSource }).__fakeES = this;
          setTimeout(() => this.dispatch('connected', '{}'), 0);
        }
        addEventListener(type: string, fn: (e: MessageEvent) => void) {
          if (!this.listeners.has(type)) this.listeners.set(type, new Set());
          this.listeners.get(type)!.add(fn);
        }
        removeEventListener(type: string, fn: (e: MessageEvent) => void) {
          this.listeners.get(type)?.delete(fn);
        }
        close() { this.readyState = 2; }
        dispatch(type: string, data: string) {
          const evt = new MessageEvent(type, { data });
          this.listeners.get(type)?.forEach(fn => fn(evt));
        }
      }
      (window as unknown as { EventSource: typeof EventSource }).EventSource =
        FakeEventSource as unknown as typeof EventSource;
    });

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

    // Backend filter: actionRequired = !resolved AND (!replied OR needsAttention).
    // First call returns the pending comment; after the SSE auto-reply, the
    // refetch returns an empty list (server-side filter would have dropped it).
    const pendingComment = {
      id: 'c-pending',
      postId: 'p1',
      message: 'When do you open?',
      fromName: 'Lina Hassan',
      replied: false,
      replyText: null,
      replyMethod: null,
      pageId: 'page_1',
      createdAt: new Date().toISOString(),
      postMessage: 'New schedule!',
    };

    let commentsCallCount = 0;
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/comments/stats')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COMMENT_STATS) });
      }
      if (url.includes('/comments')) {
        commentsCallCount++;
        const body = commentsCallCount === 1
          ? { data: [pendingComment], pagination: { nextCursor: null } }
          : { data: [], pagination: { nextCursor: null } };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
      if (url.includes('/pages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_PAGES }) });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/comments');
    await expect(page.locator('h1').filter({ hasText: t('comments.title') }).first()).toBeVisible({ timeout: 15000 });

    // The pending comment is visible on the default Needs Action tab.
    await expect(page.locator('text=When do you open?').first()).toBeVisible({ timeout: 10000 });

    // Auto-reply arrives via SSE.
    await page.evaluate(() => {
      const es = (window as unknown as { __fakeES?: { dispatch: (t: string, d: string) => void } }).__fakeES;
      es?.dispatch(
        'comment:reply_sent',
        JSON.stringify({
          data: {
            commentId: 'c-pending',
            replyText: 'We open at 9am.',
            replyMethod: 'ai',
            senderName: 'Lina Hassan',
            pageId: 'page_1',
          },
        }),
      );
    });

    // The list should refetch and the comment should be gone — no manual refresh.
    await expect(page.locator('text=When do you open?')).toHaveCount(0, { timeout: 5000 });
  });
});

test.describe('Comment Detail Modal', () => {
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
      if (url.includes('/comments/stats')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COMMENT_STATS) });
      }
      if (url.includes('/comments')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COMMENTS) });
      }
      if (url.includes('/pages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_PAGES }) });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/comments?filter=all');
    await expect(page.locator('h1').filter({ hasText: t('comments.title') }).first()).toBeVisible({ timeout: 15000 });
    // Wait for comments to load
    await expect(page.locator('text=What are your business hours?').first()).toBeVisible({ timeout: 10000 });
  };

  test('should open comment detail modal when clicking a comment', async ({ page }) => {
    await setupPage(page);
    await page.locator('text=What are your business hours?').first().click();

    // Modal should open (identified by dialog role)
    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5000 });
    // Sender name should appear
    await expect(page.locator('text=Jane Doe').first()).toBeVisible();
  });

  test('should show customer comment as incoming chat bubble', async ({ page }) => {
    await setupPage(page);
    await page.locator('text=What are your business hours?').first().click();

    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5000 });

    // The comment text should be visible in the chat thread
    await expect(page.locator('text=What are your business hours?').nth(1)).toBeVisible();
  });

  test('should show existing reply as outgoing chat bubble', async ({ page }) => {
    await setupPage(page);
    await page.locator('text=What are your business hours?').first().click();

    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5000 });

    // The existing reply should appear in the modal
    await expect(page.locator('text=We are open 9-5 daily.').first()).toBeVisible();
  });

  test('should show compose textarea in footer for unreplied comments', async ({ page }) => {
    await setupPage(page);
    // Click the unreplied comment (John Smith)
    await page.locator('text=How much does it cost?').first().click();

    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5000 });

    // Compose textarea should be in the footer and ready to type. Auto-focus is
    // intentionally off while prev/next navigation is active (opening from the list)
    // so the keyboard doesn't pop and shift the modal height between comments.
    const textarea = page.locator(`textarea[aria-label="${t('comments.typeReply')}"]`);
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeEditable();
  });

  test('shows a follow-up composer for already-replied comments', async ({ page }) => {
    await setupPage(page);
    // Click the replied comment (Jane Doe)
    await page.locator('text=What are your business hours?').first().click();

    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5000 });

    // The composer is always available now: even an already-replied comment can
    // get a manual follow-up reply, which keeps the modal footer consistent while
    // arrowing between comments. Replied comments use the "follow-up" placeholder.
    const textarea = page.locator(`textarea[aria-label="${t('comments.typeReply')}"]`);
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveAttribute('placeholder', t('comments.followUpReply'));
  });

  test('should close modal when X button is clicked', async ({ page }) => {
    await setupPage(page);
    await page.locator('text=What are your business hours?').first().click();

    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5000 });

    await page.locator(`button[aria-label="${t('comments.close')}"]`).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });
  });

  test('should close modal when ESC is pressed', async ({ page }) => {
    await setupPage(page);
    await page.locator('text=What are your business hours?').first().click();

    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });
  });

  test('should show post context snippet in chat thread', async ({ page }) => {
    await setupPage(page);
    await page.locator('text=What are your business hours?').first().click();

    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5000 });

    // Post context shown in chat area
    await expect(page.locator('text=Check out our new schedule!').first()).toBeVisible();
  });

  test('should show resolve button for needs-attention comment', async ({ page }) => {
    await setupPage(page);
    // Sara Ahmed's comment has needsAttention: true
    await page.locator('text=I need help with my order').first().click();

    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5000 });

    // Resolve / "Mark as handled" button should appear in footer
    await expect(page.locator(`button:has-text("${t('comments.resolve')}")`).first()).toBeVisible();
  });
});
