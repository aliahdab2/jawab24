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

test.describe('Checkout Page', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));

    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: {
            user: { id: 'u1', email: 'test@test.com', name: 'Test User' },
            token: 'mock-token',
            isAuthenticated: true,
          },
          version: 0,
        })
      );
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { language: 'en', _hasHydrated: false }, version: 0 })
      );
    });

    // Block external geo check services — treat user as non-sanctioned
    await page.route('**/ipapi.co/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country_code: 'US' }) });
    });
    await page.route('**/ipinfo.io/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'US' }) });
    });

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/geo/check')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ sanctioned: false, country: 'US' }),
        });
      }
      if (url.match(/\/plans\/[^/]+$/)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: MOCK_PLAN }),
        });
      }
      if (url.includes('/create-subscription-intent')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ clientSecret: 'pi_3MtwBwLkdIwHu7ix_secret_YrKJUKribcBjcG8HVhfZluoGH', type: 'payment', subscriptionId: 'sub_test_123' }),
        });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test User' }),
        });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
  });

  test('should render plan name and price', async ({ page }) => {
    // Use desktop viewport so the full order summary sidebar is visible
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/checkout?planId=starter');

    await expect(page.locator('h2').filter({ hasText: /Starter/i }).first()).toBeVisible({ timeout: 15000 });
    // Target the desktop sidebar price (inside the always-visible lg:block container)
    await expect(page.locator('.font-display >> text=/\\$19/').first()).toBeVisible({ timeout: 10000 });
  });

  test('should show plan features', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/checkout?planId=starter');

    await expect(page.locator('h2').filter({ hasText: /Starter/i }).first()).toBeVisible({ timeout: 15000 });
    // Features are inside the desktop sidebar (visible at 1280px)
    const sidebar = page.locator('[class*="lg\\:sticky"]');
    await expect(sidebar.locator('text=/3/i').first()).toBeVisible({ timeout: 10000 });
    await expect(sidebar.locator('text=/500/').first()).toBeVisible({ timeout: 10000 });
  });

  test('should show trial days when plan has a trial', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/checkout?planId=starter');

    await expect(page.locator('h2').filter({ hasText: /Starter/i }).first()).toBeVisible({ timeout: 15000 });
    // "7 day free trial" text — in the desktop sidebar
    const sidebar = page.locator('[class*="lg\\:sticky"]');
    await expect(sidebar.locator('text=/7/').first()).toBeVisible({ timeout: 10000 });
  });

  test('should show "Back to Pricing" link', async ({ page }) => {
    await page.goto('/en/checkout?planId=starter');

    // Back to pricing link is in the header — visible on all viewports
    await expect(page.locator('a[href*="/pricing"]').first()).toBeVisible({ timeout: 15000 });
  });

  test('should show plan summary in collapsed header on mobile', async ({ page }) => {
    // Set mobile viewport so the collapsible summary button is visible (lg:hidden = hidden above 1024px)
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/checkout?planId=starter');

    // On mobile, the collapsed summary button shows plan name and price inline
    const mobileSummary = page.locator('button[aria-expanded]');
    await expect(mobileSummary.filter({ hasText: /Starter/i })).toBeVisible({ timeout: 15000 });
    await expect(mobileSummary.filter({ hasText: /\$19/ })).toBeVisible({ timeout: 10000 });
  });

  test('should show error message when plan fetch fails', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/geo/check')) {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ sanctioned: false, country: 'US' }),
        });
      }
      if (url.match(/\/plans\/[^/]+$/)) {
        return route.fulfill({ status: 500, body: 'Error' });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'u1', email: 'test@test.com', name: 'Test User' }),
        });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/checkout?planId=starter');

    // Should show an error, not crash
    await page.waitForTimeout(4000);
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('[class*="alert-error"]').first()).toBeVisible({ timeout: 15000 });
  });

  test('should not crash without planId param', async ({ page }) => {
    await page.goto('/en/checkout');

    await page.waitForTimeout(3000);
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  test('does not retry the payment intent in a loop when it errors', async ({ page }) => {
    // Regression guard for the runaway retry loop: a non-geo/non-email intent
    // failure used to re-fire the auto-create effect on every render (its
    // callback identity changed each render), hammering the endpoint with no
    // backoff. We count hits on the intent endpoint and assert exactly one.
    //
    // Geo + plan are re-stubbed here with base-URL-agnostic globs so the test
    // holds whether the API is same-origin (/api) or an absolute host. These
    // are registered after the beforeEach catch-all, so they take precedence.
    await page.route('**/geo/check', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sanctioned: false, country: 'US' }) })
    );
    await page.route('**/plans/*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_PLAN }) })
    );

    let intentCalls = 0;
    await page.route('**/payment/create-subscription-intent', async (route) => {
      intentCalls += 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary server error' }),
      });
    });

    await page.goto('/en/checkout?planId=starter');

    // One attempt completes and surfaces the error banner.
    await expect(page.locator('[class*="alert-error"]').first()).toBeVisible({ timeout: 15000 });

    // Give any runaway retry loop several seconds to manifest.
    await page.waitForTimeout(4000);

    expect(intentCalls).toBe(1);
  });
});

test.describe('Checkout Page - unauthenticated user', () => {
  test('should show login prompt for unauthenticated users', async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));

    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: null, token: null, isAuthenticated: false },
          version: 0,
        })
      );
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { language: 'en', _hasHydrated: false }, version: 0 })
      );
    });

    await page.route('**/ipapi.co/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country_code: 'US' }) });
    });
    await page.route('**/ipinfo.io/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'US' }) });
    });
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/geo/check')) {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ sanctioned: false, country: 'US' }),
        });
      }
      if (url.match(/\/plans\/[^/]+$/)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: MOCK_PLAN }),
        });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/checkout?planId=starter');

    // Should show login prompt instead of checkout form
    await expect(
      page.locator('text=/Log in to complete your subscription/i').first()
    ).toBeVisible({ timeout: 15000 });

    // Click login button should redirect to login
    const loginBtn = page.locator('button').filter({ hasText: /Log In/i }).first();
    await expect(loginBtn).toBeVisible({ timeout: 10000 });
    await loginBtn.click();

    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});
