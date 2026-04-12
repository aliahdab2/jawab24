import { test, expect } from '@playwright/test';
import { t, tAr } from './i18n';

/**
 * Team Section E2E Tests
 * Tests the team management section within the Settings page.
 */

const MOCK_SETTINGS = {
  dashboardLanguage: 'en',
  defaultReplyLanguage: 'auto',
  autoDetectLanguage: true,
  aiEnabled: true,
  aiModel: 'gpt-4.1-mini',
  notificationsEnabled: true,
  emailNotifications: false,
  webhookRetries: 3,
  commentReplyMode: 'dual',
  commentsAutoReply: true,
  messagesAutoReply: true,
  businessHoursOnly: false,
  businessHoursStart: '09:00',
  businessHoursEnd: '17:00',
  timezone: 'Asia/Damascus',
  awayMessage: '',
  greetingMessage: '',
  greetingMessageMulti: { ar: '', en: '', sourceLang: 'default' },
  awayMessageMulti: { ar: '', en: '', sourceLang: 'default' },
  dualReplyNudgeMulti: { ar: '', en: '', sourceLang: 'default' },
  replyDelay: 0,
  commentEscalationMinutes: 60,
  messageEscalationMinutes: 30,
  handoffPauseDurationMinutes: 30,
};

const MOCK_OWNER = {
  id: 'mem-1',
  userId: 'u1',
  role: 'owner',
  joinedAt: '2026-01-01',
  userName: 'Test Owner',
  userEmail: 'test@test.com',
  userPicture: null,
};

const MOCK_MEMBER = {
  id: 'mem-2',
  userId: 'u2',
  role: 'member',
  joinedAt: '2026-02-01',
  userName: 'Sara',
  userEmail: 'sara@test.com',
  userPicture: null,
};

const MOCK_INVITE = {
  id: 'inv-1',
  email: 'ali@test.com',
  role: 'member',
  status: 'pending',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
};

function setupAuth(page: import('@playwright/test').Page) {
  return page.addInitScript(() => {
    localStorage.setItem(
      'auth-storage',
      JSON.stringify({
        state: { user: { id: 'u1', email: 'test@test.com', name: 'Test Owner' }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true },
        version: 0,
      })
    );
    localStorage.setItem(
      'ui-storage',
      JSON.stringify({ state: { sidebarOpen: true, language: 'en', _hasHydrated: false, isOnboardingVisible: false }, version: 0 })
    );
    localStorage.setItem('jawab24_onboarding_complete', 'true');
  });
}

function setupRoutes(
  page: import('@playwright/test').Page,
  options?: { members?: typeof MOCK_OWNER[]; invites?: typeof MOCK_INVITE[] }
) {
  const members = options?.members ?? [MOCK_OWNER];
  const invites = options?.invites ?? [];

  return page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/workspaces/current/members')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(members) });
    }
    if (url.includes('/workspaces/current/invites') && method === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ invite: { ...MOCK_INVITE, email: 'new@test.com' }, token: 'mock-invite-token-123' }),
      });
    }
    if (url.includes('/workspaces/current/invites')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invites) });
    }
    if (url.includes('/settings')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
    }
    if (url.includes('/auth/profile')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test Owner' }) });
    }
    if (url.includes('/subscription/usage')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test.describe('Team Section', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
  });

  test('shows team section on settings page', async ({ page }) => {
    await setupAuth(page);
    await setupRoutes(page);
    await page.goto('/en/settings');

    await expect(page.getByText(t('team.sectionTitle')).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(t('team.sectionDesc'))).toBeVisible();
  });

  test('shows owner with badge and (You) label', async ({ page }) => {
    await setupAuth(page);
    await setupRoutes(page);
    await page.goto('/en/settings');

    const ownerText = page.getByText('Test Owner').first();
    await ownerText.waitFor({ state: 'attached', timeout: 15000 });
    await ownerText.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await expect(ownerText).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(t('team.roleOwner'), { exact: true })).toBeVisible();
    await expect(page.getByText(`(${t('team.you')})`)).toBeVisible();
  });

  test('shows invite form for owner', async ({ page }) => {
    await setupAuth(page);
    await setupRoutes(page);
    await page.goto('/en/settings');

    await expect(page.getByPlaceholder(t('team.invitePlaceholder'))).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: t('team.sendInvite') })).toBeVisible();
  });

  test('shows members and pending invites', async ({ page }) => {
    await setupAuth(page);
    await setupRoutes(page, {
      members: [MOCK_OWNER, MOCK_MEMBER],
      invites: [MOCK_INVITE],
    });
    await page.goto('/en/settings');

    const ownerText = page.getByText('Test Owner').first();
    await ownerText.waitFor({ state: 'attached', timeout: 15000 });
    await ownerText.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await expect(ownerText).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Sara', { exact: true })).toBeVisible();
    await expect(page.getByText('ali@test.com')).toBeVisible();
    await expect(page.getByText(t('team.pending'))).toBeVisible();
  });

  test('sends invite and shows copyable link', async ({ page }) => {
    await setupAuth(page);
    await setupRoutes(page);
    await page.goto('/en/settings');

    const emailInput = page.getByPlaceholder(t('team.invitePlaceholder'));
    await emailInput.waitFor({ timeout: 15000 });
    await emailInput.fill('new@test.com');

    await page.getByRole('button', { name: t('team.sendInvite') }).click();

    // Invite link should appear with copy button
    await expect(page.getByText(t('team.linkExpires'))).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: t('team.copyLink') })).toBeVisible();
    // Link input should contain the token
    await expect(page.locator('input[readonly]')).toHaveValue(/mock-invite-token-123/);
  });

  test('validates invalid contact', async ({ page }) => {
    await setupAuth(page);
    await setupRoutes(page);
    await page.goto('/en/settings');

    const emailInput = page.getByPlaceholder(t('team.invitePlaceholder'));
    await emailInput.waitFor({ timeout: 15000 });
    await emailInput.fill('not-an-email');

    await page.getByRole('button', { name: t('team.sendInvite') }).click();

    // Should show error toast
    await expect(page.getByText(t('team.invalidContact'))).toBeVisible({ timeout: 5000 });
  });

  test('shows remove button for non-owner members', async ({ page }) => {
    await setupAuth(page);
    await setupRoutes(page, { members: [MOCK_OWNER, MOCK_MEMBER] });
    await page.goto('/en/settings');

    await expect(page.getByText('Sara', { exact: true })).toBeVisible({ timeout: 15000 });
    // One remove button (for Sara, not for owner)
    const removeButtons = page.getByText(t('team.removeMember'));
    await expect(removeButtons).toHaveCount(1);
  });

  test('shows role badges for all members', async ({ page }) => {
    await setupAuth(page);
    await setupRoutes(page, { members: [MOCK_OWNER, MOCK_MEMBER] });
    await page.goto('/en/settings');

    const ownerBadge = page.getByText(t('team.roleOwner'), { exact: true });
    await ownerBadge.waitFor({ state: 'attached', timeout: 15000 });
    await ownerBadge.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await expect(ownerBadge).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(t('team.roleMember')).first()).toBeVisible();
  });

  test('works in Arabic (RTL)', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: { id: 'u1', email: 'test@test.com', name: 'Test Owner' }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true },
          version: 0,
        })
      );
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { sidebarOpen: true, language: 'ar', _hasHydrated: false, isOnboardingVisible: false }, version: 0 })
      );
      localStorage.setItem('jawab24_onboarding_complete', 'true');
    });
    await setupRoutes(page);
    // Override settings mock to return Arabic dashboard language
    await page.route('**/api/settings', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...MOCK_SETTINGS, dashboardLanguage: 'ar' }) });
    });
    await page.goto('/ar/settings');

    await expect(page.getByText(tAr('team.sectionTitle')).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(tAr('team.roleOwner'))).toBeVisible();
    await expect(page.getByPlaceholder(tAr('team.invitePlaceholder'))).toBeVisible();
  });
});

test.describe('Invite Accept Page', () => {
  test('shows invalid state for missing token', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: { id: 'u1', email: 'test@test.com', name: 'Test' }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true },
          version: 0,
        })
      );
    });
    await page.route('**/api/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/en/invites/accept');

    await expect(page.getByText(t('team.acceptInvalid'))).toBeVisible({ timeout: 15000 });
  });

  test('shows success after accepting valid invite', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: { id: 'u1', email: 'test@test.com', name: 'Test' }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true },
          version: 0,
        })
      );
    });
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/invites/accept')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/en/invites/accept?token=valid-token');

    await expect(page.getByText(t('team.acceptSuccess'))).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(t('team.goToDashboard'))).toBeVisible();
  });

  test('shows expired message for expired invite', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: { id: 'u1', email: 'test@test.com', name: 'Test' }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true },
          version: 0,
        })
      );
    });
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/invites/accept')) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'invite_expired' }),
        });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/en/invites/accept?token=expired-token');

    await expect(page.getByText(t('team.acceptExpired'))).toBeVisible({ timeout: 15000 });
  });

  test('shows already member message when user is already in workspace', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: { id: 'u1', email: 'test@test.com', name: 'Test' }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true },
          version: 0,
        })
      );
    });
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/invites/accept')) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'already_member' }),
        });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/en/invites/accept?token=valid-token');

    await expect(page.getByText(t('team.acceptAlreadyMember'))).toBeVisible({ timeout: 15000 });
    // Should still offer a way forward — go to dashboard
    await expect(page.getByText(t('team.goToDashboard'))).toBeVisible();
  });

  test('shows wrong account message when invite was for a different user', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: { id: 'u1', email: 'other@test.com', name: 'Test' }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true },
          version: 0,
        })
      );
    });
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/invites/accept')) {
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'invite_identity_mismatch' }),
        });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/en/invites/accept?token=valid-token');

    await expect(page.getByText(t('team.acceptWrongAccount'))).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(t('team.switchAccount'))).toBeVisible();
  });

  test('shows workspace full message when member limit reached', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: { id: 'u1', email: 'test@test.com', name: 'Test' }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true },
          version: 0,
        })
      );
    });
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/invites/accept')) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'member_limit_reached' }),
        });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/en/invites/accept?token=valid-token');

    await expect(page.getByText(t('team.acceptFull'))).toBeVisible({ timeout: 15000 });
  });

  test('shows generic error message for unexpected server error', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: { id: 'u1', email: 'test@test.com', name: 'Test' }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true },
          version: 0,
        })
      );
    });
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/invites/accept')) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Internal server error' }),
        });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/en/invites/accept?token=valid-token');

    // Should show the generic error, NOT the "invalid link" message
    await expect(page.getByText(t('team.acceptError'))).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(t('team.acceptInvalid'))).not.toBeVisible();
  });

  test('redirects unauthenticated user to login with return URL', async ({ page }) => {
    // No auth set in localStorage — user is not logged in
    await page.route('**/api/**', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/en/invites/accept?token=valid-token');

    // Should land on login page with redirect param pointing back to the invite
    await page.waitForURL(/\/login/, { timeout: 10000 });
    expect(page.url()).toContain('redirect=');
    expect(page.url()).toContain('valid-token');
  });
});

test.describe('Team — Invite Form Guards', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
  });

  test('blocks sending invite when contact already has a pending invite', async ({ page }) => {
    await setupAuth(page);
    // Pending invite already exists for ali@test.com
    await setupRoutes(page, { invites: [MOCK_INVITE] });
    await page.goto('/en/settings');

    const emailInput = page.getByPlaceholder(t('team.invitePlaceholder'));
    await emailInput.waitFor({ timeout: 15000 });
    // Type the same email that already has a pending invite
    await emailInput.fill('ali@test.com');
    await page.getByRole('button', { name: t('team.sendInvite') }).click();

    await expect(page.getByText(t('team.invitePending'))).toBeVisible({ timeout: 5000 });
  });

  test('blocks sending invite to someone already a member', async ({ page }) => {
    await setupAuth(page);
    await setupRoutes(page, { members: [MOCK_OWNER, MOCK_MEMBER] });
    await page.goto('/en/settings');

    const emailInput = page.getByPlaceholder(t('team.invitePlaceholder'));
    await emailInput.waitFor({ timeout: 15000 });
    // sara@test.com is already a member
    await emailInput.fill('sara@test.com');
    await page.getByRole('button', { name: t('team.sendInvite') }).click();

    await expect(page.getByText(t('team.alreadyMember'))).toBeVisible({ timeout: 5000 });
  });

  test('resend invite creates a new link', async ({ page }) => {
    await setupAuth(page);
    const newToken = 'resent-invite-token-456';
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (url.includes('/workspaces/current/members')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_OWNER]) });
      }
      if (url.includes('/workspaces/current/invites') && method === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ invite: { ...MOCK_INVITE }, token: newToken }),
        });
      }
      if (url.includes('/workspaces/current/invites')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_INVITE]) });
      }
      if (url.includes('/settings')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test Owner' }) });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/en/settings');

    // Pending invite row should be visible
    await expect(page.getByText('ali@test.com')).toBeVisible({ timeout: 15000 });

    // Click Resend
    await page.getByRole('button', { name: t('team.resendInvite') }).click();

    // New link with the new token should appear
    await expect(page.locator('input[readonly]')).toHaveValue(new RegExp(newToken), { timeout: 10000 });
  });
});
