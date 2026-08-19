import { test, expect } from '@playwright/test';
import { t } from './i18n';

/**
 * Business Info (knowledge base) E2E — the full surface after GA (#759, #761).
 *
 * Since #759 the structured /business page is the canonical Business Info
 * surface for ALL merchants: every entry point on /pages (add/edit card CTAs,
 * the "Add info" chip, the nudge banner, and the ?openKb / ?openKbActive deep
 * links) funnels through `openKbEditorFor` and ROUTES to /business?page=<id>.
 * The legacy free-text KnowledgeBaseModal survives in production only behind
 * the in-conversation flows (InlineKbEditorModal); it is no longer reachable
 * from /pages.
 *
 * This spec pins all three halves of that contract:
 *   1. every /pages entry point and deep link routes to /business for the
 *      right page — never opens a modal;
 *   2. the KnowledgeBasePanel hosted on /business still delivers the editor
 *      behaviors the modal used to own — sections, raw mode, custom sections,
 *      and a save that PUTs the serialized content to /pages/:id;
 *   3. the inline editor still opens in place from a KB-gap-flagged comment in
 *      the inbox, and its save round-trips through the same PUT.
 */

const KB_TEXT =
  '📦 Products & Services\n- Basic package: 500 SAR/month\n- Premium: 1500 SAR/month\n\n📝 Other Notes\nWorking hours 9-5, Sunday to Thursday';

const PAGE_FILLED = {
  id: 'page_filled',
  facebookPageId: 'fb_123',
  name: 'My Business Page',
  autoReplyEnabled: true,
  instagramAutoReplyEnabled: false,
  commentsCount: 10,
  // Long enough (>= KB_FILLED_MIN_CHARS) that this page counts as "info
  // provided": its card shows the EDIT CTA and no nudge banner / add chip.
  knowledgeBase: KB_TEXT,
  kbActiveVersion: 1,
  isConnected: true,
  businessProfile: { hours: null, address: null },
};

const PAGE_EMPTY = {
  id: 'page_empty',
  facebookPageId: 'fb_456',
  name: 'Empty Page',
  autoReplyEnabled: false,
  instagramAutoReplyEnabled: false,
  commentsCount: 0,
  // Empty KB → this card carries the ADD CTA, the "Add info" chip, and the
  // nudge banner, and is what ?openKb=true (needs-first) resolves to.
  knowledgeBase: '',
};

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

const GAP_COMMENT = {
  id: 'c_gap',
  postId: 'p1',
  message: 'How much is shipping to Tripoli?',
  fromName: 'Sara Ahmed',
  replied: false,
  replyText: null,
  replyMethod: null,
  pageId: 'page_filled',
  createdAt: new Date().toISOString(),
  postMessage: 'New arrivals this week!',
  needsAttention: true,
  flagReason: 'info_not_in_kb',
};

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

interface RouteOptions {
  /**
   * Shape of the GET /pages list. The /pages screen unwraps `{ data: [...] }`;
   * /business takes the BARE array — `pagesApi.getAll().then(r => r.data)`
   * hands the body straight to the query, and a wrapped body there renders the
   * «connect a page» empty state. One endpoint, two consumers: pick per
   * describe. Routing tests that merely LAND on /business keep 'wrapped' (the
   * navigation is the assertion; the destination's own data needs are not
   * under test there).
   */
  pagesShape: 'wrapped' | 'bare';
  /** Comments served to the inbox describe; omitted elsewhere. */
  comments?: Array<typeof GAP_COMMENT>;
  /** Captures the body of every PUT /pages/:id — the real save request shape
   *  (`useSaveKnowledgeBase` PUTs `{ knowledgeBase }` to /pages/:id; there is
   *  NO /knowledge-base URL — a matcher for one is dead code). */
  onKbSave?: (body: { knowledgeBase?: string }) => void;
}

/** The one API harness for every describe in this file (Rule 10.8). Matcher
 *  order matters: specific paths and methods before the bare '/pages' list. */
function setupApiRoutes(page: import('@playwright/test').Page, opts: RouteOptions) {
  return page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (method === 'PUT' && /\/pages\/[^/]+$/.test(new URL(url).pathname)) {
      opts.onKbSave?.(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (url.includes('/kb-gaps') || url.includes('/gaps')) {
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
    if (url.includes('/comments/stats')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ total: 1, unreplied: 1, needsAttention: 1, repliedToday: 0, autoReplied: 0, resolved: 0, byMethod: { ai: 0, template: 0, manual: 0 } }),
      });
    }
    if (url.includes('/comments')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: opts.comments ?? [], pagination: { nextCursor: null } }),
      });
    }
    // InlineKbEditorModal loads the page (with its KB text) on open —
    // GET /pages/:id answers the BARE page object, not { data: … }.
    if (method === 'GET' && url.endsWith('/pages/page_filled')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAGE_FILLED) });
    }
    if (url.includes('/pages')) {
      const list = [PAGE_FILLED, PAGE_EMPTY];
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(opts.pagesShape === 'bare' ? list : { data: list }),
      });
    }
    if (url.includes('/subscription/usage')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
    }
    if (url.includes('/auth/profile')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

/**
 * THE routing contract from #759: every Business Info entry point on /pages
 * must land on /business with the right page preselected — never open an
 * editor in place.
 *
 * There are THREE entry points, not four: the amber «أضف معلومات» chip was
 * removed in #838. It was a third call to action for one job on one card — the
 * nudge banner below it already explains why and offers "Add now", and the CTA
 * is the persistent entry — and it read `page.knowledgeBase`, which #806 had
 * dropped from the list payload, so it fired on every non-ecommerce page
 * including merchants whose info was complete. Asserted through the real buttons, so a regression that
 * resurrects a modal (or breaks the funnel) fails here even though every unit
 * test mocks the router. (The no-modal check after navigation is belt and
 * braces — a modal that never opens is primarily proven by the URL landing.)
 */
test.describe('Business Info entry points on /pages', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.warn(`PAGE ERROR: ${err}`));
    await initAuthStorage(page);
    await setupApiRoutes(page, { pagesShape: 'wrapped' });
    await page.goto('/en/pages');
    await expect(page.getByText('My Business Page').first()).toBeVisible({ timeout: 15000 });
  });

  test('the add CTA on a page without info routes to /business — never a modal', async ({ page }) => {
    // Role-based — loose text collides with the business-info nudge banner's
    // copy, which is a non-interactive <p>.
    await page.getByRole('button', { name: t('pages.addBusinessInfo') }).click();

    await page.waitForURL(/\/business\?page=page_empty/);
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
  });

  test('the edit CTA on a page WITH info routes to /business for that page', async ({ page }) => {
    await page.getByRole('button', { name: t('pages.businessInfoActive') }).click();

    await page.waitForURL(/\/business\?page=page_filled/);
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
  });

  test('the nudge banner CTA routes to /business', async ({ page }) => {
    await page.getByRole('button', { name: t('pages.businessInfoNudgeCta') }).click();

    await page.waitForURL(/\/business\?page=page_empty/);
  });
});

test.describe('Business Info deep links on /pages', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.warn(`PAGE ERROR: ${err}`));
    await initAuthStorage(page);
    await setupApiRoutes(page, { pagesShape: 'wrapped' });
  });

  test('?openKb=true lands on /business for the page that NEEDS info', async ({ page }) => {
    await page.goto('/en/pages?openKb=true');

    // Needs-first: page_filled has info, page_empty does not.
    await page.waitForURL(/\/business\?page=page_empty/);
  });

  test('?openKbActive=true lands on /business for the most-active page', async ({ page }) => {
    await page.goto('/en/pages?openKbActive=true');

    // Most-active-first: pages[0], even though page_empty needs info.
    await page.waitForURL(/\/business\?page=page_filled/);
  });
});

/**
 * The editor itself, on its canonical host. The panel starts collapsed behind
 * the «Additional information» toggle (every fact now has a structured editor;
 * free text is the overflow surface).
 */
test.describe('Business Info editor on /business', () => {
  /** Body of the PUT /pages/:id the save issued — null until it happens. */
  let savedKbPayload: { knowledgeBase?: string } | null = null;

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.warn(`PAGE ERROR: ${err}`));
    await initAuthStorage(page);
    savedKbPayload = null;
    await setupApiRoutes(page, { pagesShape: 'bare', onKbSave: (body) => { savedKbPayload = body; } });
    // The picker restores from here; the ?page= deep link races it (#761).
    await page.addInitScript((pageId) => {
      localStorage.setItem('catalogPageId', pageId);
    }, PAGE_FILLED.id);
  });

  /** Open /business and expand the collapsed free-text editor. */
  async function openInfoEditor(page: import('@playwright/test').Page) {
    await page.goto(`/en/business?page=${PAGE_FILLED.id}`);
    const toggle = page.getByRole('button', { name: t('business.info.title') });
    await expect(toggle).toBeVisible({ timeout: 15000 });
    await toggle.click();
  }

  test('expands into the editor showing the page sections and a save button', async ({ page }) => {
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
    await openInfoEditor(page);

    await expect(page.getByText(t('kb.addCustomSection'))).toBeVisible({ timeout: 5000 });
  });

  test('saves through PUT /pages/:id and shows the saved state', async ({ page }) => {
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

/**
 * The one surface the legacy modal still serves: a KB-gap-flagged comment in
 * the inbox opens the editor in place (InlineKbEditorModal) so the merchant
 * can fill the gap without leaving the conversation.
 */
test.describe('Inline Business Info editor — the inbox flow', () => {
  /** Body of the PUT /pages/:id the inline save issued. */
  let savedKbPayload: { knowledgeBase?: string } | null = null;

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.warn(`PAGE ERROR: ${err}`));
    await initAuthStorage(page);
    savedKbPayload = null;
    await setupApiRoutes(page, {
      pagesShape: 'wrapped',
      comments: [GAP_COMMENT],
      onKbSave: (body) => { savedKbPayload = body; },
    });
  });

  test('a KB-gap flagged comment opens the editor in place, and saving PUTs the KB', async ({ page }) => {
    await page.goto('/en/comments?filter=all');
    await expect(page.getByText(GAP_COMMENT.message).first()).toBeVisible({ timeout: 15000 });

    // Open the comment detail modal, then the Business Info editor from its
    // needs-attention banner ('info_not_in_kb' is a KB-gap flag).
    await page.getByText(GAP_COMMENT.message).first().click();
    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: t('comments.addToBusinessInfo') }).click();

    // The legacy KnowledgeBaseModal renders in place, layered over the inbox
    // (generous timeout: the editor chunk is dynamically imported on open).
    await expect(page.getByText(t('kb.title')).last()).toBeVisible({ timeout: 10000 });

    // Round-trip a save through the shared useSaveKnowledgeBase hook and
    // assert the REAL request: PUT /pages/:id carrying the serialized KB.
    const saveButton = page.getByRole('button', { name: t('common.save') });
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(page.getByRole('button', { name: t('pages.savedStatus') })).toBeVisible({ timeout: 5000 });
    expect(savedKbPayload?.knowledgeBase).toContain('Basic package');
  });
});
