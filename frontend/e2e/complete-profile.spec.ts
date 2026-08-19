import { test, expect } from '@playwright/test';

/**
 * Complete Profile Page E2E Tests
 */

test.describe('Complete Profile Page', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));

    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: {
            user: { id: 'u1', email: '', name: 'Test User' },
            token: 'mock-token',
            fbToken: 'mock-fb',
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

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/profile') && route.request().method() === 'PATCH') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'u1', email: 'new@test.com', name: 'Test User' }),
        });
      }
      if (url.includes('/auth/profile')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'u1', email: '', name: 'Test User' }),
        });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
  });

  test('should render email form for user without email', async ({ page }) => {
    await page.goto('/en/complete-profile');

    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('input#email')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button[type="submit"]')).toBeVisible({ timeout: 10000 });
  });

  test('should show trust indicators (privacy, encrypted)', async ({ page }) => {
    await page.goto('/en/complete-profile');

    await expect(page.locator('input#email')).toBeVisible({ timeout: 15000 });

    await expect(page.locator('text=/Encrypted/i').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=/Never shared/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('should disable submit button when email field is empty', async ({ page }) => {
    await page.goto('/en/complete-profile');

    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible({ timeout: 15000 });
    await expect(submitBtn).toBeDisabled();
  });

  test('should enable submit button with valid email', async ({ page }) => {
    await page.goto('/en/complete-profile');

    await expect(page.locator('input#email')).toBeVisible({ timeout: 15000 });
    await page.locator('input#email').fill('valid@example.com');

    await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 5000 });
  });

  test('should show validation error for invalid email on blur', async ({ page }) => {
    await page.goto('/en/complete-profile');

    await expect(page.locator('input#email')).toBeVisible({ timeout: 15000 });
    await page.locator('input#email').fill('not-an-email');
    await page.locator('input#email').blur();

    await expect(page.locator('#email-error')).toBeVisible({ timeout: 5000 });
  });

  test('should show success state after valid submission', async ({ page }) => {
    await page.goto('/en/complete-profile');

    await expect(page.locator('input#email')).toBeVisible({ timeout: 15000 });
    await page.locator('input#email').fill('new@example.com');
    await page.locator('button[type="submit"]').click();

    // Success state shows a green checkmark icon
    await expect(page.locator('.animate-bounce-in, [class*="green-100"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('should not crash when API fails on submit', async ({ page }) => {
    // Override PATCH to fail
    await page.route('**/api/auth/profile**', async (route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({ status: 500, body: 'Server Error' });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'u1', email: '', name: 'Test User' }),
      });
    });

    await page.goto('/en/complete-profile');

    await expect(page.locator('input#email')).toBeVisible({ timeout: 15000 });
    await page.locator('input#email').fill('test@example.com');
    await page.locator('button[type="submit"]').click();

    // Should show error alert, not crash
    await expect(page.locator('text=Something went wrong')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 10000 });
  });

  /**
   * Empty `dir="auto"` field must not fall back to LTR in the Arabic UI.
   *
   * `dir=auto` resolves from the element's VALUE, never its placeholder, so an
   * empty box computes `direction: ltr` however the page is laid out — caret and
   * placeholder pinned to the LEFT edge under `<html dir="rtl">`. Reported
   * 2026-08-19 against the «اختبار الرد الذكي» composer; this input has the same
   * bare `dir="auto"` and is the one reachable without a connected page.
   *
   * Why E2E and not a unit test: the fix is an author rule overriding the `dir`
   * attribute's PRESENTATIONAL HINT, and the restore-on-typing behaviour is the
   * browser re-running auto-detection. Neither is provable from CSS text or in
   * jsdom (which does not implement `:placeholder-shown` or bidi resolution).
   * The source side is pinned by src/__tests__/styles/autoDirEmptyInput.test.ts.
   */
  test('empty dir="auto" input follows the RTL UI, and typing restores auto-detection', async ({ page }) => {
    // The suite's beforeEach pins the language store to 'en', and _app.tsx
    // redirects a default-locale URL to /en when the store disagrees. Override
    // it so the Arabic route sticks; init scripts run in registration order.
    await page.addInitScript(() => {
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { language: 'ar', _hasHydrated: false }, version: 0 }),
      );
    });

    // Default locale is `ar` — no URL prefix — so <html dir="rtl">.
    await page.goto('/complete-profile');

    const email = page.locator('input#email');
    await expect(email).toBeVisible({ timeout: 15000 });

    // Guard the measurement setup: if the page is not actually RTL this test
    // would pass for the wrong reason.
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(email).toHaveAttribute('dir', 'auto');

    const direction = () => email.evaluate((el) => getComputedStyle(el).direction);

    // Empty → inherits the RTL UI (was 'ltr' before the globals.css rule).
    await expect.poll(direction).toBe('rtl');

    // Typing Latin → `:placeholder-shown` stops matching, dir=auto takes over.
    await email.fill('name@example.com');
    await expect.poll(direction).toBe('ltr');

    // Typing Arabic → auto-detection resolves RTL from the value itself.
    await email.fill('مرحبا');
    await expect.poll(direction).toBe('rtl');

    // Cleared → back to the inherited UI direction, not LTR.
    await email.fill('');
    await expect.poll(direction).toBe('rtl');
  });
});

test.describe('Complete Profile Page - redirect when email exists', () => {
  test('should redirect to dashboard when user already has email', async ({ page }) => {
    page.on('pageerror', (err) => console.log(`PAGE ERROR: ${err}`));

    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: {
            user: { id: 'u1', email: 'existing@test.com', name: 'Test User' },
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

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/profile')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'u1', email: 'existing@test.com', name: 'Test User' }),
        });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/complete-profile');

    // Should redirect away from complete-profile
    await expect(page).not.toHaveURL(/\/complete-profile/, { timeout: 10000 });
  });
});
