import { test, expect } from '@playwright/test';

/**
 * Top-up (card) E2E — the `/checkout?topup=5k` flow + the kill-switch.
 *
 * Route-mocked (no real Stripe), mirroring payment-flow.spec.ts. Covers the
 * top-up-specific behavior the subscription e2e don't: the public topup/config
 * fetch, create-topup-intent, the TOPUP_ENABLED kill-switch graceful state, and
 * the unauthenticated login gate. Strings match the en checkout/topup namespaces.
 */

const TOPUP_CONFIG = {
  enabled: true,
  packs: {
    '5k': { repliesAdded: 5000, priceCents: 4900 },
    '10k': { repliesAdded: 10000, priceCents: 7900 },
  },
  currency: 'usd',
  whatsappNumber: '',
};

function authed() {
  return (page: import('@playwright/test').Page) =>
    page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({ state: { user: { id: 'u1', email: 'test@test.com', name: 'Test User' }, token: 'mock-token', isAuthenticated: true }, version: 0 })
      );
      localStorage.setItem('ui-storage', JSON.stringify({ state: { language: 'en', _hasHydrated: false }, version: 0 }));
    });
}

// Mock geo (non-sanctioned), topup config, and create-topup-intent. `overrides`
// lets a test tweak the config (e.g. enabled:false) and count intent calls.
function mockApi(page: import('@playwright/test').Page, opts: { config?: Partial<typeof TOPUP_CONFIG>; onIntent?: () => void; intentStatus?: number; intentBody?: unknown } = {}) {
  const cfg = { ...TOPUP_CONFIG, ...opts.config };
  return Promise.all([
    page.route('**/ipapi.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country_code: 'US' }) })),
    page.route('**/ipinfo.io/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'US' }) })),
    page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/geo/check')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sanctioned: false, country: 'US' }) });
      }
      if (url.includes('/subscription/topup/config')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: cfg }) });
      }
      if (url.includes('/payment/create-topup-intent')) {
        opts.onIntent?.();
        return route.fulfill({
          status: opts.intentStatus ?? 200,
          contentType: 'application/json',
          body: JSON.stringify(opts.intentBody ?? { clientSecret: 'pi_3MtwBwLkdIwHu7ix_secret_YrKJUKribcBjcG8HVhfZluoGH', type: 'payment' }),
        });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test User' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }),
  ]);
}

test.describe('Top-up checkout (?topup=5k)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
    await authed()(page);
  });

  test('renders the top-up summary (pack name + $49) and creates a top-up intent', async ({ page }) => {
    let intentCalls = 0;
    await mockApi(page, { onIntent: () => { intentCalls += 1; } });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/checkout?topup=5k');

    // "Credit top-up" summary title (checkout.topupSummaryTitle) + the $49 price
    await expect(page.locator('text=/Credit top-up/i').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.font-display >> text=/\\$49/').first()).toBeVisible({ timeout: 10000 });

    // create-topup-intent is called with the pack
    await expect.poll(() => intentCalls, { timeout: 5000 }).toBe(1);
  });

  test('does not retry create-topup-intent in a loop on error', async ({ page }) => {
    let intentCalls = 0;
    await mockApi(page, { onIntent: () => { intentCalls += 1; }, intentStatus: 500, intentBody: { error: 'Temporary server error' } });
    await page.goto('/en/checkout?topup=5k');

    await expect(page.locator('[class*="alert-error"]').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(4000); // give any runaway loop time to manifest
    expect(intentCalls).toBe(1);
  });

  test('kill-switch (config enabled:false) shows unavailable and creates NO intent', async ({ page }) => {
    let intentCalls = 0;
    await mockApi(page, { config: { enabled: false }, onIntent: () => { intentCalls += 1; } });
    await page.goto('/en/checkout?topup=5k');

    await expect(page.locator('text=/temporarily unavailable/i').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);
    expect(intentCalls).toBe(0);
  });

  test('kill-switch (endpoint 403 TOPUP_DISABLED) shows the unavailable message', async ({ page }) => {
    // Config says enabled, but the endpoint rejects (flag flipped after load / stale link).
    await mockApi(page, { intentStatus: 403, intentBody: { error: 'Top-ups are temporarily unavailable', code: 'TOPUP_DISABLED' } });
    await page.goto('/en/checkout?topup=5k');

    await expect(page.locator('text=/temporarily unavailable/i').first()).toBeVisible({ timeout: 15000 });
  });

  test('sanctioned geo blocks the top-up before any intent call', async ({ page }) => {
    let intentCalls = 0;
    await page.route('**/ipapi.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country_code: 'IR' }) }));
    await page.route('**/ipinfo.io/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'IR' }) }));
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/geo/check')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sanctioned: true, country: 'IR' }) });
      if (url.includes('/subscription/topup/config')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: TOPUP_CONFIG }) });
      if (url.includes('/payment/create-topup-intent')) { intentCalls += 1; return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/checkout?topup=5k');
    // Real PaymentsUnavailableNotice (payment.unavailable.title); the money-safety
    // guarantee is that NO PaymentIntent is created for a sanctioned region.
    await expect(page.locator('text=/Payments are not available in your region/i').first()).toBeVisible({ timeout: 15000 });
    expect(intentCalls).toBe(0);
  });
});

test.describe('Top-up checkout — unauthenticated', () => {
  test('shows the top-up login gate, not an error, and makes no intent call', async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));
    await page.addInitScript(() => {
      localStorage.setItem('auth-storage', JSON.stringify({ state: { user: null, token: null, isAuthenticated: false }, version: 0 }));
      localStorage.setItem('ui-storage', JSON.stringify({ state: { language: 'en', _hasHydrated: false }, version: 0 }));
    });
    let intentCalls = 0;
    await mockApi(page, { onIntent: () => { intentCalls += 1; } });

    await page.goto('/en/checkout?topup=5k');

    // checkout.loginToTopup = "Log in to add replies"
    await expect(page.locator('text=/Log in to add replies/i').first()).toBeVisible({ timeout: 15000 });
    expect(intentCalls).toBe(0);
  });
});
