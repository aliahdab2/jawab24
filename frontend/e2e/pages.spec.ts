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
      page.locator('h1').filter({ hasText: t('pages.titleChannels') }).first()
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
      page.locator('h1').filter({ hasText: t('pages.titleChannels') }).first()
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

    // Click to try enabling. page_2 has no Business Info, so the enable-without-info
    // soft gate (D-025) confirms first — click "Turn on anyway" to reach the API (403).
    await page2FbToggle.click();
    await page.getByRole('button', { name: t('pages.enableWithoutInfoConfirm') }).click();

    // Toast should appear with limit message
    await expect(page.getByText(t('pages.pageLimitReached'), { exact: false }).first()).toBeVisible({ timeout: 5000 });

    // Toggle should revert back to OFF
    await expect(page2FbToggle).toHaveAttribute('aria-checked', 'false');
  });

  // The genuinely-empty response ("/me/accounts returned nothing") must stay
  // quiet — no warning, no error. (Until 2026-08-23 the backend also answered
  // this way for pages HELD BY A STRANGER'S WORKSPACE, which hid the withhold
  // from the merchant; that case now returns takenCount/takenPages and is
  // covered by the test after the next one.)
  test('should not show pageTakenWarning toast when sync returns no actionable conflicts', async ({ page }) => {
    const toastSpy: string[] = [];
    page.on('console', (msg) => toastSpy.push(msg.text()));

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (method === 'POST' && url.includes('/pages/sync')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            synced: 0,
            pages: [],
            message: 'No pages found. Make sure you are an admin of at least one Facebook page and have granted the required permissions.',
          }),
        });
      }
      if (url.includes('/pages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
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

    await expect(
      page.locator('h1').filter({ hasText: t('pages.titleChannels') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Give the auto-sync useEffect time to fire and resolve the toast queue.
    await page.waitForTimeout(1500);

    // The pageTakenWarning copy starts with "{count} page(s) is/are already
    // connected to another Jawab24 account" — assert that exact phrase is
    // nowhere on screen. Substring match is robust to ICU pluralization.
    await expect(page.getByText('connected to another Jawab24 account', { exact: false })).toHaveCount(0);
  });

  // D-039: when the FB page is held by a workspace the user is NOT a member
  // of, the sync reports it as taken and names the PAGE (never the holder);
  // the UI must say so instead of staying silent. Measured live 2026-08-23:
  // the Salla review account granted «Jawab24 Test», held by the Zid test
  // workspace, and saw nothing at all.
  test('should name the withheld page when sync returns takenPages without alreadyMemberOf', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (method === 'POST' && url.includes('/pages/sync')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            synced: 0,
            pages: [],
            takenCount: 1,
            takenPages: [{ pageName: 'Jawab24 Test' }],
          }),
        });
      }
      if (url.includes('/pages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
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

    await expect(
      page.locator('h1').filter({ hasText: t('pages.titleChannels') }).first()
    ).toBeVisible({ timeout: 15000 });

    // The toast names the page and routes to support — it never names the account.
    await expect(page.getByText('Jawab24 Test', { exact: false }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('connected to another Jawab24 account', { exact: false })).toBeVisible();
  });

  // Regression guard for the actionable conflict path: when the user IS a
  // member of the workspace currently holding their FB page, the sync
  // response includes `alreadyMemberOf` and the UI must surface the
  // one-tap "Switch to ‹workspace›" CTA instead of the generic warning.
  test('should show switch-workspace CTA when sync returns alreadyMemberOf', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (method === 'POST' && url.includes('/pages/sync')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            synced: 0,
            pages: [],
            takenCount: 1,
            alreadyMemberOf: [
              {
                workspaceId: 'ws-other',
                workspaceName: 'Ali Ahdab',
                role: 'admin',
                pageName: 'Shared Page',
              },
            ],
          }),
        });
      }
      if (url.includes('/pages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
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

    await expect(
      page.locator('h1').filter({ hasText: t('pages.titleChannels') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Switch CTA label uses simple {workspaceName} interpolation (no plural),
    // so the t() helper resolves it cleanly.
    await expect(
      page.getByText(t('pages.switchWorkspaceCta', { workspaceName: 'Ali Ahdab' }), { exact: false }).first()
    ).toBeVisible({ timeout: 5000 });

    // The generic warning must NOT also fire — the two toast paths are
    // mutually exclusive (alreadyMemberOf takes precedence).
    await expect(page.getByText('connected to another Jawab24 account', { exact: false })).toHaveCount(0);
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

  // Archive (soft-hide) of a disconnected card: the merchant-facing remedy for
  // dead cards piling up after a page rotation. Nothing is deleted — the backend
  // keeps the row and restores it when the page is reconnected.
  test('archives a disconnected page from the reconnect banner', async ({ page }) => {
    let archiveCalled = false;

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();

      if (url.includes('/pages/page_dead/archive')) {
        archiveCalled = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'page_dead', archivedAt: new Date().toISOString() }),
        });
      }
      if (url.includes('/pages')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              ...MOCK_PAGES,
              {
                id: 'page_dead',
                facebookPageId: 'fb_dead',
                name: 'Rotated Out Page',
                autoReplyEnabled: false,
                instagramAutoReplyEnabled: false,
                commentsCount: 0,
                knowledgeBase: '',
                isConnected: false,
                whatsappConnected: false,
              },
            ],
          }),
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/pages');

    await expect(page.getByText('Rotated Out Page').first()).toBeVisible({ timeout: 15000 });
    // Reconnect stays the primary action on the banner
    await expect(page.getByText(t('pages.reconnectRequired')).first()).toBeVisible();

    await page.getByRole('button', { name: t('pages.archiveAction') }).click();

    // Confirmation must state the data is preserved before anything is hidden
    await expect(page.getByText(t('pages.archiveTitle')).first()).toBeVisible();
    await page.getByRole('button', { name: t('pages.archiveConfirm') }).click();

    await expect(page.getByText('Rotated Out Page')).toHaveCount(0);
    expect(archiveCalled).toBe(true);
    // The healthy cards are untouched
    await expect(page.getByText('My Business Page').first()).toBeVisible();
  });
});
