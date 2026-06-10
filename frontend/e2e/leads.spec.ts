import { test, expect } from '@playwright/test';
import { t } from './i18n';

/**
 * Leads Page E2E Tests
 *
 * Coverage: CSV export button is gated by plan —
 *   - Business / Pro: normal Export CSV button
 *   - Starter (active): locked button with "Business+" badge → navigates to /pricing
 *   - Starter (trialing): export unlocked (trial = full paid experience)
 *   - Any plan, no leads: export button hidden entirely
 */

const BASE_USER = {
  id: 'u1',
  email: 'test@test.com',
  name: 'Test User',
  picture: null,
  isAdmin: false,
  facebookId: null,
  hasEcommerceStore: false,
};

// `autoReplyEnabled: true` is required: the leads picker (via `usePageFilter`)
// matches /comments and /messages by listing only auto-reply-enabled pages,
// so a mock page without this flag would be filtered out and `selectedPageId`
// would never be set, hiding the export controls these tests verify.
const MOCK_PAGE = { id: 'p1', name: 'Test Page', pageId: 'fb-p1', autoReplyEnabled: true };

const MOCK_LEAD = {
  id: 'l1',
  pageId: 'p1',
  name: 'Ali Test',
  phone: '+966501234567',
  status: 'new',
  subStage: null,
  source: 'message',
  intent: 'Interested in pricing',
  createdAt: new Date().toISOString(),
  customFields: {},
};

function makeUsageMock(planSlug: string, status = 'active') {
  return JSON.stringify({
    data: {
      subscription: {
        plan: { name: planSlug.charAt(0).toUpperCase() + planSlug.slice(1), slug: planSlug },
        status,
        trialDaysRemaining: status === 'trialing' ? 7 : undefined,
      },
      aiReplies: { used: 5, limit: 100, percentUsed: 5 },
      pages: { used: 1, limit: 3 },
    },
  });
}

function setupAuth(page: import('@playwright/test').Page) {
  return page.addInitScript(({ user }) => {
    // Stub EventSource so SSE retries don't cause re-renders that detach buttons.
    window.EventSource = class {
      constructor() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
    } as unknown as typeof EventSource;

    localStorage.setItem('auth-storage', JSON.stringify({
      state: {
        user, token: 'mock-token', fbToken: 'mock-fb',
        isAuthenticated: true,
        workspaces: [{ id: 'ws1', name: 'My Workspace' }],
        activeWorkspaceId: 'ws1',
      },
      version: 0,
    }));
    localStorage.setItem('ui-storage', JSON.stringify({
      state: { sidebarOpen: true, language: 'en', _hasHydrated: false, isOnboardingVisible: false },
      version: 0,
    }));
    localStorage.setItem('jawab24_onboarding_complete', 'true');
  }, { user: BASE_USER });
}

function mockAPIs(
  page: import('@playwright/test').Page,
  options: { planSlug?: string; subscriptionStatus?: string; hasLeads?: boolean } = {},
) {
  const { planSlug = 'business', subscriptionStatus = 'active', hasLeads = true } = options;

  return page.route('**/api/**', async (route) => {
    const url = route.request().url();

    if (url.includes('/auth/profile') || url.includes('/auth/me')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASE_USER) });
    }
    if (url.includes('/subscription/usage')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: makeUsageMock(planSlug, subscriptionStatus) });
    }
    if (url.match(/\/pages($|\?)/)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_PAGE]) });
    }
    if (url.includes('/leads')) {
      const leads = hasLeads ? [MOCK_LEAD] : [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: leads, total: leads.length }) });
    }
    if (url.includes('/workspaces/current/members')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'mem-1', userId: 'u1', role: 'owner', joinedAt: '2026-01-01', user: BASE_USER }]) });
    }
    if (url.includes('/workspaces/current/invites')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (url.includes('/auth/logout')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function gotoLeads(page: import('@playwright/test').Page) {
  await page.goto('/en/leads');
  await expect(page.getByRole('heading', { name: t('leads.title'), exact: true }).first()).toBeVisible({ timeout: 15000 });
}

test.describe('Leads — Export gating', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
  });

  /* ------------------------------------------------------------------ */
  /*  Business / Pro — export available                                   */
  /* ------------------------------------------------------------------ */

  test('Business plan: Export CSV button is visible', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { planSlug: 'business' });
    await gotoLeads(page);

    await expect(page.getByRole('button', { name: new RegExp(t('leads.exportCsv')) })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Business+')).not.toBeVisible();
  });

  test('Pro plan: Export CSV button is visible', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { planSlug: 'pro' });
    await gotoLeads(page);

    await expect(page.getByRole('button', { name: new RegExp(t('leads.exportCsv')) })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Business+')).not.toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  Starter (active) — export locked                                    */
  /* ------------------------------------------------------------------ */

  test('Starter plan: locked export button shows Business+ badge', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { planSlug: 'starter' });
    await gotoLeads(page);

    await expect(page.getByRole('button', { name: new RegExp(t('leads.exportCsv')) })).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Business+')).toBeVisible({ timeout: 5000 });
  });

  test('Starter plan: locked export button links to /pricing', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { planSlug: 'starter' });
    await gotoLeads(page);

    // Locked variant renders an UpgradeCTA (Lock icon + "Business+" badge) that
    // links to /pricing — the accessible name is "Business+", not "Export CSV".
    const lockedLink = page.getByRole('link', { name: /Business\+/i });
    await expect(lockedLink).toBeVisible({ timeout: 5000 });
    await expect(lockedLink).toHaveAttribute('href', /\/pricing/);
  });

  /* ------------------------------------------------------------------ */
  /*  Trial — export unlocked regardless of base plan                     */
  /* ------------------------------------------------------------------ */

  test('Starter on trial: Export CSV button is visible', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { planSlug: 'starter', subscriptionStatus: 'trialing' });
    await gotoLeads(page);

    await expect(page.getByRole('button', { name: new RegExp(t('leads.exportCsv')) })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Business+')).not.toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  No leads — export hidden for all plans                              */
  /* ------------------------------------------------------------------ */

  test('No leads: export button hidden regardless of plan', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { planSlug: 'business', hasLeads: false });
    await gotoLeads(page);

    await expect(page.getByRole('button', { name: new RegExp(t('leads.exportCsv')) })).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Business+')).not.toBeVisible();
  });
});
