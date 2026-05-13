import { test, expect } from '@playwright/test';

const COMPETITORS = ['manychat', 'tidio', 'chatfuel', 'botpress', 'speedly'];
const LOCALES = ['en', 'ar'] as const;

test.describe('Compare pages', () => {
  for (const locale of LOCALES) {
    for (const slug of COMPETITORS) {
      test(`/${locale}/compare/${slug} renders with feature table, advantages, FAQ`, async ({ page }) => {
        const response = await page.goto(`/${locale}/compare/${slug}`);
        expect(response?.status()).toBe(200);

        await expect(page.locator('h1')).toContainText(/Jawab24/i);

        const tableRows = page.locator('table tbody tr');
        await expect(tableRows.first()).toBeVisible();
        expect(await tableRows.count()).toBeGreaterThanOrEqual(9);

        await expect(page.locator('h2').filter({ hasText: /Frequently Asked Questions|الأسئلة الشائعة/ })).toBeVisible();

        const ldJsonNodes = page.locator('script[type="application/ld+json"]');
        expect(await ldJsonNodes.count()).toBeGreaterThanOrEqual(2);

        const html = await page.content();
        expect(html).not.toMatch(/\$9\/month\b/);
        expect(html).not.toMatch(/\$9\/mo\b/);
        expect(html).not.toMatch(/(^|[^0-9])9 دولار/);
      });
    }
  }

  for (const locale of LOCALES) {
    test(`landing footer links to all 5 compare pages (${locale})`, async ({ page }) => {
      await page.goto(`/${locale}`);
      const footer = page.locator('footer');
      for (const slug of COMPETITORS) {
        const link = footer.locator(`a[href$="/compare/${slug}"]`);
        await expect(link).toBeVisible();
      }
    });
  }

  test('Speedly page mentions Shopify and Salla as Jawab24 advantages (EN)', async ({ page }) => {
    await page.goto('/en/compare/speedly');
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/Shopify/);
    expect(body).toMatch(/Salla/);
    expect(body).toMatch(/AI credits/i);
  });

  test('Speedly page does NOT make unverified BYOK claims (EN)', async ({ page }) => {
    await page.goto('/en/compare/speedly');
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/bring.?your.?own.?key/i);
    expect(body).not.toMatch(/API key/i);
    expect(body).not.toMatch(/USD payment method/i);
  });
});
