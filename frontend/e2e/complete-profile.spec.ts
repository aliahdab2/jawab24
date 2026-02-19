import { test, expect } from '@playwright/test';

/**
 * Complete Profile Page E2E Tests
 */

function setupAuth(page: any, { hasEmail = false } = {}) {
  page.on('pageerror', (err: Error) => console.log(`PAGE ERROR: ${err}`));

  page.addInitScript(({ hasEmail }: { hasEmail: boolean }) => {
    localStorage.setItem(
      'auth-storage',
      JSON.stringify({
        state: {
          user: { id: 'u1', email: hasEmail ? 'existing@test.com' : '', name: 'Test User' },
          token: 'mock-token',
          isAuthenticated: true,
          _hasHydrated: true,
        },
        version: 0,
      })
    );
    localStorage.setItem(
      'ui-storage',
      JSON.stringify({ state: { language: 'en', _hasHydrated: true }, version: 0 })
    );
  }, { hasEmail });

  page.route('**/api/**', async (route: any) => {
    const url = route.request().url();
    if (url.includes('/auth/profile') && route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'u1', email: hasEmail ? 'existing@test.com' : '', name: 'Test User' }),
      });
    }
    if (url.includes('/auth/profile') && route.request().method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'u1', email: 'new@test.com', name: 'Test User' }),
      });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test.describe('Complete Profile Page', () => {
  test('should render email form for user without email', async ({ page }) => {
    setupAuth(page, { hasEmail: false });
    await page.goto('/en/complete-profile');

    // Title should be visible
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });

    // Email input should be present
    await expect(page.locator('input[type="email"], input#email')).toBeVisible({ timeout: 10000 });

    // Submit button should be present
    await expect(page.locator('button[type="submit"]')).toBeVisible({ timeout: 10000 });
  });

  test('should show trust indicators (privacy, encrypted)', async ({ page }) => {
    setupAuth(page, { hasEmail: false });
    await page.goto('/en/complete-profile');

    await expect(page.locator('input[type="email"], input#email')).toBeVisible({ timeout: 15000 });

    // Trust indicators should be visible
    await expect(page.locator('text=/Encrypted/i').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=/Never shared/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('should disable submit button when email field is empty', async ({ page }) => {
    setupAuth(page, { hasEmail: false });
    await page.goto('/en/complete-profile');

    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible({ timeout: 15000 });

    // Button should be disabled with empty email
    await expect(submitBtn).toBeDisabled();
  });

  test('should enable submit button with valid email', async ({ page }) => {
    setupAuth(page, { hasEmail: false });
    await page.goto('/en/complete-profile');

    const emailInput = page.locator('input[type="email"], input#email');
    await expect(emailInput).toBeVisible({ timeout: 15000 });

    await emailInput.fill('valid@example.com');

    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
  });

  test('should show validation error for invalid email on blur', async ({ page }) => {
    setupAuth(page, { hasEmail: false });
    await page.goto('/en/complete-profile');

    const emailInput = page.locator('input[type="email"], input#email');
    await expect(emailInput).toBeVisible({ timeout: 15000 });

    await emailInput.fill('not-an-email');
    await emailInput.blur();

    // Validation error should appear
    await expect(page.locator('[role="alert"], [id="email-error"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('should show success state after valid submission', async ({ page }) => {
    setupAuth(page, { hasEmail: false });
    await page.goto('/en/complete-profile');

    const emailInput = page.locator('input[type="email"], input#email');
    await expect(emailInput).toBeVisible({ timeout: 15000 });

    await emailInput.fill('new@example.com');
    await page.locator('button[type="submit"]').click();

    // Success state should appear (green checkmark / success message)
    await expect(page.locator('[class*="green"], [class*="success"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('should redirect to dashboard when user already has email', async ({ page }) => {
    setupAuth(page, { hasEmail: true });
    await page.goto('/en/complete-profile');

    // Should redirect away from complete-profile
    await expect(page).not.toHaveURL(/\/complete-profile/, { timeout: 10000 });
  });

  test('should not crash when API fails on submit', async ({ page }) => {
    page.on('pageerror', (err: Error) => console.log(`PAGE ERROR: ${err}`));

    page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: { id: 'u1', email: '', name: 'Test User' }, token: 'mock-token', isAuthenticated: true, _hasHydrated: true },
          version: 0,
        })
      );
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { language: 'en', _hasHydrated: true }, version: 0 })
      );
    });

    page.route('**/api/**', async (route: any) => {
      const url = route.request().url();
      if (url.includes('/auth/profile') && route.request().method() === 'PATCH') {
        return route.fulfill({ status: 500, body: 'Server Error' });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/complete-profile');

    const emailInput = page.locator('input[type="email"], input#email');
    await expect(emailInput).toBeVisible({ timeout: 15000 });

    await emailInput.fill('test@example.com');
    await page.locator('button[type="submit"]').click();

    // Should show error, not crash
    await expect(page.locator('text=Something went wrong')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 10000 });
  });
});
