import { test, expect } from '@playwright/test';
import { t, tAr } from './i18n';

/**
 * Leads Page E2E Tests
 *
 * Coverage: CSV export is available on EVERY plan (it used to be Business+ only,
 * with a locked "Business+" upsell chip shown to Starter accounts; that gate was
 * removed — the backend never enforced it, and the chip read as a broken state
 * and crowded the mobile header). The only thing that hides the button now is an
 * empty list.
 *   - Any plan (Business, Starter, …): normal Export CSV button, no "Business+" chip
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

// A lead whose AI-extracted fields carry a phone number — the exact case that
// exposed an RTL bug: an extracted-field value with no direction hint inherits the
// page's `dir="rtl"`, so bidi reverses the number's space-separated groups
// (`+963 951 619 639` → `639 619 951 963+`). The fix is `dir="auto"` on the value
// spans (FieldChips + the detail modal), letting a number render LTR while Arabic
// values (e.g. دورة حاسوب) stay RTL. Full `Lead` shape (matches `@/lib/api`), unlike
// the legacy MOCK_LEAD above which only needs to satisfy the export-button tests.
const FRIEND_PHONE = '+963 951 619 639';
const PHONE_FIELD_LEAD = {
  id: 'l-phone',
  pageId: 'p1',
  sourceType: 'message',
  sourceId: 's-phone',
  senderId: 'sender-phone',
  senderName: 'Rahma Test',
  phone: '+963941357142',
  extractedData: {
    summary: 'العميلة ترغب في تسجيل نفسها ورفيقتها في دورة حاسوب ICDL',
    fields: [
      { key: 'friend_phone', label_en: "Friend's phone", label_ar: 'رقم هاتف الرفيقة', value: FRIEND_PHONE },
      { key: 'course', label_en: 'Course', label_ar: 'الدورة المهتم بها', value: 'دورة حاسوب ICDL' },
    ],
  },
  status: 'new',
  subStage: null,
  customFields: {},
  extractionStatus: 'completed',
  needsFollowUp: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
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
  options: { planSlug?: string; subscriptionStatus?: string; hasLeads?: boolean; leadsData?: unknown[] } = {},
) {
  const { planSlug = 'business', subscriptionStatus = 'active', hasLeads = true, leadsData } = options;

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
      const leads = leadsData ?? (hasLeads ? [MOCK_LEAD] : []);
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

test.describe('Leads — CSV export', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.warn(`PAGE ERROR: ${err}`));
  });

  /* ------------------------------------------------------------------ */
  /*  Export available on every plan (no gating)                          */
  /* ------------------------------------------------------------------ */

  test('Business plan: Export CSV button is visible', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { planSlug: 'business' });
    await gotoLeads(page);

    await expect(page.getByRole('button', { name: new RegExp(t('leads.exportCsv')) })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Business+')).not.toBeVisible();
  });

  test('Starter plan: Export CSV button is visible (export is no longer gated)', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { planSlug: 'starter' });
    await gotoLeads(page);

    // Previously this showed a locked "Business+" upsell chip; export is now open
    // to every plan, so the real Export button appears and there is no chip.
    await expect(page.getByRole('button', { name: new RegExp(t('leads.exportCsv')) })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Business+')).not.toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  No leads — export hidden for all plans                              */
  /* ------------------------------------------------------------------ */

  test('No leads: export button hidden regardless of plan', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { planSlug: 'starter', hasLeads: false });
    await gotoLeads(page);

    await expect(page.getByRole('button', { name: new RegExp(t('leads.exportCsv')) })).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Business+')).not.toBeVisible();
  });
});

test.describe('Leads — RTL number rendering (dir="auto" guard)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.warn(`PAGE ERROR: ${err}`));
  });

  // Regression: an AI-extracted field value that is a phone number must NOT have its
  // digit groups reversed by the Arabic (RTL) layout. The value spans (list chip +
  // detail modal) carry dir="auto"; without it the number renders as "639 619 951 963+".
  // `?lead=<id>` deep-links straight into the open detail modal, so this one render
  // exercises both the list chips AND the modal row in RTL — no flaky click needed.
  test('extracted phone-field value renders LTR, not bidi-reversed, in Arabic UI', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { leadsData: [PHONE_FIELD_LEAD] });

    await page.goto(`/ar/leads?lead=${PHONE_FIELD_LEAD.id}`);

    // Confirm the RTL page and the detail modal both actually rendered, so the modal's
    // value span (a separate render site from the chips) is genuinely covered.
    await expect(page.getByRole('heading', { name: tAr('leads.title'), exact: true }).first())
      .toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });

    // Every element whose text is exactly the phone value is a value span (chips in
    // both layouts + the modal row). Each must declare dir="auto" — that is the fix.
    const values = page.getByText(FRIEND_PHONE, { exact: true });
    const count = await values.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(values.nth(i)).toHaveAttribute('dir', 'auto');
    }
  });
});
