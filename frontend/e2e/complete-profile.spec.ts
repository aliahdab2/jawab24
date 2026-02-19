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
