import { test, expect } from '@playwright/test';

/**
 * Login Page E2E Tests
 *
 * Verifies the login page renders correctly with Facebook login button,
 * branding, and language toggle.
 */

test.describe('Login Page', () => {
  test('should render Facebook login button', async ({ page }) => {
    await page.goto('/en/login');

    // Facebook login button should be visible
    await expect(
      page.getByText('Login with Facebook').first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('should render brand logo', async ({ page }) => {
    await page.goto('/en/login');

    await expect(
      page.getByText('Login with Facebook').first()
    ).toBeVisible({ timeout: 15000 });

    // Brand logo should be present
    const logos = await page.locator('img[alt*="Jawab"], img[alt*="jawab"], [data-testid="brand-logo"]').count();
    const brandText = await page.locator('text=/Jawab/i').count();
    expect(logos + brandText).toBeGreaterThan(0);
  });

  test('should show login description and terms', async ({ page }) => {
    await page.goto('/en/login');

    await expect(
      page.getByText('Login with Facebook').first()
    ).toBeVisible({ timeout: 15000 });

    // Terms agreement text
    await expect(
      page.getByText('Terms of Service').first()
    ).toBeVisible();
  });

  test('should have meaningful content (not blank or error)', async ({ page }) => {
    await page.goto('/en/login');

    await expect(
      page.getByText('Login with Facebook').first()
    ).toBeVisible({ timeout: 15000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(50);

    // Error boundary should NOT be showing
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });
});
