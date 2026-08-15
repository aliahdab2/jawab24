import { test, expect } from '@playwright/test';
import { t } from './i18n';

/**
 * Business Info (knowledge base) editor E2E
 *
 * Since GA (#759, 2026-08-15) the structured /business page is the canonical
 * Business Info surface for ALL merchants: every entry point on /pages funnels
 * through `openKbEditorFor` and routes to /business?page=<id>. The legacy
 * free-text KnowledgeBaseModal survives only behind the in-conversation flows
 * (InlineKbEditorModal); it is no longer reachable from /pages.
 *
 * These tests pin both halves of that contract:
 *   1. the /pages entry point ROUTES to /business — never opens a modal;
 *   2. the KnowledgeBasePanel hosted on /business still delivers the editor
 *      behaviors the modal used to own — sections, raw mode, custom sections,
 *      and the save flow.
 */

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

const KB_TEXT =
  '📦 Products & Services\n- Basic package: 500 SAR/month\n- Premium: 1500 SAR/month\n\n📝 Other Notes\nWorking hours 9-5, Sunday to Thursday';

function initAuthStorage(page: import('@playwright/test').Page) {
  return page.addInitScript(() => {
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
}

/**
 * THE routing contract from #759: the Business Info CTA on /pages must land on
 * /business with the page preselected — never open an editor in place. This is
 * asserted through the real button, so a regression that resurrects a modal
 * (or breaks the funnel) fails here even though every unit test mocks the
 * router.
 */
test.describe('Business Info entry point on /pages', () => {
  // The /pages screen unwraps `{ data: [...] }` (unlike /business, which takes
  // the bare array — see below).
  const PAGES_LIST = [
    {
      id: 'page_filled',
      facebookPageId: 'fb_123',
      name: 'My Business Page',
      autoReplyEnabled: true,
      instagramAutoReplyEnabled: false,
      commentsCount: 10,
      knowledgeBase: KB_TEXT,
      kbActiveVersion: 1,
    },
    {
      id: 'page_empty',
      facebookPageId: 'fb_456',
      name: 'Empty Page',
      autoReplyEnabled: false,
      instagramAutoReplyEnabled: false,
      commentsCount: 0,
      knowledgeBase: '',
    },
  ];

  function setupPagesRoutes(page: import('@playwright/test').Page) {
    return page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/gaps')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      }
      if (url.includes('/pages')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: PAGES_LIST }) });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
  }

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
    await initAuthStorage(page);
  });

  test('the KB CTA routes to /business for that page — never a modal', async ({ page }) => {
    await setupPagesRoutes(page);
    await page.goto('/en/pages');

    await expect(page.getByText('My Business Page').first()).toBeVisible({ timeout: 15000 });

    // The empty page's CTA (role-based — loose text collides with the
    // business-info nudge banner's copy, which is a non-interactive <p>).
    await page.getByRole('button', { name: t('pages.addBusinessInfo') }).click();

    await expect(page).toHaveURL(/\/business\?page=page_empty/, { timeout: 15000 });
    // The legacy modal must not have opened in place along the way.
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
  });
});

/**
 * The editor itself, on its canonical host. The panel starts collapsed behind
 * the «Additional information» toggle (every fact now has a structured editor;
 * free text is the overflow surface).
 */
test.describe('Business Info editor on /business', () => {
  const PAGE_ID = 'page_biz';

  const BIZ_PAGE = {
    id: PAGE_ID,
    facebookPageId: 'fb_biz',
    name: 'My Business Page',
    autoReplyEnabled: true,
    instagramAutoReplyEnabled: false,
    commentsCount: 10,
    knowledgeBase: KB_TEXT,
    kbActiveVersion: 1,
    isConnected: true,
    businessProfile: { hours: null, address: null },
  };

  /** Body of the PUT /pages/:id the save issued — null until it happens. */
  let savedKbPayload: { knowledgeBase?: string } | null = null;

  function setupBusinessRoutes(page: import('@playwright/test').Page) {
    savedKbPayload = null;
    return page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (method === 'PUT' && url.includes(`/pages/${PAGE_ID}`)) {
        savedKbPayload = route.request().postDataJSON();
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      if (url.includes('/kb-gaps')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      }
      if (url.includes('/fact-collections')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      }
      if (url.includes('/catalog')) {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ data: [], vertical: { effective: 'general', source: 'default' } }),
        });
      }
      if (url.includes('/workspaces')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'ws_1', name: 'Test', role: 'owner' }] }) });
      }
      if (url.includes('/pages')) {
        // GET /pages answers a BARE ARRAY here — `pagesApi.getAll().then(r =>
        // r.data)` hands the body straight to the query. Wrapping it in
        // `{ data: … }` renders the «connect a page» empty state and every
        // assertion dies.
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([BIZ_PAGE]) });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
  }

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
    await initAuthStorage(page);
    // The picker restores from here; the ?page= deep link races it.
    await page.addInitScript((pageId) => {
      localStorage.setItem('catalogPageId', pageId);
    }, PAGE_ID);
  });

  /** Open /business and expand the collapsed free-text editor. */
  async function openInfoEditor(page: import('@playwright/test').Page) {
    await page.goto(`/en/business?page=${PAGE_ID}`);
    const toggle = page.getByRole('button', { name: t('business.info.title') });
    await expect(toggle).toBeVisible({ timeout: 15000 });
    await toggle.click();
  }

  test('expands into the editor showing the page sections and a save button', async ({ page }) => {
    await setupBusinessRoutes(page);
    await openInfoEditor(page);

    // `exact` matters: getByText is a case-insensitive SUBSTRING match, and the
    // panel description contains the products label ("About your business")
    // while carrying `landscape:hidden` — a loose locator resolves to that
    // hidden paragraph at Playwright's landscape viewport. The labels are each
    // a <p> whose whole text is the label, so exact matching pins them.
    await expect(page.getByText(t('kb.section.productsLabel'), { exact: true }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(t('kb.section.notesLabel'), { exact: true }).first()).toBeVisible();

    const saveButton = page.getByRole('button', { name: t('common.save') });
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeEnabled();
  });

  test('toggles raw text mode and back', async ({ page }) => {
    await setupBusinessRoutes(page);
    await openInfoEditor(page);

    const rawToggle = page.getByText(t('kb.showRawText'));
    await expect(rawToggle).toBeVisible({ timeout: 5000 });
    await rawToggle.click();

    // Raw editor: a single labelled textarea carrying the serialized KB.
    await expect(page.getByText(t('kb.hideRawText'))).toBeVisible();
    const rawEditor = page.getByRole('textbox', { name: t('kb.title') });
    await expect(rawEditor).toBeVisible();
    await expect(rawEditor).toHaveValue(/Basic package/);

    // Toggle back
    await page.getByText(t('kb.hideRawText')).click();
    await expect(page.getByText(t('kb.showRawText'))).toBeVisible();
  });

  test('offers adding a custom section', async ({ page }) => {
    await setupBusinessRoutes(page);
    await openInfoEditor(page);

    await expect(page.getByText(t('kb.addCustomSection'))).toBeVisible({ timeout: 5000 });
  });

  test('saves through PUT /pages/:id and shows the saved state', async ({ page }) => {
    await setupBusinessRoutes(page);
    await openInfoEditor(page);

    const saveButton = page.getByRole('button', { name: t('common.save') });
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await saveButton.click();

    // Saved state replaces the label on the same button.
    await expect(page.getByRole('button', { name: t('pages.savedStatus') })).toBeVisible({ timeout: 5000 });
    // And the payload that reached the API is the serialized editor content.
    expect(savedKbPayload?.knowledgeBase).toContain('Basic package');
  });
});
