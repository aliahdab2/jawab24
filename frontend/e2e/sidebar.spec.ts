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
    workspaces?: { id: string; name: string }[];
    unreadComments?: number;
    unreadMessages?: number;
    newLeads?: number;
  } = {},
) {
  const {
    user = {},
    sidebarOpen = true,
    workspaces = [{ id: 'ws1', name: 'My Workspace' }],
    unreadComments = 0,
    unreadMessages = 0,
    newLeads = 0,
  } = options;

  const mergedUser = { ...BASE_USER, ...user };
  const activeWorkspaceId = workspaces[0]?.id ?? null;

  return page.addInitScript(
    ({ mergedUser, sidebarOpen, workspaces, activeWorkspaceId, unreadComments, unreadMessages, newLeads }) => {
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
          isOnboardingVisible: false, unreadComments, unreadMessages, newLeads,
        },
        version: 0,
      }));
      localStorage.setItem('jawab24_onboarding_complete', 'true');
    },
    { mergedUser, sidebarOpen, workspaces, activeWorkspaceId, unreadComments, unreadMessages, newLeads },
  );
}

function mockAPIs(page: import('@playwright/test').Page, user = BASE_USER) {
  return page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

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
    await expect(page.getByRole('link', { name: t('nav.pages') }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: t('nav.comments') }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: t('nav.messages') }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: t('nav.settings') }).first()).toBeVisible();
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

  test('should show unread badge count on comments link', async ({ page }) => {
    await setupAuth(page, { unreadComments: 5 });
    await mockAPIs(page);
    await gotoWithSidebar(page);

    await expect(page.locator('aside').getByText('5')).toBeVisible({ timeout: 5000 });
  });

  test('should show unread badge count on messages link', async ({ page }) => {
    await setupAuth(page, { unreadMessages: 12 });
    await mockAPIs(page);
    await gotoWithSidebar(page);

    await expect(page.locator('aside').getByText('12')).toBeVisible({ timeout: 5000 });
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

    // Click the second workspace
    await page.getByText('Second Workspace').first().click();

    // Should navigate to dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });

    // Active workspace in the switcher should now show Second Workspace
    await expect(page.locator('aside').getByText('Second Workspace')).toBeVisible({ timeout: 5000 });
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
