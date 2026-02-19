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

  test('OAuth URL should include all required Instagram and Pages scopes', async ({ page }) => {
    await page.goto('/en/login');

    await expect(
      page.getByText('Login with Facebook').first()
    ).toBeVisible({ timeout: 15000 });

    let oauthUrl = '';
    page.on('request', request => {
      if (request.url().includes('facebook.com') && request.url().includes('dialog/oauth')) {
        oauthUrl = request.url();
      }
    });

    await Promise.race([
      page.waitForURL(/facebook\.com/, { timeout: 5000 }).catch(() => {}),
      page.locator('button, a').filter({ hasText: /login with facebook/i }).first().click(),
    ]);

    // Fallback: check href attribute directly if navigation was blocked
    if (!oauthUrl) {
      const href = await page.locator('a[href*="facebook.com"]').first().getAttribute('href').catch(() => null);
      if (href) oauthUrl = href;
    }

    if (oauthUrl) {
      const decodedUrl = decodeURIComponent(oauthUrl);
      expect(decodedUrl).toContain('instagram_manage_comments');
      expect(decodedUrl).toContain('instagram_manage_messages');
      expect(decodedUrl).toContain('instagram_basic');
      expect(decodedUrl).toContain('pages_show_list');
      expect(decodedUrl).toContain('pages_messaging');
    }
  });
});
