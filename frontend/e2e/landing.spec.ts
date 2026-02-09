import { test, expect } from '@playwright/test';

/**
 * Landing Page E2E Tests
 *
 * Verifies the public landing page renders correctly with hero section,
 * features, FAQ, and navigation elements.
 */

test.describe('Landing Page', () => {
  test('should render hero section with heading and CTA', async ({ page }) => {
    await page.goto('/en');

    // Hero heading should be visible
    await expect(
      page.locator('text=Smart 24/7 Sales Machine').first()
    ).toBeVisible({ timeout: 15000 });

    // CTA button should be visible
    await expect(
      page.getByText('Start Your Free Trial').first()
    ).toBeVisible();
  });

  test('should render features section', async ({ page }) => {
    await page.goto('/en');

    // Wait for page to load
    await expect(
      page.locator('text=Smart 24/7 Sales Machine').first()
    ).toBeVisible({ timeout: 15000 });

    // Features section title
    await expect(
      page.getByText('Everything You Need to Manage Your Pages').first()
    ).toBeVisible();
  });

  test('should render FAQ section', async ({ page }) => {
    await page.goto('/en');

    await expect(
      page.locator('text=Frequently Asked Questions').first()
    ).toBeVisible({ timeout: 15000 });

    // At least one FAQ question should be visible
    await expect(
      page.getByText('Does Jawab24 support Instagram?').first()
    ).toBeVisible();
  });

  test('should have navigation with login link', async ({ page }) => {
    await page.goto('/en');

    await expect(
      page.locator('text=Smart 24/7 Sales Machine').first()
    ).toBeVisible({ timeout: 15000 });

    // Navigation should have login link
    const loginLink = page.getByText('Login').first();
    await expect(loginLink).toBeVisible();
  });

  test('should have meaningful text content (not just images)', async ({ page }) => {
    await page.goto('/en');

    await expect(
      page.locator('text=Smart 24/7 Sales Machine').first()
    ).toBeVisible({ timeout: 15000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(100);
  });
});
