import { test, expect } from '@playwright/test';
import en from '../src/i18n/en.json';
import ar from '../src/i18n/ar.json';

/**
 * Integrations Page E2E Tests
 *
 * The integrations page is a management-only view. Stores are connected
 * externally (via Shopify/Salla app stores), never from within Jawab24.
 *
 * Three possible states per platform:
 *  - null (404) → platform never connected → card not shown
 *  - isActive: true → ConnectedStoreCard
 *  - isActive: false → DisconnectedCard with Reconnect button
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
  options: {
    shopifyStore?: typeof MOCK_SHOPIFY_STORE | null;
    sallaStore?: typeof MOCK_SALLA_STORE | null;
    pages?: typeof MOCK_PAGES;
  },
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
  /*  No stores — page shows header only (management-only view)          */
  /* ------------------------------------------------------------------ */

  test('should render page title when no stores are connected', async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
    await setupAuth(page);
    await mockAPIs(page, {});

    await page.goto('/en/integrations');

    await expect(page).toHaveTitle(/Integrations.*Jawab24/i);
    await expect(
      page.locator('h1').filter({ hasText: en['integrations.title'] }).first()
    ).toBeVisible({ timeout: 15000 });

    // No Connect buttons — stores are connected externally via Shopify/Salla app stores
    const connectButtons = page.getByRole('button', { name: /connect/i });
    await expect(connectButtons).toHaveCount(0, { timeout: 10000 });
  });

  /* ------------------------------------------------------------------ */
  /*  Connected state — Shopify active                                   */
  /* ------------------------------------------------------------------ */

  test('should show connected store card when Shopify is active', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { shopifyStore: MOCK_SHOPIFY_STORE, pages: MOCK_PAGES });

    await page.goto('/en/integrations');

    await expect(page.getByText('Test Shopify Store').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('42').first()).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator('button').filter({ hasText: en['shopify.syncNow'] }).first()
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('button').filter({ hasText: en['shopify.disconnect'] }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should not show Salla card when only Shopify is connected', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { shopifyStore: MOCK_SHOPIFY_STORE, pages: MOCK_PAGES });

    await page.goto('/en/integrations');

    await expect(page.getByText('Test Shopify Store').first()).toBeVisible({ timeout: 15000 });

    // Salla was never connected (404) → no Salla card shown at all
    await expect(page.getByText(en['salla.title'])).not.toBeVisible();
  });

  test('should show page linking chips when pages exist', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { shopifyStore: MOCK_SHOPIFY_STORE, pages: MOCK_PAGES });

    await page.goto('/en/integrations');

    await expect(page.getByText(en['shopify.linkPage']).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('My Business Page').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('My Second Page').first()).toBeVisible({ timeout: 10000 });
  });

  /* ------------------------------------------------------------------ */
  /*  Disconnected state — isActive: false → Reconnect card             */
  /* ------------------------------------------------------------------ */

  test('should show Reconnect button when store is inactive (disconnected)', async ({ page }) => {
    await setupAuth(page);
    const disconnectedStore = { ...MOCK_SHOPIFY_STORE, isActive: false };
    await mockAPIs(page, { shopifyStore: disconnectedStore, pages: [] });

    await page.goto('/en/integrations');

    // Store name still visible in the card
    await expect(page.getByText('Test Shopify Store').first()).toBeVisible({ timeout: 15000 });

    // Reconnect button shown
    await expect(
      page.locator('button').filter({ hasText: en['integrations.reconnect'] }).first()
    ).toBeVisible({ timeout: 10000 });

    // Disconnected state message shown
    await expect(page.getByText(en['integrations.disconnectedState']).first()).toBeVisible({ timeout: 10000 });

    // No sync or disconnect buttons (store is not active)
    await expect(page.locator('button').filter({ hasText: en['shopify.syncNow'] })).toHaveCount(0);
    await expect(page.locator('button').filter({ hasText: en['shopify.disconnect'] })).toHaveCount(0);
  });

  test('should show Reconnect card after user clicks Disconnect', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { shopifyStore: MOCK_SHOPIFY_STORE, pages: [] });

    await page.goto('/en/integrations');

    await expect(page.getByText('Test Shopify Store').first()).toBeVisible({ timeout: 15000 });

    // Click Disconnect
    const disconnectBtn = page.locator('button').filter({ hasText: en['shopify.disconnect'] }).first();
    await disconnectBtn.click();

    // Confirm in modal
    const confirmBtn = page.getByRole('button', { name: en['shopify.disconnect'], exact: true }).last();
    await confirmBtn.click();

    // Now shows Reconnect card
    await expect(
      page.locator('button').filter({ hasText: en['integrations.reconnect'] }).first()
    ).toBeVisible({ timeout: 10000 });
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
    await mockAPIs(page, { shopifyStore: MOCK_SHOPIFY_STORE });

    await page.goto('/ar/integrations');

    const titlePattern = new RegExp(`${ar['integrations.title']}|${en['integrations.title']}`, 'i');
    await expect(
      page.locator('h1').filter({ hasText: titlePattern }).first()
    ).toBeVisible({ timeout: 15000 });

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

    await expect(page).toHaveTitle(/Integrations.*Jawab24/i, { timeout: 15000 });
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();

    // No store cards shown (all APIs failed = null → not rendered)
    await expect(page.getByText('Test Shopify Store')).not.toBeVisible();
  });

  test('should show "Never" for last sync when store has not been synced', async ({ page }) => {
    await setupAuth(page);
    const neverSyncedStore = { ...MOCK_SHOPIFY_STORE, lastSyncAt: null };
    await mockAPIs(page, { shopifyStore: neverSyncedStore, pages: [] });

    await page.goto('/en/integrations');

    await expect(page.getByText(en['shopify.never']).first()).toBeVisible({ timeout: 15000 });
  });
});
