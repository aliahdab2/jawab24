import { test, expect } from '@playwright/test';
import { t } from './i18n';

/**
 * Sidebar E2E Tests
 *
 * Coverage: render, collapse/expand, active nav item, unread badges,
 * logout, admin link visibility, workspace switcher.
 *
 * Uses /en/settings as the host page — it has fewer API dependencies
 * than /en/dashboard, so the sidebar renders reliably.
 *
 * Unread counts and workspaces are injected via localStorage on init —
 * Zustand merges stored state with initial state on rehydration, so
 * extra keys (unreadComments, workspaces) are picked up even if not
 * in the partialize whitelist.
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
    sidebarOpen?: boolean;
    // `role` gates the Team nav item (owner/admin see it; member does not).
    workspaces?: { id: string; name: string; role?: 'owner' | 'admin' | 'member' }[];
    unreadComments?: number;
    unreadMessages?: number;
  } = {},
) {
  const {
    user = {},
    sidebarOpen = true,
    workspaces = [{ id: 'ws1', name: 'My Workspace' }],
    unreadComments = 0,
    unreadMessages = 0,
  } = options;

  const mergedUser = { ...BASE_USER, ...user };
  const activeWorkspaceId = workspaces[0]?.id ?? null;

  return page.addInitScript(
    ({ mergedUser, sidebarOpen, workspaces, activeWorkspaceId, unreadComments, unreadMessages }) => {
      localStorage.setItem('auth-storage', JSON.stringify({
        state: {
          user: mergedUser, token: 'mock-token', fbToken: 'mock-fb',
          isAuthenticated: true, workspaces, activeWorkspaceId,
        },
        version: 0,
      }));
      localStorage.setItem('ui-storage', JSON.stringify({
        state: {
          sidebarOpen, language: 'en', _hasHydrated: false,
          isOnboardingVisible: false, unreadComments, unreadMessages,
        },
        version: 0,
      }));
      localStorage.setItem('jawab24_onboarding_complete', 'true');
    },
    { mergedUser, sidebarOpen, workspaces, activeWorkspaceId, unreadComments, unreadMessages },
  );
}

/**
 * @param newLeads workspace-wide `new` lead count served by GET /leads/count —
 *   the sidebar Leads badge reads it from the server (useNewLeadsSummary), not
 *   from the UI store. Without this branch the request falls through to the `{}`
 *   catch-all and the badge has no count to render.
 */
function mockAPIs(
  page: import('@playwright/test').Page,
  user = BASE_USER,
  { newLeads = 0 }: { newLeads?: number } = {},
) {
  return page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/leads/count')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: newLeads, latestName: null, latestAt: null }),
      });
    }
    if (url.includes('/auth/profile')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
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
    if (url.includes('/workspaces/current/members')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'mem-1', userId: 'u1', role: 'owner', joinedAt: '2026-01-01', user: { id: 'u1', name: 'Test User', email: 'test@test.com', picture: null } }]) });
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

// Navigate to settings and wait for the sidebar to be ready
async function gotoWithSidebar(page: import('@playwright/test').Page) {
  await page.goto('/en/settings');
  await expect(page.locator('aside')).toBeVisible({ timeout: 15000 });
}

test.describe('Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
  });

  /* ------------------------------------------------------------------ */
  /*  Render                                                              */
  /* ------------------------------------------------------------------ */

  test('should render all nav links when expanded', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page);
    await gotoWithSidebar(page);

    await expect(page.getByRole('link', { name: t('nav.dashboard') }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: t('nav.channels') }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: t('nav.comments') }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: t('nav.messages') }).first()).toBeVisible();
    // Team is workspace owner/admin-only; the default mock user is an owner.
    await expect(page.getByRole('link', { name: t('nav.team') }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: t('nav.settings') }).first()).toBeVisible();
  });

  test('hides the Team link for plain members', async ({ page }) => {
    await setupAuth(page, { workspaces: [{ id: 'ws1', name: 'My Workspace', role: 'member' }] });
    await mockAPIs(page);
    await gotoWithSidebar(page);

    // Settings is always present — wait for it so the sidebar has rendered
    // before asserting the Team link is absent.
    await expect(page.getByRole('link', { name: t('nav.settings') }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: t('nav.team') })).toHaveCount(0);
  });

  /* ------------------------------------------------------------------ */
  /*  Collapse / Expand                                                   */
  /* ------------------------------------------------------------------ */

  test('should be collapsed when sidebarOpen is false', async ({ page }) => {
    await setupAuth(page, { sidebarOpen: false });
    await mockAPIs(page);
    await gotoWithSidebar(page);

    // Collapsed sidebar has w-20, not w-64
    await expect(page.locator('aside')).toHaveClass(/w-20/);
    await expect(page.locator('aside')).not.toHaveClass(/w-64/);
  });

  test('should expand sidebar when toggle button is clicked', async ({ page }) => {
    await setupAuth(page, { sidebarOpen: false });
    await mockAPIs(page);
    await gotoWithSidebar(page);

    // Hover to reveal the toggle button then click
    await page.locator('aside').hover();
    const toggleBtn = page.locator('aside button').filter({ has: page.locator('svg') }).first();
    await toggleBtn.click();

    await expect(page.getByRole('link', { name: t('nav.dashboard') }).first()).toBeVisible({ timeout: 5000 });
  });

  /* ------------------------------------------------------------------ */
  /*  Active nav item                                                     */
  /* ------------------------------------------------------------------ */

  test('should highlight the active nav item based on current route', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page);
    await gotoWithSidebar(page);

    const settingsLink = page.getByRole('link', { name: t('nav.settings') }).first();
    await expect(settingsLink).toBeVisible({ timeout: 10000 });
    await expect(settingsLink).toHaveClass(/bg-brand-400\/10/);
  });

  /* ------------------------------------------------------------------ */
  /*  Unread badges                                                       */
  /* ------------------------------------------------------------------ */

  // The pill is aria-hidden and the count reaches a screen reader through an
  // sr-only sibling, so the digits alone appear twice inside the link ("5" and
  // "5 unread comments"). Match the pill exactly rather than by substring.
  test('should show unread badge count on comments link', async ({ page }) => {
    await setupAuth(page, { unreadComments: 5 });
    await mockAPIs(page);
    await gotoWithSidebar(page);

    await expect(page.locator('aside').getByText('5', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('aside').getByRole('link', { name: t('nav.comments') })).toHaveAccessibleName(/5 unread comments/);
  });

  test('should show unread badge count on messages link', async ({ page }) => {
    await setupAuth(page, { unreadMessages: 12 });
    await mockAPIs(page);
    await gotoWithSidebar(page);

    await expect(page.locator('aside').getByText('12', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('aside').getByRole('link', { name: t('nav.messages') })).toHaveAccessibleName(/12 unread messages/);
  });

  // The leads badge is the STANDING queue read from the server, not a session
  // counter — a merchant whose leads arrived while the app was closed used to
  // see zero over a real backlog (2026-08-04: 19 unworked leads, no signal).
  // Nothing is seeded into the UI store here on purpose: if the badge ever goes
  // back to reading local state, this test fails.
  test('should show the server-derived new-leads badge on the leads link', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, BASE_USER, { newLeads: 19 });
    await gotoWithSidebar(page);

    const badge = page.locator('aside').getByText('19', { exact: true });
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).toHaveClass(/bg-brand-500/);
  });

  test('should not render a leads badge when the server count is zero', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, BASE_USER, { newLeads: 0 });
    await gotoWithSidebar(page);

    await expect(page.locator('aside').locator('span.bg-brand-500')).toHaveCount(0);
  });

  // A badge that outlives the visit (leads clear by being WORKED, not by being
  // seen) has to be resolvable, or merchants learn to ignore it: the badged link
  // opens the leads it counted, not the unfiltered list.
  test('the badged leads link opens the new-leads view', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, BASE_USER, { newLeads: 19 });
    await gotoWithSidebar(page);

    await expect(page.locator('aside').getByRole('link', { name: t('nav.leads') }))
      .toHaveAttribute('href', /\/leads\?status=new$/);
  });

  test('an empty queue leaves the leads link on the plain list', async ({ page }) => {
    // Filtering to "new" with nothing waiting would answer a tap with an empty
    // list — the merchant asked for leads, not for proof there are none.
    await setupAuth(page);
    await mockAPIs(page, BASE_USER, { newLeads: 0 });
    await gotoWithSidebar(page);

    await expect(page.locator('aside').getByRole('link', { name: t('nav.leads') }))
      .toHaveAttribute('href', /\/leads$/);
  });

  /* ------------------------------------------------------------------ */
  /*  Logout                                                              */
  /* ------------------------------------------------------------------ */

  test('should navigate to login page after logout', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page);
    await gotoWithSidebar(page);

    const logoutBtn = page.getByRole('button', { name: t('nav.logout') }).first();
    await expect(logoutBtn).toBeVisible({ timeout: 10000 });
    await logoutBtn.click();

    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  /* ------------------------------------------------------------------ */
  /*  Admin link                                                          */
  /* ------------------------------------------------------------------ */

  test('should show admin link for admin users', async ({ page }) => {
    const adminUser = { ...BASE_USER, isAdmin: true };
    await setupAuth(page, { user: { isAdmin: true } });
    await mockAPIs(page, adminUser);
    await gotoWithSidebar(page);

    await expect(page.locator('aside').getByRole('link', { name: /admin/i }).first()).toBeVisible({ timeout: 10000 });
  });

  test('should not show admin link for regular users', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page);
    await gotoWithSidebar(page);

    // Wait for full render, then verify admin link is absent
    await expect(page.getByRole('link', { name: t('nav.settings') }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('aside').getByRole('link', { name: /admin/i })).not.toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  Workspace switcher                                                  */
  /* ------------------------------------------------------------------ */

  test('should not show workspace switcher for a single workspace', async ({ page }) => {
    await setupAuth(page, { workspaces: [{ id: 'ws1', name: 'My Workspace' }] });
    await mockAPIs(page);
    await gotoWithSidebar(page);

    await expect(page.getByRole('link', { name: t('nav.settings') }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('aside').getByText('My Workspace')).not.toBeVisible();
  });

  test('should show workspace switcher when user has multiple workspaces', async ({ page }) => {
    await setupAuth(page, {
      workspaces: [
        { id: 'ws1', name: 'First Workspace' },
        { id: 'ws2', name: 'Second Workspace' },
      ],
    });
    await mockAPIs(page);
    await gotoWithSidebar(page);

    await expect(page.locator('aside').getByText('First Workspace')).toBeVisible({ timeout: 10000 });
  });

  test('should open workspace dropdown and show all workspaces', async ({ page }) => {
    await setupAuth(page, {
      workspaces: [
        { id: 'ws1', name: 'First Workspace' },
        { id: 'ws2', name: 'Second Workspace' },
      ],
    });
    await mockAPIs(page);
    await gotoWithSidebar(page);

    await expect(page.locator('aside').getByText('First Workspace')).toBeVisible({ timeout: 10000 });

    const switcherBtn = page.locator('aside').getByRole('button').filter({ hasText: 'First Workspace' }).first();
    await switcherBtn.click();

    await expect(page.getByText('Second Workspace').first()).toBeVisible({ timeout: 5000 });
  });

  test('should switch active workspace and navigate to dashboard', async ({ page }) => {
    await setupAuth(page, {
      workspaces: [
        { id: 'ws1', name: 'First Workspace' },
        { id: 'ws2', name: 'Second Workspace' },
      ],
    });
    await mockAPIs(page);
    await gotoWithSidebar(page);

    // Open the switcher
    const switcherBtn = page.locator('aside').getByRole('button').filter({ hasText: 'First Workspace' }).first();
    await switcherBtn.waitFor({ timeout: 10000 });
    await switcherBtn.click();

    // Click the second workspace — this triggers setActiveWorkspace + router.push('/dashboard')
    await page.getByText('Second Workspace').first().click();

    // Navigation to dashboard must happen — that is the observable side-effect of the switch
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });

    // Verify the active workspace ID was persisted: localStorage activeWorkspaceId should be ws2.
    // We check this via the store's persisted value rather than re-reading the sidebar label,
    // because workspaces[] is excluded from Zustand's partialize config and may not survive
    // a store rehydration triggered by the navigation.
    const activeId = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('auth-storage');
        const parsed = JSON.parse(raw || '{}');
        return parsed?.state?.activeWorkspaceId ?? null;
      } catch { return null; }
    });
    expect(activeId).toBe('ws2');
  });

  test('should show checkmark on the currently active workspace in dropdown', async ({ page }) => {
    await setupAuth(page, {
      workspaces: [
        { id: 'ws1', name: 'First Workspace' },
        { id: 'ws2', name: 'Second Workspace' },
      ],
    });
    await mockAPIs(page);
    await gotoWithSidebar(page);

    const switcherBtn = page.locator('aside').getByRole('button').filter({ hasText: 'First Workspace' }).first();
    await switcherBtn.waitFor({ timeout: 10000 });
    await switcherBtn.click();

    // The active workspace row (ws1) should have a checkmark; ws2 should not
    const ws1Row = page.locator('button').filter({ hasText: 'First Workspace' }).last();
    const ws2Row = page.locator('button').filter({ hasText: 'Second Workspace' });
    await expect(ws1Row.locator('svg')).toBeVisible({ timeout: 5000 }); // Check icon
    await expect(ws2Row.locator('svg')).not.toBeVisible();
  });
});
