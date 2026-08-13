import { test, expect } from '@playwright/test';
import { t } from './i18n';

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
  repliedToday: 3,
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
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Primary tile (MOCK_USAGE = 20 / 100). Since PR #118 the headline shows
    // only the used count ("20") with the limit as a muted subtext ("of 100")
    // so Arabic compact numerals don't overflow. Assert both parts separately.
    await expect(page.getByText('20', { exact: true }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('of 100')).toBeVisible({ timeout: 15000 });

    // Replied Today should show 8 (5 comments + 3 messages)
    await expect(page.getByText('8', { exact: true }).first()).toBeVisible({ timeout: 15000 });

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
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });

    // SmartStatusBanner uses needsAttention: comments (3) + messages (1) = 4
    await expect(page.getByText(/4.*items need your attention/i)).toBeVisible({ timeout: 15000 });

    // Breakdown should show needsAttention counts (in the header button)
    // Uses ICU plural keys: "3 Comments · 1 Message" (capitalisation varies by key)
    await expect(page.getByText(/3\s+comments?\s*·\s*1\s+messages?/i)).toBeVisible();

    // Banner should be expandable (has a chevron toggle)
    const expandButton = page.getByRole('button', { name: /items need your attention/i });
    await expect(expandButton).toHaveAttribute('aria-expanded', 'false');
  });

  // Leads row in the attention banner. Origin (2026-08-04): a paying merchant had
  // 19 unworked leads and the dashboard mentioned them nowhere — the section was
  // reachable only from the nav, so he never opened it.
  test('should surface waiting leads in the attention banner and count them in the total', async ({ page }) => {
    await page.route('**/api/leads/count**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 19,
          latestName: 'Feras',
          latestAt: new Date().toISOString(),
          // The row shows the OLDEST wait, so give it one to show.
          oldestAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
        }),
      });
    });

    await page.goto('/en/dashboard');
    await expect(
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });

    // 3 comments + 1 message + 19 leads
    await expect(page.getByText(/23.*items need your attention/i)).toBeVisible({ timeout: 15000 });

    // The leads row appears in the expanded list and links to /leads
    await page.getByRole('button', { name: /items need your attention/i }).click();
    // href$= matches both "/leads" and the locale-prefixed "/en/leads" Next emits.
    const leadsLink = page.locator('a[href$="/leads"]').filter({ hasText: /waiting/i });
    await expect(leadsLink).toHaveCount(1);
    await expect(leadsLink).toContainText('Feras');
  });

  test('should hide banner when no items need action', async ({ page }) => {
    // Override stats to have needsAttention = 0 for both comments and messages
    await page.route('**/api/comments/stats**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...MOCK_COMMENT_STATS, needsAttention: 0 }),
      });
    });
    await page.route('**/api/messages/stats**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...MOCK_MESSAGE_STATS, needsAttention: 0 }),
      });
    });

    await page.goto('/en/dashboard');

    await expect(
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Banner should NOT be visible when count is 0
    await expect(page.getByText(/items need your attention/i)).not.toBeVisible({ timeout: 5000 });
  });

  test('should not show only an image or icon as page content', async ({ page }) => {
    await page.goto('/en/dashboard');

    // Wait for dashboard content to render
    await expect(
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
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

    // Within 15 seconds, actual stat values should appear.
    // Use waitForSelector to avoid visibility issues inside overflow containers on mobile.
    await page.waitForSelector('text=/\\d+/', { state: 'attached', timeout: 15000 });

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
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('should auto-expand single page accordion on load', async ({ page }) => {
    await page.goto('/en/dashboard');

    // Wait for dashboard to load
    await expect(
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });

    // With only 1 page, the accordion should auto-expand
    const pageButton = page.locator('button[id^="page-header-"]', { hasText: /Test Business Page/i });
    await expect(pageButton).toBeVisible({ timeout: 15000 });
    await expect(pageButton).toHaveAttribute('aria-expanded', 'true');

    // The expanded panel should show the "Manage Page" CTA link.
    // Exact match: the pages usage bar can also render a "Manage Pages" (plural)
    // CTA when at/over the limit, and a loose regex would match both.
    const manageLink = page.getByRole('link', { name: t('dashboard.pageAccordion.managePage'), exact: true });
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
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
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

  test('should hide disconnected pages from Your Pages section', async ({ page }) => {
    const pagesWithDisconnected = [
      { ...MOCK_PAGES[0], isConnected: true },
      {
        id: 'page_disconnected',
        facebookPageId: 'fb_999',
        name: 'Disconnected Page',
        autoReplyEnabled: false,
        isConnected: false,
        commentsCount: 0,
        repliesCount: 0,
        replyRate: 0,
        createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      },
    ];

    await page.route('**/api/pages**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: pagesWithDisconnected }),
      });
    });

    await page.goto('/en/dashboard');

    await expect(
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Connected page should be visible in the accordion
    const connectedButton = page.locator('button[id^="page-header-"]', { hasText: /Test Business Page/i });
    await expect(connectedButton).toBeVisible({ timeout: 15000 });

    // Disconnected page should NOT appear in the dashboard
    await expect(page.getByText('Disconnected Page')).not.toBeVisible();
  });

  test('should show empty state when all pages are disconnected', async ({ page }) => {
    const allDisconnected = [
      {
        id: 'page_dc1',
        facebookPageId: 'fb_dc1',
        name: 'Old Page',
        autoReplyEnabled: false,
        isConnected: false,
        commentsCount: 0,
        repliesCount: 0,
        replyRate: 0,
        createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      },
    ];

    await page.route('**/api/pages**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: allDisconnected }),
      });
    });

    await page.goto('/en/dashboard');

    await expect(
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Disconnected page should not be shown
    await expect(page.getByText('Old Page')).not.toBeVisible();

    // Empty state CTA should be visible
    await expect(page.getByRole('button', { name: t('pages.connectPage') })).toBeVisible();
  });

  test('should open CommentDetailModal when clicking a comment in the needs-attention banner', async ({ page }) => {
    const unrepliedComment = {
      id: 'c_banner',
      message: 'Is delivery available?',
      fromName: 'Banner Commenter',
      replied: false,
      resolved: false,
      needsAttention: true,
      pageId: 'page_1',
      createdAt: new Date().toISOString(),
    };

    // Override comments endpoints: preserve stats shape, return unreplied comment for list queries
    await page.route('**/api/comments**', async (route) => {
      const url = route.request().url();
      if (url.includes('/stats')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_COMMENT_STATS, unreplied: 1, needsAttention: 1 }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [unrepliedComment] }),
      });
    });

    await page.goto('/en/dashboard');

    await expect(
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Expand the banner
    const expandButton = page.getByRole('button', { name: /items need your attention/i });
    await expandButton.click();

    // Click the comment item in the banner
    await page.getByText('Is delivery available?').first().click();

    // CommentDetailModal should open showing the commenter's name and message
    await expect(page.getByText('Banner Commenter').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Is delivery available?').first()).toBeVisible();
  });

  test('should open MessageDetailModal when clicking a message in the needs-attention banner', async ({ page }) => {
    const bannerMessage = {
      id: 'msg_1',
      senderId: 'sender_banner',
      senderName: 'Banner Sender',
      message: 'Do you ship internationally?',
      direction: 'incoming',
      replied: false,
      needsAttention: true,
      pageId: 'page_1',
      createdAt: new Date().toISOString(),
    };

    // Override messages endpoints: preserve stats shape, return banner message for list/conversation queries
    await page.route('**/api/messages**', async (route) => {
      const url = route.request().url();
      if (url.includes('/stats')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_MESSAGE_STATS, pending: 1, needsAttention: 1 }),
        });
      }
      if (url.includes('/conversation/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([bannerMessage]),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [bannerMessage] }),
      });
    });

    await page.goto('/en/dashboard');

    await expect(
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Expand the banner
    const expandButton = page.getByRole('button', { name: /items need your attention/i });
    await expandButton.click();

    // Click the message item in the banner
    await page.getByText('Do you ship internationally?').first().click();

    // MessageDetailModal should open showing the sender's name
    await expect(page.getByText('Banner Sender').first()).toBeVisible({ timeout: 5000 });
  });

  test('should dismiss banner via X button and persist across navigation', async ({ page }) => {
    await page.goto('/en/dashboard');

    await expect(
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Banner should be visible initially
    const banner = page.getByRole('button', { name: /items need your attention/i });
    await expect(banner).toBeVisible({ timeout: 15000 });

    // Click the dismiss button (desktop X)
    // Target the SmartStatusBanner's dismiss by its exact label — several
    // dashboard surfaces carry a close control, so /dismiss/i is not specific
    // enough. (The setup-checklist card's control is now "Collapse".)
    const dismissButton = page.getByRole('button', { name: t('dashboard.smartBanner.dismissLabel') });
    await dismissButton.click();

    // Banner should disappear
    await expect(banner).not.toBeVisible({ timeout: 5000 });

    // Navigate away and back — banner should stay dismissed
    await page.goto('/en/settings');
    await page.goto('/en/dashboard');
    await expect(
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/items need your attention/i)).not.toBeVisible({ timeout: 5000 });
  });

  test('should re-show banner when item count increases after dismiss', async ({ page }) => {
    await page.goto('/en/dashboard');

    await expect(
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Dismiss the banner
    // Target the SmartStatusBanner's dismiss by its exact label — several
    // dashboard surfaces carry a close control, so /dismiss/i is not specific
    // enough. (The setup-checklist card's control is now "Collapse".)
    const dismissButton = page.getByRole('button', { name: t('dashboard.smartBanner.dismissLabel') });
    await dismissButton.click();
    await expect(page.getByText(/items need your attention/i)).not.toBeVisible({ timeout: 5000 });

    // Override stats with higher needsAttention counts and reload
    await page.route('**/api/comments/stats**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...MOCK_COMMENT_STATS, needsAttention: 10 }),
      });
    });
    await page.route('**/api/messages/stats**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...MOCK_MESSAGE_STATS, needsAttention: 5 }),
      });
    });

    await page.goto('/en/dashboard');
    await expect(
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Banner should re-appear since count increased (15 > 4)
    await expect(page.getByText(/items need your attention/i)).toBeVisible({ timeout: 15000 });
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

  test('should show quota badge when usage exceeds limit', async ({ page }) => {
    await page.route('**/api/subscription/usage**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            subscription: { plan: { name: 'Starter' }, status: 'active' },
            aiReplies: { used: 2380, limit: 1000, percentUsed: 238 },
            pages: { used: 1, limit: 1, percentUsed: 100 },
          },
        }),
      });
    });

    await page.goto('/en/dashboard');
    await expect(
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Should show "Over limit" badge in the Command Center
    await expect(page.getByText(t('dashboard.commandCenter.quotaExceeded')).first()).toBeVisible({ timeout: 10000 });
  });

  test('should not show quota badge when usage is within limit', async ({ page }) => {
    await page.goto('/en/dashboard');
    await expect(
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Default mock has 20% usage — no badge should appear
    await expect(page.getByText(t('dashboard.commandCenter.quotaExceeded'))).not.toBeVisible();
  });

  test('post-suggestion pilot card must NOT render for a standard (non-founder) workspace', async ({ page }) => {
    // The card's gate is a NEXT_PUBLIC_* allowlist compiled into the REAL
    // bundle — the one wiring unit tests (which mock the flag module) cannot
    // see. The standard test workspace is outside the founder allowlist, so
    // any appearance here is a fleet-wide leak of the dark feature.
    await page.goto('/en/dashboard');
    await expect(
      page.locator('h1').filter({ hasText: t('dashboard.greeting') }).first()
    ).toBeVisible({ timeout: 15000 });

    await expect(page.getByText(t('postSuggestions.cardTitle'))).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('postSuggestions.cardCta') })).toHaveCount(0);
  });
});
