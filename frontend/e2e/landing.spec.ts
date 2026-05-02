import { test, expect } from '@playwright/test';
import enLanding from '../src/i18n/en/landing.json';

/**
 * Landing Page E2E Tests
 *
 * Verifies the public landing page renders correctly with hero section,
 * features, FAQ, and navigation elements.
 */

const HERO_TITLE2 = enLanding.hero.title2;
const HERO_CTA = enLanding.hero.cta1;

test.describe('Landing Page', () => {
  test('should render hero section with heading and CTA', async ({ page }) => {
    await page.goto('/en');

    await expect(
      page.locator(`text=${HERO_TITLE2}`).first()
    ).toBeVisible({ timeout: 15000 });

    await expect(
      page.getByText(HERO_CTA).first()
    ).toBeVisible();
  });

  test('should render features section', async ({ page }) => {
    await page.goto('/en');

    await expect(
      page.locator(`text=${HERO_TITLE2}`).first()
    ).toBeVisible({ timeout: 15000 });

    await expect(
      page.getByText('Everything You Need to Manage Your Pages').first()
    ).toBeVisible();
  });

  test('should render FAQ section', async ({ page }) => {
    await page.goto('/en');

    await expect(
      page.locator(`text=${enLanding.faq.title}`).first()
    ).toBeVisible({ timeout: 15000 });

    await expect(
      page.getByText(enLanding.faq.q1).first()
    ).toBeVisible();
  });

  test('should have navigation with login link', async ({ page }) => {
    await page.goto('/en');

    await expect(
      page.locator(`text=${HERO_TITLE2}`).first()
    ).toBeVisible({ timeout: 15000 });

    const loginLink = page.getByText('Login').first();
    await expect(loginLink).toBeVisible();
  });

  test('should have meaningful text content (not just images)', async ({ page }) => {
    await page.goto('/en');

    await expect(
      page.locator(`text=${HERO_TITLE2}`).first()
    ).toBeVisible({ timeout: 15000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(100);
  });
});
