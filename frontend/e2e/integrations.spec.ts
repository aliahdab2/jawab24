import { test, expect } from '@playwright/test';
import { t, tAr } from './i18n';

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

interface AnalyticsFixture {
  storeId: string;
  recovery: { abandonedCartsNotified: number; cartsRecovered: number; revenueRecovered: number; currency: string | null };
  replies: { totalReplies: number; aiReplies: number; postReplies: number; manualReplies: number };
}

function mockAPIs(
  page: import('@playwright/test').Page,
  options: {
    shopifyStore?: typeof MOCK_SHOPIFY_STORE | null;
    sallaStore?: typeof MOCK_SALLA_STORE | null;
    pages?: typeof MOCK_PAGES;
    /** Per-store analytics overview keyed by storeId. Omitted = 500 from analytics endpoint. */
    analytics?: Record<string, AnalyticsFixture>;
    analyticsStatus?: number;
  },
) {
  const { shopifyStore = null, sallaStore = null, pages = [], analytics, analyticsStatus } = options;

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

    // Per-store analytics overview (used by the embedded summary widget on this page).
    if (url.includes('/api/ecommerce-analytics/') && method === 'GET') {
      if (analyticsStatus && analyticsStatus >= 400) {
        return route.fulfill({ status: analyticsStatus, contentType: 'application/json', body: JSON.stringify({ error: 'down' }) });
      }
      const storeId = url.split('/api/ecommerce-analytics/')[1]?.split('?')[0];
      const fixture = storeId && analytics ? analytics[storeId] : undefined;
      if (fixture) {
        const payload = {
          storeId: fixture.storeId,
          period: { from: '2026-03-25T00:00:00Z', to: '2026-04-25T00:00:00Z', range: '30d' },
          notifications: {
            funnel: { total: { sent: 0, delivered: 0, failed: 0, pending: 0 }, byChannel: {} },
            byType: {},
          },
          recovery: fixture.recovery,
          replies: fixture.replies,
        };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      }
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'no fixture' }) });
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

  test('should render page title and not-connected cards when no stores are connected', async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
    await setupAuth(page);
    await mockAPIs(page, {});

    await page.goto('/en/integrations');

    await expect(page).toHaveTitle(new RegExp(`${t('integrations.title')}.*Jawab24`, 'i'));
    await expect(
      page.locator('h1').filter({ hasText: t('integrations.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Not-connected promo cards shown with Connect buttons for each platform
    const connectButtons = page.getByRole('button', { name: new RegExp(t('integrations.notConnected.connectBtn'), 'i') });
    await expect(connectButtons).toHaveCount(2, { timeout: 10000 });
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
      page.locator('button').filter({ hasText: t('shopify.syncNow') }).first()
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('button').filter({ hasText: t('shopify.disconnect') }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show Salla not-connected card when only Shopify is connected', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { shopifyStore: MOCK_SHOPIFY_STORE, pages: MOCK_PAGES });

    await page.goto('/en/integrations');

    await expect(page.getByText('Test Shopify Store').first()).toBeVisible({ timeout: 15000 });

    // Salla was never connected (404) → not-connected promo card shown
    await expect(page.getByText(t('salla.title')).first()).toBeVisible({ timeout: 10000 });
    // But no Salla store data shown
    await expect(page.getByText('Test Salla Store')).not.toBeVisible();
  });

  test('should show page linking chips when pages exist', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { shopifyStore: MOCK_SHOPIFY_STORE, pages: MOCK_PAGES });

    await page.goto('/en/integrations');

    await expect(page.getByText(t('shopify.linkPage')).first()).toBeVisible({ timeout: 15000 });
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
      page.locator('button').filter({ hasText: t('integrations.reconnect') }).first()
    ).toBeVisible({ timeout: 10000 });

    // Disconnected state message shown
    await expect(page.getByText(t('integrations.disconnectedState')).first()).toBeVisible({ timeout: 10000 });

    // No sync or disconnect buttons (store is not active)
    await expect(page.locator('button').filter({ hasText: t('shopify.syncNow') })).toHaveCount(0);
    await expect(page.locator('button').filter({ hasText: t('shopify.disconnect') })).toHaveCount(0);
  });

  test('should show Reconnect card after user clicks Disconnect', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { shopifyStore: MOCK_SHOPIFY_STORE, pages: [] });

    await page.goto('/en/integrations');

    await expect(page.getByText('Test Shopify Store').first()).toBeVisible({ timeout: 15000 });

    // Click Disconnect
    const disconnectBtn = page.locator('button').filter({ hasText: t('shopify.disconnect') }).first();
    await disconnectBtn.click();

    // Confirm in modal
    const confirmBtn = page.getByRole('button', { name: t('shopify.disconnect'), exact: true }).last();
    await confirmBtn.click();

    // Now shows Reconnect card
    await expect(
      page.locator('button').filter({ hasText: t('integrations.reconnect') }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  /* ------------------------------------------------------------------ */
  /*  Sync action                                                        */
  /* ------------------------------------------------------------------ */

  test('should trigger sync and show success toast', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { shopifyStore: MOCK_SHOPIFY_STORE, pages: MOCK_PAGES });

    await page.goto('/en/integrations');

    const syncBtn = page.locator('button').filter({ hasText: t('shopify.syncNow') }).first();
    await expect(syncBtn).toBeVisible({ timeout: 15000 });
    await syncBtn.click();

    await expect(page.getByText(t('shopify.syncSuccess')).first()).toBeVisible({ timeout: 10000 });
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

    const titlePattern = new RegExp(`${tAr('integrations.title')}|${t('integrations.title')}`, 'i');
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

    await expect(page).toHaveTitle(new RegExp(`${t('integrations.title')}.*Jawab24`, 'i'), { timeout: 15000 });
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();

    // No store cards shown (all APIs failed = null → not rendered)
    await expect(page.getByText('Test Shopify Store')).not.toBeVisible();
  });

  test('should show "Never" for last sync when store has not been synced', async ({ page }) => {
    await setupAuth(page);
    const neverSyncedStore = { ...MOCK_SHOPIFY_STORE, lastSyncAt: null };
    await mockAPIs(page, { shopifyStore: neverSyncedStore, pages: [] });

    await page.goto('/en/integrations');

    await expect(page.getByText(t('shopify.never')).first()).toBeVisible({ timeout: 15000 });
  });
});

/* ------------------------------------------------------------------ */
/*  OrderNotificationsCard                                              */
/* ------------------------------------------------------------------ */

const MOCK_TEMPLATES = [
  { id: 't1', storeId: 'store_1', notificationType: 'abandoned_cart', isEnabled: true, messageAr: 'نسيت شيئاً في سلتك!', messageEn: 'You left something in your cart!', delayMinutes: 60 },
  { id: 't2', storeId: 'store_1', notificationType: 'order_confirmed', isEnabled: true, messageAr: 'تم تأكيد طلبك', messageEn: 'Your order is confirmed', delayMinutes: 0 },
  { id: 't3', storeId: 'store_1', notificationType: 'order_shipped', isEnabled: false, messageAr: 'تم شحن طلبك', messageEn: 'Your order has shipped', delayMinutes: 0 },
  { id: 't4', storeId: 'store_1', notificationType: 'order_delivered', isEnabled: false, messageAr: 'تم تسليم طلبك', messageEn: 'Your order was delivered', delayMinutes: 0 },
  { id: 't5', storeId: 'store_1', notificationType: 'review_request', isEnabled: false, messageAr: 'شاركنا رأيك', messageEn: 'Leave us a review', delayMinutes: 1440 },
  { id: 't6', storeId: 'store_1', notificationType: 'digital_delivery', isEnabled: false, messageAr: 'رابط التحميل', messageEn: 'Your download link', delayMinutes: 0 },
];

const MOCK_NOTIF_STATS = { sent: 45, failed: 2, total: 47 };

function mockAPIsWithNotifications(page: import('@playwright/test').Page) {
  return page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/shopify/store') && !url.includes('/sync') && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SHOPIFY_STORE) });
    }
    if (url.includes('/notification-templates/') && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TEMPLATES) });
    }
    if (url.includes('/notification-templates/') && method === 'PUT') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    }
    if (url.includes('/notification-templates/') && url.includes('/reset') && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    if (url.includes('/notification-log/') && url.includes('/stats')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_NOTIF_STATS) });
    }
    if (url.includes('/pages')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_PAGES }) });
    }
    if (url.includes('/salla/store') && method === 'GET') {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
    }
    if (url.includes('/auth/profile')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
    }
    if (url.includes('/subscription/usage')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { subscription: { plan: { name: 'Starter' }, status: 'active' }, aiReplies: { used: 5, limit: 100, percentUsed: 5 }, pages: { used: 1, limit: 1 } } }) });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test.describe('OrderNotificationsCard', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
    await setupAuth(page);
    await mockAPIsWithNotifications(page);
    await page.goto('/en/integrations');
    await expect(page.getByText('Test Shopify Store').first()).toBeVisible({ timeout: 15000 });
  });

  test('should render the card with all 6 notification types', async ({ page }) => {
    await expect(page.getByText(t('orderNotifications.title')).first()).toBeVisible({ timeout: 10000 });

    for (const type of ['abandoned_cart', 'order_confirmed', 'order_shipped', 'order_delivered', 'review_request', 'digital_delivery'] as const) {
      await expect(page.getByText(t(`orderNotifications.types.${type}`)).first()).toBeVisible();
    }
  });

  test('should show stats pill when stats are available', async ({ page }) => {
    await expect(page.getByText(t('orderNotifications.title')).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(`45 ${t('orderNotifications.sent')}`).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(`2 ${t('orderNotifications.failed')}`).first()).toBeVisible({ timeout: 5000 });
  });

  test('should expand a notification type and show message fields', async ({ page }) => {
    await expect(page.getByText(t('orderNotifications.title')).first()).toBeVisible({ timeout: 10000 });

    // Click the expand chevron for "Abandoned Cart"
    const expandBtn = page.getByRole('button', { name: t('orderNotifications.types.abandoned_cart') }).first();
    await expandBtn.click();

    // AR and EN textareas visible
    await expect(page.getByLabel(t('orderNotifications.templateAr')).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel(t('orderNotifications.templateEn')).first()).toBeVisible({ timeout: 5000 });

    // Delay presets visible
    await expect(page.getByText(t('orderNotifications.immediately')).first()).toBeVisible();

    // Variables hint visible
    await expect(page.getByText(t('orderNotifications.variables')).first()).toBeVisible();
  });

  test('should show existing message content when expanded', async ({ page }) => {
    await expect(page.getByText(t('orderNotifications.title')).first()).toBeVisible({ timeout: 10000 });

    const expandBtn = page.getByRole('button', { name: t('orderNotifications.types.abandoned_cart') }).first();
    await expandBtn.click();

    const arTextarea = page.locator('textarea#msg-ar-abandoned_cart');
    await expect(arTextarea).toHaveValue('نسيت شيئاً في سلتك!', { timeout: 5000 });

    const enTextarea = page.locator('textarea#msg-en-abandoned_cart');
    await expect(enTextarea).toHaveValue('You left something in your cart!', { timeout: 5000 });
  });

  test('should enable save button when toggling a notification type', async ({ page }) => {
    await expect(page.getByText(t('orderNotifications.title')).first()).toBeVisible({ timeout: 10000 });

    const saveBtn = page.getByRole('button', { name: t('orderNotifications.noChanges') }).first();
    await expect(saveBtn).toBeDisabled();

    // Toggle "Order Shipped" (currently disabled)
    const toggle = page.locator('[aria-label="' + t('orderNotifications.types.order_shipped') + '"][role="switch"]').first();
    await toggle.click();

    await expect(page.getByRole('button', { name: t('orderNotifications.save') }).first()).toBeEnabled({ timeout: 5000 });
  });

  test('should enable save button when editing a message field', async ({ page }) => {
    await expect(page.getByText(t('orderNotifications.title')).first()).toBeVisible({ timeout: 10000 });

    const expandBtn = page.getByRole('button', { name: t('orderNotifications.types.order_confirmed') }).first();
    await expandBtn.click();

    const enTextarea = page.locator('textarea#msg-en-order_confirmed');
    await enTextarea.fill('Your order has been placed successfully!');

    await expect(page.getByRole('button', { name: t('orderNotifications.save') }).first()).toBeEnabled({ timeout: 5000 });
  });

  test('should save changes and show success toast', async ({ page }) => {
    await expect(page.getByText(t('orderNotifications.title')).first()).toBeVisible({ timeout: 10000 });

    // Make a change
    const expandBtn = page.getByRole('button', { name: t('orderNotifications.types.order_confirmed') }).first();
    await expandBtn.click();
    const enTextarea = page.locator('textarea#msg-en-order_confirmed');
    await enTextarea.fill('Updated message!');

    const saveBtn = page.getByRole('button', { name: t('orderNotifications.save') }).first();
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();

    await expect(page.getByText(t('orderNotifications.savedSuccess')).first()).toBeVisible({ timeout: 5000 });
  });

  test('should change active delay preset when clicked', async ({ page }) => {
    await expect(page.getByText(t('orderNotifications.title')).first()).toBeVisible({ timeout: 10000 });

    const expandBtn = page.getByRole('button', { name: t('orderNotifications.types.order_confirmed') }).first();
    await expandBtn.click();

    // Click "5 min" preset
    const fiveMinBtn = page.getByRole('button', { name: t('orderNotifications.delayMin', { n: 5 }) }).first();
    await fiveMinBtn.click();

    // Save button should be enabled (delay changed from 0 to 5)
    await expect(page.getByRole('button', { name: t('orderNotifications.save') }).first()).toBeEnabled({ timeout: 5000 });
  });

  test('should collapse expanded section when chevron clicked again', async ({ page }) => {
    await expect(page.getByText(t('orderNotifications.title')).first()).toBeVisible({ timeout: 10000 });

    const expandBtn = page.getByRole('button', { name: t('orderNotifications.types.abandoned_cart') }).first();
    await expandBtn.click();
    await expect(page.locator('textarea#msg-ar-abandoned_cart')).toBeVisible({ timeout: 5000 });

    // Collapse
    await expandBtn.click();
    await expect(page.locator('textarea#msg-ar-abandoned_cart')).not.toBeVisible();
  });
});

/* ====================================================================== */
/*  StoreAnalyticsSummary widget — embedded inside ConnectedStoreCard      */
/* ====================================================================== */

test.describe('Integrations — Store Analytics Summary widget', () => {
  test('shows recovered carts + revenue + a "View details" link when analytics has data', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, {
      shopifyStore: MOCK_SHOPIFY_STORE,
      pages: MOCK_PAGES,
      analytics: {
        [MOCK_SHOPIFY_STORE.id]: {
          storeId: MOCK_SHOPIFY_STORE.id,
          recovery: { abandonedCartsNotified: 12, cartsRecovered: 4, revenueRecovered: 480, currency: 'SAR' },
          replies: { totalReplies: 100, aiReplies: 87, postReplies: 0, manualReplies: 13 },
        },
      },
    });

    await page.goto('/en/integrations');

    // Wait for the connected card to render
    await expect(page.getByText('Test Shopify Store').first()).toBeVisible({ timeout: 15000 });

    // Widget should surface the carts-recovered + revenue summary
    await expect(page.getByText(/4 carts recovered/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/480.*SAR/).first()).toBeVisible();

    // The link should route to the dedicated analytics page
    const link = page.getByRole('link', { name: t('ecommerceAnalytics.summary.viewDetails') }).first();
    await expect(link).toHaveAttribute('href', '/en/ecommerce-analytics');
  });

  test('hides the widget on a connected store with no analytics data yet', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, {
      shopifyStore: MOCK_SHOPIFY_STORE,
      pages: MOCK_PAGES,
      analytics: {
        [MOCK_SHOPIFY_STORE.id]: {
          storeId: MOCK_SHOPIFY_STORE.id,
          recovery: { abandonedCartsNotified: 0, cartsRecovered: 0, revenueRecovered: 0, currency: null },
          replies: { totalReplies: 0, aiReplies: 0, postReplies: 0, manualReplies: 0 },
        },
      },
    });

    await page.goto('/en/integrations');
    await expect(page.getByText('Test Shopify Store').first()).toBeVisible({ timeout: 15000 });

    // No "carts recovered" copy, no widget link
    await expect(page.getByText(/carts recovered/i)).toHaveCount(0);
  });

  test('falls back to a "View details" link when analytics endpoint returns 500', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, {
      shopifyStore: MOCK_SHOPIFY_STORE,
      pages: MOCK_PAGES,
      analyticsStatus: 500,
    });

    await page.goto('/en/integrations');
    await expect(page.getByText('Test Shopify Store').first()).toBeVisible({ timeout: 15000 });

    // No numbers, but the discoverability link is still present
    const link = page.getByRole('link', { name: t('ecommerceAnalytics.summary.viewDetails') }).first();
    await expect(link).toBeVisible({ timeout: 10000 });
    await expect(link).toHaveAttribute('href', '/en/ecommerce-analytics');
    await expect(page.getByText(/carts recovered/i)).toHaveCount(0);
  });
});
