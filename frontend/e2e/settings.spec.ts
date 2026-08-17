import { test, expect } from '@playwright/test';
import { DEFAULT_HANDOFF_PAUSE_MINUTES } from '@jawab24/shared';
import { t, tAr } from './i18n';

/**
 * Settings Page E2E Tests
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
  greetingMessageEnabled: true,
  awayMessageMulti: { ar: '', en: '', sourceLang: 'default' },
  dualReplyNudgeMulti: { ar: '', en: '', sourceLang: 'default' },
  replyDelay: 0,
  commentEscalationMinutes: 60,
  messageEscalationMinutes: 30,
  handoffPauseDurationMinutes: DEFAULT_HANDOFF_PAUSE_MINUTES,
};

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));

    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: { id: 'u1', email: 'test@test.com', name: 'Test' }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true },
          version: 0,
        })
      );
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { sidebarOpen: true, language: 'en', _hasHydrated: false, isOnboardingVisible: false }, version: 0 })
      );
      localStorage.setItem('jawab24_onboarding_complete', 'true');
    });

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/settings') && method === 'PUT') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      }
      if (url.includes('/settings')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
      }
      if (url.includes('/workspaces/current/members')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'mem-1', userId: 'u1', role: 'owner', joinedAt: '2026-01-01', user: { id: 'u1', name: 'Test', email: 'test@test.com', picture: null } }]) });
      }
      if (url.includes('/workspaces/current/invites')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
  });

  test('should render settings page with form fields', async ({ page }) => {
    await page.goto('/en/settings');

    await expect(page).toHaveTitle(/Settings.*Jawab24/i);
    await expect(page.locator('h1').filter({ hasText: t('settings.title') }).first()).toBeVisible({ timeout: 15000 });

    // Should show language selector (visible by default)
    await expect(page.locator('text=English').first()).toBeVisible({ timeout: 10000 });
  });

  test('should show save button', async ({ page }) => {
    await page.goto('/en/settings');

    await expect(
      page.locator('button').filter({ hasText: t('common.save') }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('should show the Comments row on the Auto-Reply board', async ({ page }) => {
    await page.goto('/en/settings');

    await expect(
      page.getByText(t('settings.autoReplyBoard.comments'), { exact: true }).first()
    ).toBeVisible({ timeout: 15000 });

    // Toggle should be visible with role="switch"
    const toggles = page.locator('[role="switch"]');
    await expect(toggles.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show the Messages row and always-on Post Reply row', async ({ page }) => {
    await page.goto('/en/settings');

    await expect(
      page.getByText(t('settings.autoReplyBoard.messages'), { exact: true }).first()
    ).toBeVisible({ timeout: 15000 });

    // Post Reply row: independence badge + Manage link, no toggle (D-027/D-029).
    // Demo settings have businessHoursOnly=false, so the default badge shows.
    await expect(
      page.getByText(t('settings.autoReplyBoard.worksWithoutSmart')).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show Advanced Settings when clicked', async ({ page }) => {
    await page.goto('/en/settings');

    // Find and click "Show Advanced Settings" button
    const advancedBtn = page.locator('button').filter({ hasText: t('settings.showAdvanced') }).first();
    await expect(advancedBtn).toBeVisible({ timeout: 15000 });
    await advancedBtn.click();

    // Business Hours heading should now be visible
    await expect(
      page.locator('h4').filter({ hasText: t('settings.businessHoursLabel') }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show business hours time inputs when toggled on', async ({ page }) => {
    // Remove beforeEach handler, then register fresh mock with businessHoursOnly: true
    await page.unroute('**/api/**');
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/settings')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_SETTINGS, businessHoursOnly: true }),
        });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
      }
      if (url.includes('/workspaces/current/members')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'mem-1', userId: 'u1', role: 'owner', joinedAt: '2026-01-01', user: { id: 'u1', name: 'Test', email: 'test@test.com', picture: null } }]) });
      }
      if (url.includes('/workspaces/current/invites')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/settings');

    // Open advanced settings
    const advancedBtn = page.locator('button').filter({ hasText: t('settings.showAdvanced') }).first();
    await expect(advancedBtn).toBeVisible({ timeout: 15000 });
    await advancedBtn.click();

    // Business Hours heading should be visible
    await expect(
      page.locator('h4').filter({ hasText: t('settings.businessHoursLabel') }).first()
    ).toBeVisible({ timeout: 10000 });

    // Time selects should show the start/end time labels
    await expect(page.locator('text=From').first()).toBeVisible({ timeout: 10000 });
  });

  test('should enable save button when settings change', async ({ page }) => {
    await page.goto('/en/settings');

    // Save button should initially be disabled (no changes)
    const saveBtn = page.locator('button').filter({ hasText: t('common.save') }).first();
    await expect(saveBtn).toBeVisible({ timeout: 15000 });
    await expect(saveBtn).toBeDisabled();

    // Click a toggle to change a setting
    const firstToggle = page.locator('[role="switch"]').first();
    await firstToggle.click();

    // Save button should now be enabled
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  });

  test('should show saved state after successful save', async ({ page }) => {
    await page.goto('/en/settings');

    // Change a setting
    const firstToggle = page.locator('[role="switch"]').first();
    await expect(firstToggle).toBeVisible({ timeout: 15000 });
    await firstToggle.click();

    // Click save
    const saveBtn = page.locator('button').filter({ hasText: t('common.save') }).first();
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();

    // Should show "Saved" state
    await expect(
      page.locator('button').filter({ hasText: t('settings.settingsSaved') }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should render in Arabic (RTL) when navigating to /ar/settings', async ({ page }) => {
    // Override UI storage to Arabic
    await page.addInitScript(() => {
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { sidebarOpen: true, language: 'ar', _hasHydrated: false, isOnboardingVisible: false }, version: 0 })
      );
    });

    await page.goto('/ar/settings');

    // Page title should contain Arabic or Settings
    await expect(page).toHaveTitle(/Jawab24/i, { timeout: 15000 });

    // Arabic heading should be visible (accept English fallback during hydration)
    const titlePattern = new RegExp(`${tAr('settings.title')}|${t('settings.title')}`, 'i');
    await expect(
      page.locator('h1').filter({ hasText: titlePattern }).first()
    ).toBeVisible({ timeout: 15000 });

    // Arabic content should be present
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(50);
  });

  test('should allow typing multiple characters in greeting message', async ({ page }) => {
    await page.goto('/en/settings');

    // Open advanced settings
    const advancedBtn = page.locator('button').filter({ hasText: t('settings.showAdvanced') }).first();
    await expect(advancedBtn).toBeVisible({ timeout: 15000 });
    await advancedBtn.click();

    // Find the greeting message textarea by its aria-label. Robust to DOM
    // restructuring in the card (we used to traverse parent divs).
    const greetingHeading = page.locator('h4').filter({ hasText: t('settings.greetingMessage.title') }).first();
    await expect(greetingHeading).toBeVisible({ timeout: 10000 });
    const textarea = page.getByLabel(t('settings.greetingMessage.title'), { exact: true });
    await expect(textarea).toBeVisible();

    // Type a full message — should retain all characters (not reset after each keystroke)
    await textarea.fill('Welcome to our store!');
    await expect(textarea).toHaveValue('Welcome to our store!');

    // Save button should be enabled after typing
    const saveBtn = page.locator('button').filter({ hasText: t('common.save') }).first();
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  });

  test('should retain greeting message when auto-translated sourceLang exists', async ({ page }) => {
    // Mock settings with auto-translated greeting (sourceLang differs from dashboard lang)
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (url.includes('/settings') && method === 'PUT') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      }
      if (url.includes('/settings')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...MOCK_SETTINGS,
            greetingMessageMulti: { ar: 'مرحبا بكم', en: 'Welcome', sourceLang: 'ar' },
            greetingMessageEnabled: true,
          }),
        });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
      }
      if (url.includes('/workspaces/current/members')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'mem-1', userId: 'u1', role: 'owner', joinedAt: '2026-01-01', user: { id: 'u1', name: 'Test', email: 'test@test.com', picture: null } }]) });
      }
      if (url.includes('/workspaces/current/invites')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/settings');

    // Open advanced settings
    const advancedBtn = page.locator('button').filter({ hasText: t('settings.showAdvanced') }).first();
    await expect(advancedBtn).toBeVisible({ timeout: 15000 });
    await advancedBtn.click();

    const greetingHeading = page.locator('h4').filter({ hasText: t('settings.greetingMessage.title') }).first();
    await expect(greetingHeading).toBeVisible({ timeout: 10000 });
    const textarea = page.getByLabel(t('settings.greetingMessage.title'), { exact: true });
    await expect(textarea).toBeVisible();

    // Auto-translated field should start empty (translated text shown as placeholder)
    await expect(textarea).toHaveValue('');

    // Type a new message — should NOT reset after first character
    await textarea.fill('Hello! How can we help?');
    await expect(textarea).toHaveValue('Hello! How can we help?');
  });

  test('saves an unrelated change even when an unchanged loaded field is invalid (sends only the diff)', async ({ page }) => {
    // Regression for JAWAB24-FRONTEND-2J: a stored field can be out-of-range for
    // the current schema (legacy / pre-cap data). Save must send only the fields
    // the user actually changed, so an UNCHANGED invalid field (here replyDelay
    // above the 0-300 cap) can't block an unrelated edit — and is never sent, so
    // it can't be clobbered either. We seed the bad value via the GET, toggle an
    // unrelated switch, and assert the PUT fires WITHOUT replyDelay.
    let putCount = 0;
    let putBody: Record<string, unknown> | null = null;
    await page.unroute('**/api/**');
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (url.includes('/settings') && method === 'PUT') {
        putCount += 1;
        putBody = route.request().postDataJSON();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      }
      if (url.includes('/settings')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          // Unchanged out-of-range value: replyDelay above the 0-300 cap. It must
          // not block the save and must be excluded from the (diff) payload.
          body: JSON.stringify({ ...MOCK_SETTINGS, replyDelay: 9999 }),
        });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
      }
      if (url.includes('/workspaces/current/members')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'mem-1', userId: 'u1', role: 'owner', joinedAt: '2026-01-01', user: { id: 'u1', name: 'Test', email: 'test@test.com', picture: null } }]) });
      }
      if (url.includes('/workspaces/current/invites')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/settings');

    // Mark settings as changed by toggling something so Save enables.
    const firstToggle = page.locator('[role="switch"]').first();
    await expect(firstToggle).toBeVisible({ timeout: 15000 });
    await firstToggle.click();

    // Click Save — the unrelated toggle is valid, so the save goes through.
    const saveBtn = page.locator('button').filter({ hasText: t('common.save') }).first();
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();

    // Wait for the PUT to fire.
    await page.waitForTimeout(500);

    // Exactly one PUT, carrying only the changed field — the unchanged
    // out-of-range replyDelay is neither validated nor sent.
    expect(putCount).toBe(1);
    expect(putBody).not.toBeNull();
    expect(putBody).not.toHaveProperty('replyDelay');
  });

  test('should not crash when APIs fail', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      await route.fulfill({ status: 500, body: 'Error' });
    });

    await page.goto('/en/settings');
    await expect(page).toHaveTitle(/Settings.*Jawab24/i, { timeout: 15000 });
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });
});

/**
 * Reply mode (D-085) — pilot-gated section inside the persona card.
 * E2E-1: the auth store is seeded with an activeWorkspaceId that IS in the
 * frontend flag's built-in allowlist (the InMedia pilot workspace), because
 * the section is invisible for any other workspace — a spec that forgets the
 * seed passes by asserting on nothing.
 */
test.describe('Settings — reply mode (pilot workspace)', () => {
  const ALLOWED_WS = 'd06ed500-74ea-42ee-bff6-37bee2cf412a'; // frontend flag default (InMedia)
  const TWO_PAGES = [
    { id: 'p1', name: 'Resort Page', isConnected: true, brandVoiceNotesMulti: null, replyMode: null },
    { id: 'p2', name: 'Fashion Page', isConnected: true, brandVoiceNotesMulti: null, replyMode: null },
  ];

  // addInitScript serializes the function — no closures; the workspace id
  // must travel as the argument.
  const seed = ({ wsId }: { wsId: string }) => {
    localStorage.setItem(
      'auth-storage',
      JSON.stringify({
        state: {
          user: { id: 'u1', email: 'test@test.com', name: 'Test' },
          token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true,
          activeWorkspaceId: wsId,
        },
        version: 0,
      })
    );
    localStorage.setItem(
      'ui-storage',
      JSON.stringify({ state: { sidebarOpen: true, language: 'en', _hasHydrated: false, isOnboardingVisible: false }, version: 0 })
    );
    localStorage.setItem('jawab24_onboarding_complete', 'true');
  };

  const routeMocks = async (
    page: import('@playwright/test').Page,
    onPatch?: (body: unknown) => void,
    opts: { patchStatus?: number; patchCode?: string; onPut?: (body: unknown) => void; putStatus?: number; putCode?: string } = {},
  ) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (url.includes('/reply-mode') && method === 'PATCH') {
        onPatch?.(route.request().postDataJSON());
        if (opts.patchStatus && opts.patchStatus >= 400) {
          return route.fulfill({
            status: opts.patchStatus, contentType: 'application/json',
            body: JSON.stringify({ error: 'nope', code: opts.patchCode ?? 'REPLY_MODE_NOT_ENABLED' }),
          });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...TWO_PAGES[0], replyMode: 'info' }) });
      }
      if (url.includes('/settings') && method === 'PUT') {
        opts.onPut?.(route.request().postDataJSON());
        if (opts.putStatus && opts.putStatus >= 400) {
          return route.fulfill({
            status: opts.putStatus, contentType: 'application/json',
            body: JSON.stringify({ error: 'nope', code: opts.putCode ?? 'REPLY_MODE_NOT_ENABLED' }),
          });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...MOCK_SETTINGS, replyMode: 'info' }) });
      }
      if (url.includes('/pages') && method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TWO_PAGES) });
      }
      if (url.includes('/settings')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test' }) });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
  };

  test('allowlisted workspace sees the question; pinning a page PATCHes reply-mode', async ({ page }) => {
    await page.addInitScript(seed, { wsId: ALLOWED_WS });
    let patched: unknown = null;
    await routeMocks(page, (body) => { patched = body; });

    await page.goto('/en/settings');
    await expect(page.getByText(t('settings.replyMode.question')).first()).toBeVisible({ timeout: 15000 });

    // Workspace scope shows the two mode options.
    await expect(page.getByRole('radio', { name: new RegExp(t('settings.replyMode.sales')) })).toBeVisible();

    // Switch the persona scope to a page. `Select` is a custom listbox
    // (button + option buttons), NOT a native <select> — the unit-test mock is
    // the native one, so a `combobox` selector passes there and hangs here.
    await page.getByRole('button', { name: t('settings.replyStyle.scopeLabel') }).click();
    await page.getByRole('button', { name: TWO_PAGES[0].name, exact: false }).click();

    // Then pin «Information source» — the page-scope radio PATCHes immediately.
    await page.getByRole('radio', { name: new RegExp(t('settings.replyMode.infoDesk')) }).click();
    await expect.poll(() => patched, { timeout: 15000 }).toEqual({ replyMode: 'info' });
  });

  /** The Save bar is `fixed` and always mounted; it slides in on hasChanges. */
  const saveBar = (page: import('@playwright/test').Page) => page.locator('div.fixed.z-30').first();
  const openPageScope = async (page: import('@playwright/test').Page, name = TWO_PAGES[0].name) => {
    await page.getByRole('button', { name: t('settings.replyStyle.scopeLabel') }).click();
    await page.getByRole('button', { name, exact: false }).click();
  };

  test('WORKSPACE scope: changing the mode reveals the Save bar and sends replyMode', async ({ page }) => {
    // The owner-reported defect was "no Save button appears" — so this asserts
    // the bar the MERCHANT sees, not just that a handler ran.
    await page.addInitScript(seed, { wsId: ALLOWED_WS });
    let put: unknown = null;
    await routeMocks(page, undefined, { onPut: (b) => { put = b; } });

    await page.goto('/en/settings');
    await expect(page.getByText(t('settings.replyMode.question')).first()).toBeVisible({ timeout: 15000 });

    await expect(saveBar(page)).toHaveCSS('opacity', '0');
    await page.getByRole('radio', { name: new RegExp(t('settings.replyMode.infoDesk')) }).click();

    await expect(page.getByRole('radio', { name: new RegExp(t('settings.replyMode.infoDesk')) })).toHaveAttribute('aria-checked', 'true');
    await expect(saveBar(page)).toHaveCSS('opacity', '1');
    const saveBtn = saveBar(page).getByRole('button').first();
    await expect(saveBtn).toBeEnabled();

    // And the value actually reaches the API — a visible button that saves
    // nothing is the same defect wearing a different mask.
    await saveBtn.click();
    await expect.poll(() => put, { timeout: 15000 }).toMatchObject({ replyMode: 'info' });
  });

  test('WORKSPACE scope: a 403 names the reason instead of a generic error', async ({ page }) => {
    await page.addInitScript(seed, { wsId: ALLOWED_WS });
    await routeMocks(page, undefined, { putStatus: 403, putCode: 'REPLY_MODE_NOT_ENABLED' });

    await page.goto('/en/settings');
    await expect(page.getByText(t('settings.replyMode.question')).first()).toBeVisible({ timeout: 15000 });
    await page.getByRole('radio', { name: new RegExp(t('settings.replyMode.infoDesk')) }).click();
    await saveBar(page).getByRole('button').first().click();

    await expect(page.getByText(t('settings.replyMode.notEnabled'))).toBeVisible({ timeout: 15000 });
  });

  test('PAGE scope: the instant save CONFIRMS itself and shows no Save bar', async ({ page }) => {
    // Regression pin for the owner-reported defect: the page scope saves on
    // click with no Save button, so it MUST say it saved — silence read as
    // "nothing happened / where is Save?".
    await page.addInitScript(seed, { wsId: ALLOWED_WS });
    await routeMocks(page);

    await page.goto('/en/settings');
    await expect(page.getByText(t('settings.replyMode.question')).first()).toBeVisible({ timeout: 15000 });
    await openPageScope(page);

    await expect(page.getByText(t('settings.replyMode.pageSaved'))).toHaveCount(0);
    await page.getByRole('radio', { name: new RegExp(t('settings.replyMode.infoDesk')) }).click();

    await expect(page.getByText(t('settings.replyMode.pageSaved'))).toBeVisible({ timeout: 15000 });
    // The page scope deliberately has NO Save bar — pinned so a later change
    // can't quietly introduce one half-wired.
    await expect(saveBar(page)).toHaveCSS('opacity', '0');
  });

  test('PAGE scope: a failed PATCH rolls the choice back and explains why', async ({ page }) => {
    await page.addInitScript(seed, { wsId: ALLOWED_WS });
    await routeMocks(page, undefined, { patchStatus: 403, patchCode: 'REPLY_MODE_NOT_ENABLED' });

    await page.goto('/en/settings');
    await expect(page.getByText(t('settings.replyMode.question')).first()).toBeVisible({ timeout: 15000 });
    await openPageScope(page);
    await page.getByRole('radio', { name: new RegExp(t('settings.replyMode.infoDesk')) }).click();

    await expect(page.getByText(t('settings.replyMode.notEnabled'))).toBeVisible({ timeout: 15000 });
    // Rolled back: the inherit option is selected again, so the UI never
    // claims a pin the server refused.
    await expect(page.getByRole('radio', { name: /Default \(/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(t('settings.replyMode.pageSaved'))).toHaveCount(0);
  });

  test('CORE REGRESSION: an ordinary settings change still reveals the Save bar and saves', async ({ page }) => {
    // Settings is the product's core. This pins that the reply-mode work did
    // not disturb the shared save path for a field that predates it.
    await page.addInitScript(seed, { wsId: ALLOWED_WS });
    let put: unknown = null;
    await routeMocks(page, undefined, { onPut: (b) => { put = b; } });

    await page.goto('/en/settings');
    await expect(page.locator('h1').filter({ hasText: t('settings.title') }).first()).toBeVisible({ timeout: 15000 });

    await expect(saveBar(page)).toHaveCSS('opacity', '0');
    await page.getByRole('radio', { name: t('settings.replyStyle.casual'), exact: true }).click();
    await expect(saveBar(page)).toHaveCSS('opacity', '1');

    await saveBar(page).getByRole('button').first().click();
    await expect.poll(() => put, { timeout: 15000 }).toMatchObject({ replyStyle: 'casual' });
  });

  test('a workspace outside the allowlist never sees the section', async ({ page }) => {
    await page.addInitScript(seed, { wsId: 'some-other-ws' });
    await routeMocks(page);

    await page.goto('/en/settings');
    await expect(page.locator('h1').filter({ hasText: t('settings.title') }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(t('settings.replyMode.question'))).toHaveCount(0);
  });
});
