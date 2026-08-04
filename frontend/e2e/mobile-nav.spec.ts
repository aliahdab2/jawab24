import { test, expect } from '@playwright/test';
import { t } from './i18n';

/**
 * Mobile Navigation E2E Tests
 *
 * Coverage: bottom nav renders, "More" overlay opens, all nav items present
 * (including Leads), active state on /leads, newLeads badge color on "More".
 *
 * Uses a mobile viewport so the bottom nav is visible and the desktop sidebar
 * is hidden. Settings page is used as the host — fewer API dependencies than
 * dashboard.
 *
 * All bottom-nav assertions are scoped to aria-label="Mobile navigation" to
 * avoid strict-mode violations from same-named buttons elsewhere on the page.
 */

const MOBILE_VIEWPORT = { width: 390, height: 844 };

const BASE_USER = {
  id: 'u1',
  email: 'test@test.com',
  name: 'Test User',
  picture: null,
  isAdmin: false,
  facebookId: null,
  hasEcommerceStore: false,
};

const MOCK_SETTINGS = {
  dashboardLanguage: 'en', defaultReplyLanguage: 'auto', autoDetectLanguage: true,
  aiEnabled: true, aiModel: 'gpt-4.1-mini', notificationsEnabled: true,
  emailNotifications: false, webhookRetries: 3, commentReplyMode: 'dual',
  commentsAutoReply: true, messagesAutoReply: true, businessHoursOnly: false,
  businessHoursStart: '09:00', businessHoursEnd: '17:00', timezone: 'Asia/Damascus',
  awayMessage: '', greetingMessage: '',
  greetingMessageMulti: { ar: '', en: '', sourceLang: 'default' },
  awayMessageMulti: { ar: '', en: '', sourceLang: 'default' },
  dualReplyNudgeMulti: { ar: '', en: '', sourceLang: 'default' },
  replyDelay: 0, commentEscalationMinutes: 60, messageEscalationMinutes: 30,
  handoffPauseDurationMinutes: 30,
};

function setupAuth(
  page: import('@playwright/test').Page,
  options: {
    user?: Partial<typeof BASE_USER>;
    // Current user's role in the active workspace. Gates the Team tile
    // (owner/admin see it; member does not). Defaults to owner.
    workspaceRole?: 'owner' | 'admin' | 'member';
    unreadComments?: number;
    unreadMessages?: number;
  } = {},
) {
  const {
    user = {},
    workspaceRole = 'owner',
    unreadComments = 0,
    unreadMessages = 0,
  } = options;

  const mergedUser = { ...BASE_USER, ...user };

  return page.addInitScript(
    ({ mergedUser, workspaceRole, unreadComments, unreadMessages }) => {
      // Stub EventSource so useSSE never connects.
      // Without this, SSE status transitions (connecting→error→reconnecting)
      // re-render DashboardLayout on every retry, detaching nav buttons
      // between Playwright's locator resolution and click.
      window.EventSource = class {
        constructor() {}
        addEventListener() {}
        removeEventListener() {}
        close() {}
      } as unknown as typeof EventSource;

      localStorage.setItem('auth-storage', JSON.stringify({
        state: {
          user: mergedUser, token: 'mock-token', fbToken: 'mock-fb',
          isAuthenticated: true,
          workspaces: [{ id: 'ws1', name: 'My Workspace', role: workspaceRole }],
          activeWorkspaceId: 'ws1',
        },
        version: 0,
      }));
      localStorage.setItem('ui-storage', JSON.stringify({
        state: {
          sidebarOpen: true, language: 'en', _hasHydrated: false,
          isOnboardingVisible: false, unreadComments, unreadMessages,
        },
        version: 0,
      }));
      localStorage.setItem('jawab24_onboarding_complete', 'true');
    },
    { mergedUser, workspaceRole, unreadComments, unreadMessages },
  );
}

/**
 * @param newLeads workspace-wide `new` lead count served by GET /leads/count.
 *   The "More" badge is SERVER-derived (useNewLeadsSummary) since 2026-08-04 —
 *   seeding the UI store no longer drives it, because the session counter it
 *   used to read was deleted. Drive it from the API or the badge stays empty.
 * @param leadsCountBody raw override for that response, to exercise a body that
 *   is NOT the summary shape.
 */
function mockAPIs(
  page: import('@playwright/test').Page,
  { newLeads = 0, leadsCountBody }: { newLeads?: number; leadsCountBody?: unknown } = {},
) {
  return page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/auth/profile')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASE_USER) });
    }
    if (url.includes('/settings') && method === 'PUT') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
    }
    if (url.includes('/settings')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
    }
    if (url.includes('/subscription/usage')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
    }
    // MUST precede the generic /leads branch — '/leads/count' contains '/leads',
    // and the list shape ({data,meta}) has no `count`, so falling through here
    // leaves the badge with nothing to render.
    if (url.includes('/leads/count')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(leadsCountBody ?? { count: newLeads, latestName: null, latestAt: null }),
      });
    }
    if (url.includes('/leads')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { total: 0, page: 1, limit: 20 } }) });
    }
    if (url.includes('/workspaces/current/members')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'mem-1', userId: 'u1', role: 'owner', joinedAt: '2026-01-01', user: { id: 'u1', name: 'Test User', email: 'test@test.com', picture: null } }]) });
    }
    if (url.includes('/workspaces/current/invites')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (url.match(/\/pages($|\?)/)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (url.includes('/auth/logout')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

/** Returns a locator scoped to the mobile bottom nav landmark. */
function mobileNav(page: import('@playwright/test').Page) {
  return page.getByRole('navigation', { name: 'Mobile navigation' });
}

async function gotoWithMobileNav(page: import('@playwright/test').Page) {
  await page.goto('/en/settings');
  await expect(mobileNav(page)).toBeVisible({ timeout: 15000 });
}

test.use({ viewport: MOBILE_VIEWPORT });

test.describe('Mobile Navigation', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
  });

  /* ------------------------------------------------------------------ */
  /*  Bottom nav                                                          */
  /* ------------------------------------------------------------------ */

  test('renders bottom nav with 4 tabs', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page);
    await gotoWithMobileNav(page);

    const nav = mobileNav(page);
    await expect(nav.getByRole('button', { name: t('nav.dashboard'), exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: t('nav.comments'), exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: t('nav.messages'), exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: t('nav.more'), exact: true })).toBeVisible();
  });

  test('desktop sidebar is hidden on mobile viewport', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page);
    await gotoWithMobileNav(page);

    await expect(page.locator('aside')).not.toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  "More" overlay — item completeness                                 */
  /* ------------------------------------------------------------------ */

  test('"More" button opens the overlay', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page);
    await gotoWithMobileNav(page);

    await mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
  });

  test('overlay contains Leads', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page);
    await gotoWithMobileNav(page);

    await mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: t('nav.leads'), exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('overlay contains the non-bottom-nav destinations', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page);
    await gotoWithMobileNav(page);

    await mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true }).click();
    const dialog = page.getByRole('dialog');

    // The overlay surfaces everything NOT already reachable from the bottom nav.
    await expect(dialog.getByRole('button', { name: t('nav.channels'), exact: true })).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByRole('button', { name: t('nav.leads'), exact: true })).toBeVisible();
    // Team is workspace owner/admin-only; the default mock user is an owner.
    await expect(dialog.getByRole('button', { name: t('nav.team'), exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: t('nav.settings'), exact: true })).toBeVisible();
  });

  // Dashboard / Comments / Messages live in the persistent bottom nav, so the
  // "More" overlay must NOT duplicate them — that redundancy is what forced the
  // overlay to overflow and scroll. Guards against re-introducing the dupes.
  test('overlay excludes destinations already in the bottom nav', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page);
    await gotoWithMobileNav(page);

    await mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await expect(dialog.getByRole('button', { name: t('nav.dashboard'), exact: true })).not.toBeVisible();
    await expect(dialog.getByRole('button', { name: t('nav.comments'), exact: true })).not.toBeVisible();
    await expect(dialog.getByRole('button', { name: t('nav.messages'), exact: true })).not.toBeVisible();
  });

  // Team management is workspace owner/admin-only. A plain member should NOT
  // see the Team tile in the More overlay; an owner should.
  test('Team item is hidden from members in the More overlay', async ({ page }) => {
    await setupAuth(page, { workspaceRole: 'member' });
    await mockAPIs(page);
    await gotoWithMobileNav(page);

    await mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: t('nav.team'), exact: true })).not.toBeVisible();
  });

  // Stores is admin-only while we finish the public roll-out. A regular
  // merchant should NOT see the entry in the More overlay; an admin should.
  test('Stores item is hidden from non-admins in the More overlay', async ({ page }) => {
    await setupAuth(page, { user: { hasEcommerceStore: true, isAdmin: false } });
    await mockAPIs(page);
    await gotoWithMobileNav(page);

    await mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: t('nav.integrations'), exact: true })).not.toBeVisible();
  });

  test('Stores item is reachable for admins in the More overlay', async ({ page }) => {
    await setupAuth(page, { user: { hasEcommerceStore: true, isAdmin: true } });
    await mockAPIs(page);
    await gotoWithMobileNav(page);

    await mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: t('nav.integrations'), exact: true })).toBeVisible({ timeout: 5000 });
  });

  /* ------------------------------------------------------------------ */
  /*  Navigation via overlay                                              */
  /* ------------------------------------------------------------------ */

  test('tapping Leads in overlay navigates to /leads', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page);
    await gotoWithMobileNav(page);

    await mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: t('nav.leads'), exact: true }).click();

    await page.waitForURL(/\/leads/, { timeout: 10000 });
  });

  /* ------------------------------------------------------------------ */
  /*  "More" active state                                                 */
  /* ------------------------------------------------------------------ */

  test('"More" button is active when on /leads', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page);
    await page.goto('/en/leads');
    await expect(mobileNav(page)).toBeVisible({ timeout: 15000 });

    const moreBtn = mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true });
    await expect(moreBtn.locator('span').filter({ hasText: t('nav.more') })).toHaveClass(/text-brand-600/, { timeout: 5000 });
  });

  /* ------------------------------------------------------------------ */
  /*  Badges                                                              */
  /* ------------------------------------------------------------------ */

  test('unread comments badge appears on Comments tab', async ({ page }) => {
    await setupAuth(page, { unreadComments: 7 });
    await mockAPIs(page);
    await gotoWithMobileNav(page);

    const commentsBtn = mobileNav(page).getByRole('button', { name: t('nav.comments'), exact: true });
    await expect(commentsBtn.locator('span').filter({ hasText: '7' })).toBeVisible({ timeout: 5000 });
  });

  test('newLeads badge appears on "More" tab with brand color', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { newLeads: 3 });
    await gotoWithMobileNav(page);

    const moreBtn = mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true });
    const badge = moreBtn.locator('span').filter({ hasText: '3' });
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).toHaveClass(/bg-brand-500/);
  });

  test('newLeads badge is absent when count is zero', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { newLeads: 0 });
    await gotoWithMobileNav(page);

    const moreBtn = mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true });
    await expect(moreBtn.locator('span').filter({ hasText: /^\d+$/ })).not.toBeVisible();
  });

  // The badge is server-derived: a 200 that is NOT the summary shape (an older
  // backend, a proxy, a route mock that matched the list endpoint) must render
  // NOTHING — never an empty pill, and never a stale number.
  test('newLeads badge renders nothing when the count endpoint returns a wrong shape', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { leadsCountBody: { data: [], meta: { total: 0 } } });
    await gotoWithMobileNav(page);

    const moreBtn = mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true });
    await expect(moreBtn.locator('span.bg-brand-500')).toHaveCount(0);
  });

  /* ------------------------------------------------------------------ */
  /*  Overlay close                                                       */
  /* ------------------------------------------------------------------ */

  test('overlay closes when X button is tapped', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page);
    await gotoWithMobileNav(page);

    await mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: 'Close menu' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
  });

  test('overlay closes when backdrop is tapped', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page);
    await gotoWithMobileNav(page);

    await mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // Click the backdrop (outside the sheet content)
    await page.locator('[role="dialog"]').click({ position: { x: 10, y: 10 } });
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
  });
});
