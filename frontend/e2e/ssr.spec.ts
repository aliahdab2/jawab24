import { test, expect } from '@playwright/test';
import enLanding from '../src/i18n/en/landing.json';
import enPricing from '../src/i18n/en/pricing.json';
import enAuth from '../src/i18n/en/auth.json';

/**
 * SSR Content Tests — JavaScript Disabled
 *
 * These tests verify that public pages render meaningful HTML on the server,
 * without relying on client-side JavaScript. This is critical for:
 * - Google indexing (Googlebot may not execute JS)
 * - AI tools (ChatGPT, Perplexity, Gemini) that read raw HTML
 * - Social link previews (Open Graph)
 * - Accessibility (screen readers on slow connections)
 *
 * If these tests fail, it means a hydration guard or client-only gate
 * was added to _app.tsx or a public layout — see AI_INSTRUCTIONS.md rule #14.
 */
test.describe('SSR — public pages render without JavaScript', () => {
  // Disable JavaScript for all tests in this describe block
  test.use({ javaScriptEnabled: false });

  test('landing page renders hero heading and meta', async ({ page }) => {
    await page.goto('/en/landing');

    // The h1 must be in the server HTML
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible({ timeout: 5000 });

    // Meta description must be present and non-empty
    const metaDesc = page.locator('meta[name="description"]');
    await expect(metaDesc).toHaveAttribute('content', /.{20,}/);

    // Page title must be present for SEO
    const title = await page.title();
    expect(title.length).toBeGreaterThan(5);
  });

  test('pricing page renders plan names from server HTML', async ({ page }) => {
    await page.goto('/en/pricing');

    // h1 must be visible without JS
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible({ timeout: 5000 });

    // Plan names from translation file must be in server HTML
    const body = page.locator('body');
    await expect(body).toContainText(enPricing.starter);
    await expect(body).toContainText(enPricing.business);

    // Meta description for SEO
    const metaDesc = page.locator('meta[name="description"]');
    await expect(metaDesc).toHaveAttribute('content', /.{20,}/);
  });

  test('login page renders heading and auth content', async ({ page }) => {
    await page.goto('/en/login');

    // Must see the login heading
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible({ timeout: 5000 });

    // Auth-related text must be in server HTML
    const body = page.locator('body');
    await expect(body).toContainText(enAuth.login);
  });

  test('blog page renders article titles', async ({ page }) => {
    await page.goto('/en/blog');

    const h1 = page.locator('h1');
    await expect(h1).toBeVisible({ timeout: 5000 });

    // At least one article link should be present
    const articles = page.locator('h2');
    await expect(articles.first()).toBeVisible();
  });

  test('what-is page renders FAQ content', async ({ page }) => {
    await page.goto('/en/what-is-jawab24');

    const h1 = page.locator('h1');
    await expect(h1).toBeVisible({ timeout: 5000 });

    // FAQ section should have multiple h2 headings
    const h2s = page.locator('h2');
    expect(await h2s.count()).toBeGreaterThan(1);
  });

  test('dashboard does NOT leak auth content in server HTML', async ({ page }) => {
    await page.goto('/en/dashboard');

    // Dashboard h1 should NOT be visible (DashboardLayout blocks non-public, non-hydrated)
    const headings = page.locator('h1, h2, h3');
    const count = await headings.count();

    // Server HTML for dashboard should have no meaningful headings
    // (only the AppSkeleton or empty layout is rendered)
    for (let i = 0; i < count; i++) {
      const text = await headings.nth(i).textContent();
      // These are dashboard-specific terms that must NOT appear in server HTML
      expect(text).not.toContain('Dashboard');
      expect(text).not.toContain('Comments');
      expect(text).not.toContain('Messages');
    }
  });

  test('settings does NOT leak auth content in server HTML', async ({ page }) => {
    await page.goto('/en/settings');

    const headings = page.locator('h1, h2, h3');
    const count = await headings.count();

    for (let i = 0; i < count; i++) {
      const text = await headings.nth(i).textContent();
      expect(text).not.toContain('Settings');
      expect(text).not.toContain('Business Hours');
    }
  });

  test('Arabic pages render with dir="rtl"', async ({ page }) => {
    // Use /landing (not /) because / is a client-side redirect page
    await page.goto('/landing');

    // Arabic h1 must be visible
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible({ timeout: 5000 });

    // html tag should have dir="rtl" for Arabic default locale
    const htmlDir = await page.locator('html').getAttribute('dir');
    expect(htmlDir).toBe('rtl');
  });

  test('Arabic pricing page renders plan cards', async ({ page }) => {
    await page.goto('/pricing');

    const h1 = page.locator('h1');
    await expect(h1).toBeVisible({ timeout: 5000 });

    // Should have multiple plan heading cards (h3)
    const h3s = page.locator('h3');
    expect(await h3s.count()).toBeGreaterThanOrEqual(3);
  });
});
