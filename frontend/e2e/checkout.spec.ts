import { test, expect } from '@playwright/test';

/**
 * Checkout Page E2E Tests
 */

const MOCK_PLAN = {
  id: 'starter',
  name: 'Starter',
  slug: 'starter',
  price: 1900,
  trialDays: 7,
  maxPages: 3,
  maxAiRepliesPerMonth: 500,
  description: 'For small projects',
  isActive: true,
};

function setupAuthAndMocks(page: any, { authenticated = true, sanctioned = false, planOverride = null as any } = {}) {
  page.on('pageerror', (err: Error) => console.log(`PAGE ERROR: ${err}`));

  page.addInitScript(({ authenticated }: { authenticated: boolean }) => {
    if (authenticated) {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: { id: 'u1', email: 'test@test.com', name: 'Test User' }, token: 'mock-token', isAuthenticated: true },
          version: 0,
        })
      );
    }
    localStorage.setItem(
      'ui-storage',
      JSON.stringify({ state: { language: 'en', _hasHydrated: true }, version: 0 })
    );
  }, { authenticated });

  // Block external geo check services to control sanctioned state
  page.route('**/ipapi.co/**', async (route: any) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country_code: sanctioned ? 'IR' : 'US' }) });
  });
  page.route('**/ipinfo.io/**', async (route: any) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: sanctioned ? 'IR' : 'US' }) });
  });

  page.route('**/api/**', async (route: any) => {
    const url = route.request().url();
    if (url.match(/\/plans\/[^/]+$/)) {
      const plan = planOverride || MOCK_PLAN;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: plan }) });
    }
    if (url.includes('/auth/profile')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test User' }) });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test.describe('Checkout Page', () => {
  test('should render plan details correctly', async ({ page }) => {
    setupAuthAndMocks(page);
    await page.goto('/en/checkout?planId=starter');

    // Plan name should be visible
    await expect(page.locator('h2').filter({ hasText: /Starter/i }).first()).toBeVisible({ timeout: 15000 });

    // Price should be visible ($19)
    await expect(page.locator('text=/\\$19/').first()).toBeVisible({ timeout: 10000 });

    // Features should be listed
    await expect(page.locator('text=/3 Pages/i').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=/500/').first()).toBeVisible({ timeout: 10000 });
  });

  test('should show trial days in features when plan has trial', async ({ page }) => {
    setupAuthAndMocks(page);
    await page.goto('/en/checkout?planId=starter');

    await expect(page.locator('h2').filter({ hasText: /Starter/i }).first()).toBeVisible({ timeout: 15000 });

    // Trial days should be shown
    await expect(page.locator('text=/7/').first()).toBeVisible({ timeout: 10000 });
  });

  test('should show "Back to Pricing" link', async ({ page }) => {
    setupAuthAndMocks(page);
    await page.goto('/en/checkout?planId=starter');

    await expect(page.locator('a[href="/pricing"], a[href*="/pricing"]').first()).toBeVisible({ timeout: 15000 });
  });

  test('should show "Continue to Payment" button', async ({ page }) => {
    setupAuthAndMocks(page);
    await page.goto('/en/checkout?planId=starter');

    await expect(
      page.locator('button').filter({ hasText: /Continue to Payment/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('should redirect unauthenticated user to login on button click', async ({ page }) => {
    setupAuthAndMocks(page, { authenticated: false });
    await page.goto('/en/checkout?planId=starter');

    const continueBtn = page.locator('button').filter({ hasText: /Continue to Payment/i }).first();
    await expect(continueBtn).toBeVisible({ timeout: 15000 });
    await continueBtn.click();

    // Should redirect to login with redirect param
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('should show error message when plan fetch fails', async ({ page }) => {
    page.on('pageerror', (err: Error) => console.log(`PAGE ERROR: ${err}`));
    page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: { id: 'u1', email: 'test@test.com', name: 'Test User' }, token: 'mock-token', isAuthenticated: true },
          version: 0,
        })
      );
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { language: 'en', _hasHydrated: true }, version: 0 })
      );
    });

    page.route('**/ipapi.co/**', async (route: any) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country_code: 'US' }) });
    });
    page.route('**/ipinfo.io/**', async (route: any) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'US' }) });
    });
    page.route('**/api/**', async (route: any) => {
      const url = route.request().url();
      if (url.match(/\/plans\/[^/]+$/)) {
        return route.fulfill({ status: 500, body: 'Error' });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test User' }) });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/checkout?planId=starter');

    // Should show an error message, not crash
    await expect(page.locator('text=Something went wrong')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('[class*="red"], [class*="error"]').first()).toBeVisible({ timeout: 15000 });
  });

  test('should not crash without planId param', async ({ page }) => {
    setupAuthAndMocks(page);
    await page.goto('/en/checkout');

    // Page should render (loading state) without crashing
    await page.waitForTimeout(3000);
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });
});
