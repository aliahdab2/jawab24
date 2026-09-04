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

const MOCK_ZID_STORE = {
  id: 'store_3',
  userId: 'user_1',
  platform: 'zid' as const,
  storeDomain: 'test-store.zid.sa',
  storeName: 'Test Zid Store',
  storeEmail: 'zid@test.com',
  storeCurrency: 'SAR',
  tokenExpiresAt: null,
  productCount: 24,
  productSummary: null,
  policiesSummary: null,
  lastSyncAt: null,
  isActive: true,
  installedAt: '2026-02-15T00:00:00Z',
};

const MOCK_PAGES = [
  { id: 'page_1', facebookPageId: 'fb_123', name: 'My Business Page', autoReplyEnabled: true, ecommerceStoreId: null },
  { id: 'page_2', facebookPageId: 'fb_456', name: 'My Second Page', autoReplyEnabled: true, ecommerceStoreId: 'store_1' },
];

function setupAuth(page: import('@playwright/test').Page, locale: 'en' | 'ar' = 'en') {
  // `isAdmin` is NOT load-bearing here any more. This page was admin-only during
  // the public roll-out and the guard redirected every non-admin to /dashboard;
  // that guard came off 2026-09-04 (owner ruling, #1048) and nothing on
  // pages/integrations.tsx reads `user.isAdmin` today. The flag stays only so the
  // fixture keeps describing one consistent user — reaching the page no longer
  // depends on it, and a non-admin fixture would render this page identically.
  //
  // The `language` in ui-storage MUST match the URL locale. _app.tsx has a
  // sync effect (lines 167-173) that redirects to the store's language when
  // it differs from the URL on the default locale ('ar'). If we hardcode
  // 'en' here and run a [ar] test, the page redirects /ar/* → /en/* on
  // hydration and the test never finds the Arabic copy it expects.
  return page.addInitScript((language) => {
    localStorage.setItem(
      'auth-storage',
      JSON.stringify({
        state: { user: { id: 'user_1', email: 'test@test.com', name: 'Test User', isAdmin: true }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true, _hasHydrated: true },
        version: 0,
      })
    );
    localStorage.setItem(
      'ui-storage',
      JSON.stringify({ state: { sidebarOpen: true, language, _hasHydrated: false, isOnboardingVisible: false }, version: 0 })
    );
    localStorage.setItem('jawab24_onboarding_complete', 'true');
  }, locale);
}

interface AnalyticsFixture {
  storeId: string;
  recovery: { abandonedCartsNotified: number; cartsRecovered: number; revenueRecovered: number; currency: string | null };
  replies: { totalReplies: number; aiReplies: number; postReplies: number; manualReplies: number };
}

type StoreFixture<Base> = Base & { webhookHealth?: 'ok' | 'pending' | 'failed' | 'unknown' };

function mockAPIs(
  page: import('@playwright/test').Page,
  options: {
    shopifyStore?: StoreFixture<typeof MOCK_SHOPIFY_STORE> | null;
    sallaStore?: StoreFixture<typeof MOCK_SALLA_STORE> | null;
    zidStore?: StoreFixture<typeof MOCK_ZID_STORE> | null;
    pages?: typeof MOCK_PAGES;
    /** Per-store analytics overview keyed by storeId. Omitted = 500 from analytics endpoint. */
    analytics?: Record<string, AnalyticsFixture>;
    analyticsStatus?: number;
    /** Mutable counter the mock increments on each platform-specific reregister POST.
     *  Tests assert e.g. `expect(reregisterCounts.salla).toBe(1)` after clicking Try-again. */
    reregisterCounts?: { shopify: number; salla: number; zid: number };
  },
) {
  const { shopifyStore = null, sallaStore = null, zidStore = null, pages = [], analytics, analyticsStatus, reregisterCounts } = options;

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

    // Reregister webhooks — POST per platform. Checked BEFORE the store-GET
    // routes below so the URL substring `/store/webhooks/reregister` doesn't
    // accidentally match the GET branch.
    for (const p of ['shopify', 'salla', 'zid'] as const) {
      if (url.includes(`/${p}/store/webhooks/reregister`) && method === 'POST') {
        if (reregisterCounts) reregisterCounts[p]++;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            webhookStatus: { registered: ['t1', 't2'], failed: [], lastAttempt: '2026-05-07T00:00:00Z' },
          }),
        });
      }
    }

    // Zid store
    if (url.includes('/zid/store') && !url.includes('/sync') && !url.includes('/link-page') && method === 'GET') {
      if (zidStore) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(zidStore) });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
    }
    if (url.includes('/zid/store/sync') && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    }
    if (url.includes('/zid/store/link-page') && method === 'PATCH') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    }
    if (url.includes('/zid/store') && method === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
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

  test('should render page title and platform-picker tabs when no stores are connected', async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
    await setupAuth(page);
    await mockAPIs(page, {});

    await page.goto('/en/integrations');

    await expect(page).toHaveTitle(new RegExp(`${t('integrations.title')}.*Jawab24`, 'i'));
    await expect(
      page.locator('h1').filter({ hasText: t('integrations.title') }).first()
    ).toBeVisible({ timeout: 15000 });

    // Empty-state design: a single tab strip lets the merchant pick one
    // platform, so only ONE Connect Store button is rendered at a time
    // (the active tab's). Three tabs are present, default selected = Shopify.
    const tabs = page.getByRole('tablist').getByRole('tab');
    await expect(tabs).toHaveCount(3, { timeout: 10000 });
    const connectButtons = page.getByRole('button', { name: new RegExp(t('integrations.notConnected.connectBtn'), 'i') });
    await expect(connectButtons).toHaveCount(1, { timeout: 10000 });
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

  test('should show Salla card under "Add another store" when only Shopify is connected', async ({ page }) => {
    await setupAuth(page);
    await mockAPIs(page, { shopifyStore: MOCK_SHOPIFY_STORE, pages: MOCK_PAGES });

    await page.goto('/en/integrations');

    await expect(page.getByText('Test Shopify Store').first()).toBeVisible({ timeout: 15000 });

    // Once any store is connected, unconnected platforms collapse behind a
    // single "+ Add another store" pill so the connected card stays the
    // visual focus. The Salla card is hidden until the merchant explicitly
    // expands the pill.
    const addAnotherStore = page.getByRole('button', { name: new RegExp(t('integrations.addAnotherStore'), 'i') });
    await expect(addAnotherStore).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(t('salla.title')).first()).not.toBeVisible();

    // After clicking, the Salla promo card appears.
    await addAnotherStore.click();
    await expect(page.getByText(t('salla.title')).first()).toBeVisible({ timeout: 10000 });
    // But still no Salla store data — only the not-connected pitch.
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

  /* ------------------------------------------------------------------ */
  /*  webhookHealth recovery UI — over [shopify, salla, zid] x [en, ar]  */
  /* ------------------------------------------------------------------ */

  // The badge + reregister button live in the platform-agnostic
  // ConnectedStoreCard. Coverage proves the UI hits the per-platform
  // endpoint and that copy translates correctly in both locales — so a
  // Salla/Zid merchant in `webhookHealth: 'failed'` has a real recovery
  // path in both English and Arabic.
  const PLATFORM_FIXTURES = {
    shopify: MOCK_SHOPIFY_STORE,
    salla: MOCK_SALLA_STORE,
    zid: MOCK_ZID_STORE,
  } as const;

  for (const platform of ['shopify', 'salla', 'zid'] as const) {
    for (const locale of ['en', 'ar'] as const) {
      test(`[${locale}] shows reregister CTA and POSTs /${platform}/store/webhooks/reregister when webhookHealth is "failed"`, async ({ page }) => {
        await setupAuth(page, locale);

        const failedStore = { ...PLATFORM_FIXTURES[platform], webhookHealth: 'failed' as const };
        const reregisterCounts = { shopify: 0, salla: 0, zid: 0 };
        await mockAPIs(page, {
          shopifyStore: platform === 'shopify' ? failedStore as StoreFixture<typeof MOCK_SHOPIFY_STORE> : null,
          sallaStore: platform === 'salla' ? failedStore as StoreFixture<typeof MOCK_SALLA_STORE> : null,
          zidStore: platform === 'zid' ? failedStore as StoreFixture<typeof MOCK_ZID_STORE> : null,
          reregisterCounts,
        });

        await page.goto(`/${locale}/integrations`);

        const tCopy = locale === 'ar' ? tAr : t;
        // Banner must use role="alert" so screen readers announce it when
        // webhookHealth flips to 'failed' — that's the merchant's only signal
        // that webhooks aren't firing. Asserting via role validates the a11y
        // attribute, not just the visible copy.
        const banner = page.getByRole('alert').filter({ hasText: tCopy('integrations.webhookHealth.failedTitle') });
        await expect(banner.first()).toBeVisible({ timeout: 15000 });
        const tryAgain = page.getByRole('button', { name: new RegExp(tCopy('integrations.webhookHealth.reregisterBtn'), 'i') });
        await expect(tryAgain.first()).toBeVisible({ timeout: 10000 });

        await tryAgain.first().click();
        await expect(page.getByText(tCopy('integrations.webhookHealth.reregisterSuccess')).first()).toBeVisible({ timeout: 10000 });

        // Only the platform under test should have been hit.
        expect(reregisterCounts[platform]).toBe(1);
        const otherPlatforms = (['shopify', 'salla', 'zid'] as const).filter(p => p !== platform);
        for (const other of otherPlatforms) {
          expect(reregisterCounts[other]).toBe(0);
        }
      });
    }
  }
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
