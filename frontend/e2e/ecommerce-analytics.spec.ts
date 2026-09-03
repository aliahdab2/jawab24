import { test, expect, type Page, type Route } from '@playwright/test';
import { t, tAr } from './i18n';

/**
 * E-commerce Analytics Page E2E
 *
 * Validates the merchant-facing analytics dashboard end-to-end:
 *  - Connected store renders KPIs + sections
 *  - No store renders the connect-prompt
 *  - Range toggle re-fetches with the new range param
 *  - API errors surface a retry CTA
 *  - Arabic locale renders RTL with translated labels
 *
 * The page reads from `useConnectedStore` (probes shopify/salla/zid) and
 * `ecommerceAnalyticsApi.getOverview` — both are mocked at the network layer.
 */

const STORE_ID = 'store-1';

const SHOPIFY_STORE = {
    id: STORE_ID,
    userId: 'user_1',
    platform: 'shopify' as const,
    storeDomain: 'demo.myshopify.com',
    storeName: 'Demo Store',
    storeEmail: 'demo@test.com',
    storeCurrency: 'SAR',
    tokenExpiresAt: null,
    productCount: 42,
    productSummary: null,
    policiesSummary: null,
    lastSyncAt: '2026-04-20T10:00:00Z',
    isActive: true,
    installedAt: '2026-01-01T00:00:00Z',
};

const ANALYTICS_PAYLOAD_30D = {
    storeId: STORE_ID,
    period: { from: '2026-03-25T00:00:00Z', to: '2026-04-25T00:00:00Z', range: '30d' },
    notifications: {
        funnel: {
            total: { sent: 0, delivered: 47, failed: 3, pending: 1 },
            // The channel key must be one production can actually produce.
            // WhatsApp is the only rail (D-123), so a fixture keyed `sms` would
            // exercise a shape the API can no longer return.
            byChannel: { whatsapp: { sent: 0, delivered: 47, failed: 3, pending: 1 } },
        },
        byType: {
            abandoned_cart: 12,
            order_confirmed: 18,
            order_shipped: 14,
            order_delivered: 5,
            review_request: 2,
            digital_delivery: 0,
        },
    },
    recovery: { abandonedCartsNotified: 12, cartsRecovered: 4, revenueRecovered: 480, currency: 'SAR' },
    replies: { totalReplies: 100, aiReplies: 87, postReplies: 0, manualReplies: 13 },
};

const ANALYTICS_PAYLOAD_90D = { ...ANALYTICS_PAYLOAD_30D, period: { ...ANALYTICS_PAYLOAD_30D.period, range: '90d' } };

function setupAuth(page: Page, language: 'en' | 'ar' = 'en') {
    return page.addInitScript((lang) => {
        localStorage.setItem(
            'auth-storage',
            JSON.stringify({
                state: {
                    user: { id: 'user_1', email: 'test@test.com', name: 'Test User' },
                    token: 'mock-token',
                    fbToken: 'mock-fb',
                    isAuthenticated: true,
                },
                version: 0,
            }),
        );
        localStorage.setItem(
            'ui-storage',
            JSON.stringify({
                state: { sidebarOpen: true, language: lang, _hasHydrated: false, isOnboardingVisible: false },
                version: 0,
            }),
        );
        localStorage.setItem('jawab24_onboarding_complete', 'true');
    }, language);
}

interface MockOptions {
    shopifyStore?: typeof SHOPIFY_STORE | null;
    analytics?: { '30d'?: typeof ANALYTICS_PAYLOAD_30D | null; '90d'?: typeof ANALYTICS_PAYLOAD_90D | null };
    analyticsStatus?: number; // override for error scenarios
}

function mockAPIs(page: Page, opts: MockOptions = {}) {
    const { shopifyStore = null, analytics, analyticsStatus } = opts;

    return page.route('**/api/**', async (route: Route) => {
        const url = route.request().url();
        const method = route.request().method();

        // Connected-store probes — useConnectedStore hits all three
        if (url.includes('/shopify/store') && method === 'GET' && !url.includes('/sync') && !url.includes('/link-page')) {
            if (shopifyStore) {
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shopifyStore) });
            }
            return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
        }
        if (url.includes('/salla/store') && method === 'GET') {
            return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
        }
        if (url.includes('/zid/store') && method === 'GET') {
            return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
        }

        // Analytics endpoint
        if (url.includes('/api/ecommerce-analytics/') && method === 'GET') {
            if (analyticsStatus && analyticsStatus >= 400) {
                return route.fulfill({
                    status: analyticsStatus,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'analytics down' }),
                });
            }
            const range = new URL(url).searchParams.get('range') as '30d' | '90d' | null;
            const payload = (range && analytics?.[range]) ?? analytics?.['30d'] ?? null;
            if (payload) {
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
            }
            return route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'no fixture' }),
            });
        }

        // Auth / subscription noise
        if (url.includes('/auth/profile')) {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }),
            });
        }
        if (url.includes('/subscription/usage')) {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        subscription: { plan: { name: 'Starter' }, status: 'active' },
                        aiReplies: { used: 5, limit: 100, percentUsed: 5 },
                        pages: { used: 1, limit: 1 },
                    },
                }),
            });
        }

        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
}

test.describe('E-commerce Analytics Page', () => {
    test('shows connect-store prompt when no store is connected', async ({ page }) => {
        await setupAuth(page);
        await mockAPIs(page); // no store

        await page.goto('/en/ecommerce-analytics');

        await expect(
            page.getByRole('heading', { name: t('ecommerceAnalytics.noStore.title') }),
        ).toBeVisible({ timeout: 15000 });
        await expect(page.getByText(t('ecommerceAnalytics.noStore.body'))).toBeVisible();
    });

    test('renders KPIs and section bars on a connected store with data', async ({ page }) => {
        await setupAuth(page);
        await mockAPIs(page, {
            shopifyStore: SHOPIFY_STORE,
            analytics: { '30d': ANALYTICS_PAYLOAD_30D },
        });

        await page.goto('/en/ecommerce-analytics');

        // Page header
        await expect(
            page.getByRole('heading', { name: t('ecommerceAnalytics.title'), exact: false }).first(),
        ).toBeVisible({ timeout: 15000 });

        // KPI grid — revenue with currency, then carts/replies counts
        await expect(page.getByText('480 SAR').first()).toBeVisible();
        await expect(page.getByText(t('ecommerceAnalytics.kpis.revenueRecovered'))).toBeVisible();
        await expect(page.getByText(t('ecommerceAnalytics.kpis.aiReplies'))).toBeVisible();

        // Funnel section + at least one delivered count visible
        await expect(page.getByRole('heading', { name: t('ecommerceAnalytics.funnel.title') })).toBeVisible();
        await expect(page.getByText('47').first()).toBeVisible();

        // Type breakdown (sorted desc — order_confirmed=18 should be first)
        await expect(page.getByRole('heading', { name: t('ecommerceAnalytics.byType.title') })).toBeVisible();
        await expect(page.getByText(t('ecommerceAnalytics.byType.order_confirmed'))).toBeVisible();

        // Replies section
        await expect(page.getByRole('heading', { name: t('ecommerceAnalytics.replies.title') })).toBeVisible();
        await expect(page.getByText('87').first()).toBeVisible();
    });

    test('range toggle re-requests with the new range param', async ({ page }) => {
        await setupAuth(page);
        await mockAPIs(page, {
            shopifyStore: SHOPIFY_STORE,
            analytics: { '30d': ANALYTICS_PAYLOAD_30D, '90d': ANALYTICS_PAYLOAD_90D },
        });

        await page.goto('/en/ecommerce-analytics');
        await expect(page.getByText('480 SAR').first()).toBeVisible({ timeout: 15000 });

        // Wait for the 90d request to fire when the user clicks "Last 90 days"
        const ninetyDayRequest = page.waitForRequest((req) =>
            req.url().includes('/api/ecommerce-analytics/') && req.url().includes('range=90d'),
        );
        await page.getByRole('radio', { name: t('ecommerceAnalytics.ranges.90d') }).click();
        await ninetyDayRequest;

        // The active option should now be 90d
        await expect(page.getByRole('radio', { name: t('ecommerceAnalytics.ranges.90d') })).toHaveAttribute(
            'aria-checked',
            'true',
        );
    });

    test('shows a retryable error when the analytics endpoint fails', async ({ page }) => {
        await setupAuth(page);
        await mockAPIs(page, { shopifyStore: SHOPIFY_STORE, analyticsStatus: 500 });

        await page.goto('/en/ecommerce-analytics');

        await expect(page.getByText(t('ecommerceAnalytics.error'))).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole('button', { name: t('errors.tryAgain') })).toBeVisible();
    });

    test('renders Arabic copy with RTL direction', async ({ page }) => {
        // Store language must match URL locale — _app.tsx bounces the default
        // locale ('ar') to the store language otherwise.
        await setupAuth(page, 'ar');
        await mockAPIs(page, {
            shopifyStore: SHOPIFY_STORE,
            analytics: { '30d': ANALYTICS_PAYLOAD_30D },
        });

        await page.goto('/ar/ecommerce-analytics');

        await expect(
            page.getByRole('heading', { name: tAr('ecommerceAnalytics.title'), exact: false }).first(),
        ).toBeVisible({ timeout: 15000 });
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        // Funnel title in Arabic
        await expect(page.getByRole('heading', { name: tAr('ecommerceAnalytics.funnel.title') })).toBeVisible();
    });
});
