import { test, expect } from '@playwright/test';
import { t, tAr } from './i18n';

/**
 * /business — the Business Surface, driven end to end.
 *
 * The page had NO E2E coverage at all while being the milestone's main
 * surface; every other check was a component test that renders one piece in
 * isolation.
 *
 * The fixture is deliberately a DISTRIBUTOR, not a training institute: an
 * outlet directory with no prices on its rows, no dates anywhere, and no
 * entity that spans two lists. That shape is what caught the copy asserting
 * «كل ما يخص العنصر الواحد في بطاقة واحدة — أسعاره ومواعيده معاً» at a
 * business that has none of those things (owner ruling 2026-08-10: this page
 * must fit ANY business). A courses-shaped fixture cannot catch that class —
 * every claim happens to be true there.
 */

const PAGE_ID = 'page_dist';

const MOCK_PAGES = [
  {
    id: PAGE_ID,
    facebookPageId: 'fb_dist',
    name: 'Plasmon Distributor',
    autoReplyEnabled: true,
    instagramAutoReplyEnabled: false,
    commentsCount: 0,
    knowledgeBase: 'We distribute through pharmacies.',
    kbActiveVersion: 1,
    isConnected: true,
    businessProfile: { hours: null, address: null },
  },
];

/** One un-keyed-by-date directory: names + an area attribute. No prices, no
 *  dates, nothing that joins across lists. */
const OUTLETS = {
  id: 'coll_outlets',
  label: 'Pharmacies carrying our products',
  keyAttr: 'Area',
  isComplete: true,
  rowCount: 3,
  rows: [
    { id: 'r1', name: 'Narjis Pharmacy', attributes: [{ label: 'Area', value: 'Downtown' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
    { id: 'r2', name: 'Yaqouta Pharmacy', attributes: [{ label: 'Area', value: 'Downtown' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
    { id: 'r3', name: 'Fayrouz Pharmacy', attributes: [{ label: 'Area', value: 'Hillside' }], price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true },
  ],
};

let renamePayload: { label?: string } | null = null;

function setupMockRoutes(page: import('@playwright/test').Page) {
  renamePayload = null;
  return page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/fact-collections')) {
      if (method === 'PATCH') {
        renamePayload = route.request().postDataJSON();
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ data: { id: OUTLETS.id, label: renamePayload?.label } }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [OUTLETS] }) });
    }
    if (url.includes('/catalog')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], vertical: { effective: 'general', source: 'default' } }) });
    }
    if (url.includes('/workspaces')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'ws_1', name: 'Test', role: 'owner' }] }) });
    }
    if (url.includes('/pages')) {
      // GET /pages answers a BARE ARRAY — `pagesApi.getAll().then(r => r.data)`
      // hands the body straight to the query. Wrapping it in `{ data: … }` here
      // renders the «connect a page» empty state and every assertion dies.
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PAGES) });
    }
    if (url.includes('/subscription/usage')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active', trialDaysRemaining: null }, aiReplies: { used: 0, limit: 100, percentUsed: 0 }, pages: { used: 1, limit: 3, percentUsed: 33 } } }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test.describe('/business — the Business Surface', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
    await page.addInitScript((pageId) => {
      localStorage.setItem('auth-storage', JSON.stringify({
        // isAdmin unlocks the surface ahead of GA (featureFlags.isCatalogVisible).
        state: {
          user: { id: 'user_1', email: 'test@test.com', name: 'Test User', isAdmin: true },
          token: 'mock-jwt-token', fbToken: 'mock-fb-token', isAuthenticated: true,
        },
        version: 0,
      }));
      localStorage.setItem('ui-storage', JSON.stringify({
        state: { sidebarOpen: true, language: 'en', _hasHydrated: false, isOnboardingVisible: false }, version: 0,
      }));
      localStorage.setItem('jawab24_onboarding_complete', 'true');
      // The picker restores from here; the ?page= deep link races it.
      localStorage.setItem('catalogPageId', pageId);
    }, PAGE_ID);
  });

  test('renders the merchant lists and quotes them back', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto(`/en/business?page=${PAGE_ID}`);

    await expect(page.getByRole('heading', { name: t('business.lists.title') })).toBeVisible();
    await expect(page.getByText(OUTLETS.label, { exact: true })).toBeVisible();
    await expect(page.getByText('Narjis Pharmacy')).toBeVisible();
    // Grouped under the merchant's own key, said once per area.
    await expect(page.getByText('Downtown', { exact: true })).toBeVisible();
  });

  /**
   * THE regression this spec exists for. A distributor is told the one thing
   * that is true of every business, and NOT told about item cards or expiring
   * rows — it has neither. Asserted structurally (which clauses render), so it
   * keeps working when the wording changes and needs no list of banned words.
   */
  test('tells a directory business only what is true of it', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto(`/en/business?page=${PAGE_ID}`);

    await expect(page.getByText(t('business.lists.hintQuoted'))).toBeVisible();
    await expect(page.getByText(t('business.lists.hintGrouped'))).toHaveCount(0);
    await expect(page.getByText(t('business.lists.hintDated'))).toHaveCount(0);
  });

  test('the same page in Arabic says the same thing, in Arabic', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto(`/ar/business?page=${PAGE_ID}`);

    await expect(page.getByText(tAr('business.lists.hintQuoted'))).toBeVisible();
    await expect(page.getByText(tAr('business.lists.hintGrouped'))).toHaveCount(0);
    await expect(page.getByText(tAr('business.lists.hintDated'))).toHaveCount(0);
  });

  test('an admin can rename a list, and the name reaches the API trimmed', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto(`/en/business?page=${PAGE_ID}`);

    const door = page.getByRole('button', { name: t('business.lists.renameActionFor', { list: OUTLETS.label }) });
    await expect(door).toBeVisible();
    await door.click();

    const field = page.locator('#list-label-input');
    await expect(field).toHaveValue(OUTLETS.label);
    await field.fill('  Our sales points  ');
    await page.getByRole('dialog').getByRole('button', { name: t('common.save') }).click();

    await expect.poll(() => renamePayload?.label).toBe('Our sales points');
  });

  test('the rename sheet refuses a name the page already uses, before any request', async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto(`/en/business?page=${PAGE_ID}`);

    await page.getByRole('button', { name: t('business.lists.renameActionFor', { list: OUTLETS.label }) }).click();
    const field = page.locator('#list-label-input');
    // Renaming to its OWN name is a no-op, never a clash.
    await expect(page.getByRole('dialog').getByRole('button', { name: t('common.save') })).toBeEnabled();

    await field.fill('   ');
    await expect(page.getByRole('dialog').getByRole('button', { name: t('common.save') })).toBeDisabled();
    expect(renamePayload).toBeNull();
  });
});
