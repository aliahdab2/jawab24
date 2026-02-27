import { test, expect } from '@playwright/test';
import en from '../src/i18n/en.json';
import ar from '../src/i18n/ar.json';

/**
 * Integrations Page E2E Tests
 *
 * Verifies the integrations page renders correctly with mocked API data.
 * Tests cover empty state (no stores connected), connected state (Shopify/Salla),
 * sync/disconnect actions, page linking, Arabic RTL rendering, and error handling.
 */

const MOCK_SHOPIFY_STORE = {
  id: 'store_1',
  userId: 'user_1',
  platform: 'shopify' as const,
  storeDomain: 'test-store.myshopify.com',
  storeName: 'Test Shopify Store',
  storeEmail: 'shop@test.com',
  storeCurrency: 'USD',
  tokenExpiresAt: null,
  productCount: 42,
  productSummary: null,
  policiesSummary: null,
  lastSyncAt: '2026-02-20T10:00:00Z' as string | null,
  isActive: true,
  installedAt: '2026-01-01T00:00:00Z',
};

const MOCK_SALLA_STORE = {
  id: 'store_2',
  userId: 'user_1',
  platform: 'salla' as const,
  storeDomain: 'test-store.salla.sa',
  storeName: 'Test Salla Store',
  storeEmail: 'salla@test.com',
  storeCurrency: 'SAR',
  tokenExpiresAt: null,
  productCount: 18,
  productSummary: null,
  policiesSummary: null,
  lastSyncAt: null,
  isActive: true,
  installedAt: '2026-02-01T00:00:00Z',
};

const MOCK_PAGES = [
  { id: 'page_1', facebookPageId: 'fb_123', name: 'My Business Page', autoReplyEnabled: true, ecommerceStoreId: null },
  { id: 'page_2', facebookPageId: 'fb_456', name: 'My Second Page', autoReplyEnabled: true, ecommerceStoreId: 'store_1' },
];

function setupAuth(page: import('@playwright/test').Page) {
  return page.addInitScript(() => {
    localStorage.setItem(
      'auth-storage',
      JSON.stringify({
        state: { user: { id: 'user_1', email: 'test@test.com', name: 'Test User' }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true },
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

function mockAPIs(
  page: import('@playwright/test').Page,
  options: { shopifyStore?: typeof MOCK_SHOPIFY_STORE | null; sallaStore?: typeof MOCK_SALLA_STORE | null; pages?: typeof MOCK_PAGES },
) {
  const { shopifyStore = null, sallaStore = null, pages = [] } = options;

  return page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    // Shopify store
    if (url.includes('/shopify/store') && !url.includes('/sync') && !url.includes('/link-page') && method === 'GET') {
      if (shopifyStore) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shopifyStore) });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
    }
    if (url.includes('/shopify/store/sync') && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    }
    if (url.includes('/shopify/store/link-page') && method === 'PATCH') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    }
    if (url.includes('/shopify/store') && method === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    }

    // Salla store
    if (url.includes('/salla/store') && !url.includes('/sync') && !url.includes('/link-page') && method === 'GET') {
      if (sallaStore) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sallaStore) });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
    }
    if (url.includes('/salla/store/sync') && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    }
    if (url.includes('/salla/store/link-page') && method === 'PATCH') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    }
    if (url.includes('/salla/store') && method === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    }

    // Pages
    if (url.includes('/pages')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: pages }) });
    }

    // Auth & subscription
    if (url.includes('/auth/profile')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
    }
    if (url.includes('/subscription/usage')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
    }

    // Default
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test.describe('Integrations Page', () => {
  /* ------------------------------------------------------------------ */
  /*  Empty state — no stores connected                                  */
  /* ------------------------------------------------------------------ */

  test('should render page title and both platform cards when no stores are connected', async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
    await setupAuth(page);
    await mockAPIs(page, {});

    await page.goto('/en/integrations');

    await expect(page).toHaveTitle(/Integrations.*Jawab24/i);
    await expect(
      page.locator('h1').filter({ hasText: en['integrations.title'] }).first()
    ).toBeVisible({ timeout: 15000 });

    // Both platform names should be visible
    await expect(page.getByText(en['shopify.title']).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(en['salla.title']).first()).toBeVisible({ timeout: 10000 });

    // Connect buttons should be visible
    const connectButtons = page.getByRole('button', { name: en['integrations.connect'], exact: true });
    await expect(connectButtons.first()).toBeVisible({ timeout: 10000 });
    expect(await connectButtons.count()).toBe(2);
  });

  test('should show platform descriptions in empty state', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, {});

    await page.goto('/en/integrations');

    await expect(page.getByText(en['integrations.shopifyDesc']).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(en['integrations.sallaDesc']).first()).toBeVisible({ timeout: 10000 });
  });

  /* ------------------------------------------------------------------ */
  /*  Connected state — Shopify connected                                */
  /* ------------------------------------------------------------------ */

  test('should show connected store card when Shopify is connected', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { shopifyStore: MOCK_SHOPIFY_STORE, pages: MOCK_PAGES });

    await page.goto('/en/integrations');

    // Store name should be visible
    await expect(page.getByText('Test Shopify Store').first()).toBeVisible({ timeout: 15000 });

    // Product count should be displayed
    await expect(page.getByText('42').first()).toBeVisible({ timeout: 10000 });

    // Sync and Disconnect buttons should be visible
    await expect(
      page.locator('button').filter({ hasText: en['shopify.syncNow'] }).first()
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('button').filter({ hasText: en['shopify.disconnect'] }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should hide competing platform when one is connected (Shopify connected hides Salla)', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { shopifyStore: MOCK_SHOPIFY_STORE, pages: MOCK_PAGES });

    await page.goto('/en/integrations');

    // Shopify store card should be visible
    await expect(page.getByText('Test Shopify Store').first()).toBeVisible({ timeout: 15000 });

    // Divider should NOT appear (competing platform is hidden)
    await expect(page.getByText(en['integrations.addAnother'])).not.toBeVisible();

    // No Connect buttons (Salla is hidden, not just unconnected)
    const connectButtons = page.getByRole('button', { name: en['integrations.connect'], exact: true });
    await expect(connectButtons).toHaveCount(0, { timeout: 10000 });
  });

  test('should show page linking chips when pages exist', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { shopifyStore: MOCK_SHOPIFY_STORE, pages: MOCK_PAGES });

    await page.goto('/en/integrations');

    // Link Page section should be visible
    await expect(page.getByText(en['shopify.linkPage']).first()).toBeVisible({ timeout: 15000 });

    // Page names should appear as linkable buttons
    await expect(page.getByText('My Business Page').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('My Second Page').first()).toBeVisible({ timeout: 10000 });
  });

  /* ------------------------------------------------------------------ */
  /*  Both stores connected                                              */
  /* ------------------------------------------------------------------ */

  test('should show both stores when both are connected', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { shopifyStore: MOCK_SHOPIFY_STORE, sallaStore: MOCK_SALLA_STORE, pages: MOCK_PAGES });

    await page.goto('/en/integrations');

    // Both store names visible
    await expect(page.getByText('Test Shopify Store').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Test Salla Store').first()).toBeVisible({ timeout: 10000 });

    // No Connect buttons should appear (both connected)
    const connectButtons = page.getByRole('button', { name: en['integrations.connect'], exact: true });
    await expect(connectButtons).toHaveCount(0, { timeout: 10000 });

    // No divider should appear (nothing unconnected)
    await expect(page.getByText(en['integrations.addAnother'])).not.toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  Sync action                                                        */
  /* ------------------------------------------------------------------ */

  test('should trigger sync and show success toast', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { shopifyStore: MOCK_SHOPIFY_STORE, pages: MOCK_PAGES });

    await page.goto('/en/integrations');

    const syncBtn = page.locator('button').filter({ hasText: en['shopify.syncNow'] }).first();
    await expect(syncBtn).toBeVisible({ timeout: 15000 });
    await syncBtn.click();

    // Success toast should appear
    await expect(page.getByText(en['shopify.syncSuccess']).first()).toBeVisible({ timeout: 10000 });
  });

  /* ------------------------------------------------------------------ */
  /*  Arabic (RTL)                                                       */
  /* ------------------------------------------------------------------ */

  test('should render in Arabic (RTL) at /ar/integrations', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: { id: 'user_1', email: 'test@test.com', name: 'Test User' }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true },
          version: 0,
        })
      );
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { sidebarOpen: true, language: 'ar', _hasHydrated: false, isOnboardingVisible: false }, version: 0 })
      );
      localStorage.setItem('jawab24_onboarding_complete', 'true');
    });
    await mockAPIs(page, {});

    await page.goto('/ar/integrations');

    // Arabic heading should be visible (accept English fallback during hydration)
    const titlePattern = new RegExp(`${ar['integrations.title']}|${en['integrations.title']}`, 'i');
    await expect(
      page.locator('h1').filter({ hasText: titlePattern }).first()
    ).toBeVisible({ timeout: 15000 });

    // Page should have meaningful content
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(50);
  });

  /* ------------------------------------------------------------------ */
  /*  Error handling                                                     */
  /* ------------------------------------------------------------------ */

  test('should not crash when APIs fail', async ({ page }) => {
    await setupAuth(page);

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
      }
      await route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto('/en/integrations');

    // Page should render without crashing — shows empty state
    await expect(page).toHaveTitle(/Integrations.*Jawab24/i, { timeout: 15000 });
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();

    // Should still show Connect cards (stores failed = treated as not connected)
    const connectButtons = page.getByRole('button', { name: en['integrations.connect'], exact: true });
    await expect(connectButtons.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show "Never" for last sync when store has not been synced', async ({ page }) => {
    await setupAuth(page);
    const neverSyncedStore = { ...MOCK_SHOPIFY_STORE, lastSyncAt: null };
    await mockAPIs(page, { shopifyStore: neverSyncedStore, pages: [] });

    await page.goto('/en/integrations');

    await expect(page.getByText(en['shopify.never']).first()).toBeVisible({ timeout: 15000 });
  });
});
