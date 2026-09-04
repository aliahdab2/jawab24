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

  // Stores (/integrations) was admin-only during the public roll-out. The gate came
  // off 2026-09-04 (owner ruling, #1048) because the Salla App Store listing's first
  // gallery image IS this screen — a listing may not advertise a page the merchant
  // who installs it cannot open. Sidebar.tsx and the page-level guard in
  // pages/integrations.tsx both dropped it; these two cases replace the pair that
  // pinned the gate. They are the MOBILE half: the nav entry can only be reached
  // through the More overlay on a phone, so a desktop-only unit test on
  // getNavigationGroups cannot see a regression here.
  test('Stores item is reachable for a NON-admin merchant in the More overlay', async ({ page }) => {
    await setupAuth(page, { user: { hasEcommerceStore: true, isAdmin: false } });
    await mockAPIs(page);
    await gotoWithMobileNav(page);

    await mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true }).click();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: t('nav.integrations'), exact: true }),
      'Stores is hidden from merchants on mobile again — gallery-1 of the Salla listing ' +
        'shows this screen, so hiding it makes the listing advertise a page the ' +
        'installing merchant cannot reach',
    ).toBeVisible({ timeout: 5000 });
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

  // A badged tab's accessible NAME carries the count ("7 unread comments
  // Comments") — the pill itself is aria-hidden, so the sr-only label is the only
  // way the number reaches a screen reader. Badge assertions therefore match the
  // name loosely and read the number off the pill.
  test('unread comments badge appears on Comments tab', async ({ page }) => {
    await setupAuth(page, { unreadComments: 7 });
    await mockAPIs(page);
    await gotoWithMobileNav(page);

    const commentsBtn = mobileNav(page).getByRole('button', { name: t('nav.comments') });
    await expect(commentsBtn.locator('span[aria-hidden="true"]')).toHaveText('7', { timeout: 5000 });
    await expect(commentsBtn).toHaveAccessibleName(/7 unread comments/);
  });

  test('newLeads badge appears on "More" tab with brand color', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { newLeads: 3 });
    await gotoWithMobileNav(page);

    const moreBtn = mobileNav(page).getByRole('button', { name: t('nav.more') });
    const badge = moreBtn.locator('span[aria-hidden="true"]');
    await expect(badge).toHaveText('3', { timeout: 5000 });
    await expect(badge).toHaveClass(/bg-brand-500/);
    // The roll-up names its single contributor rather than a vague "3 items".
    await expect(moreBtn).toHaveAccessibleName(/3 new leads/);
  });

  test('newLeads badge is absent when count is zero', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { newLeads: 0 });
    await gotoWithMobileNav(page);

    const moreBtn = mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true });
    await expect(moreBtn.locator('span').filter({ hasText: /^\d+$/ })).not.toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  Badges inside the "More" overlay                                    */
  /* ------------------------------------------------------------------ */

  // The defect this pins: "More" wore the new-leads count, but every tile behind
  // it rendered icon + label only. A merchant who saw 29 and tapped it landed on
  // a grid of identical tiles with nothing pointing at Leads — the badge was a
  // dead end. A badge on a container is a promise that something inside needs
  // attention; the item that owns the count must repeat it.
  test('the Leads tile inside the overlay carries the same count as "More"', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { newLeads: 29 });
    await gotoWithMobileNav(page);

    const moreBtn = mobileNav(page).getByRole('button', { name: t('nav.more') });
    await expect(moreBtn.locator('span[aria-hidden="true"]')).toHaveText('29', { timeout: 5000 });
    await moreBtn.click();

    const leadsTile = page.getByRole('dialog').getByRole('button', { name: t('nav.leads') });
    const tileBadge = leadsTile.locator('span[aria-hidden="true"]');
    await expect(tileBadge).toHaveText('29', { timeout: 5000 });
    await expect(tileBadge).toHaveClass(/bg-brand-500/);
    await expect(leadsTile).toHaveAccessibleName(/29 new leads/);
  });

  test('overlay tiles carry no badge when nothing is waiting', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { newLeads: 0 });
    await gotoWithMobileNav(page);

    await mobileNav(page).getByRole('button', { name: t('nav.more'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await expect(dialog.locator('span.bg-brand-500')).toHaveCount(0);
    await expect(dialog.locator('span.bg-red-500')).toHaveCount(0);
  });

  // The sheet renders through two entirely separate branches — a grid in portrait,
  // a wrapped row in landscape. A badge added to one only is a silent half-fix, so
  // landscape gets its own assertion rather than trusting the portrait one.
  test.describe('landscape', () => {
    test.use({ viewport: { width: MOBILE_VIEWPORT.height, height: MOBILE_VIEWPORT.width } });

    test('the Leads tile carries the count in the landscape sheet too', async ({ page }) => {
      await setupAuth(page);
      await mockAPIs(page, { newLeads: 29 });
      await gotoWithMobileNav(page);

      await mobileNav(page).getByRole('button', { name: t('nav.more') }).click();

      const leadsTile = page.getByRole('dialog').getByRole('button', { name: t('nav.leads') });
      await expect(leadsTile.locator('span[aria-hidden="true"]')).toHaveText('29', { timeout: 5000 });
      await expect(leadsTile).toHaveAccessibleName(/29 new leads/);
    });
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
