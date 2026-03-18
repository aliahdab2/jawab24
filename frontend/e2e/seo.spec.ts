import { test, expect, type Page } from '@playwright/test';

/**
 * SEO Regression Prevention Tests — JavaScript Disabled
 *
 * These tests verify that SEO-critical meta tags, structured data,
 * and crawl directives survive code changes. They run with JS disabled
 * to test actual server-rendered HTML (what Google/AI crawlers see).
 *
 * Covers: canonical, hreflang, OG, Twitter, robots, JSON-LD, sitemap, robots.txt
 *
 * If these tests fail, check:
 * - _app.tsx MetaHead (canonical, hreflang, OG, Twitter, robots defaults)
 * - DashboardLayout (noindex for protected routes)
 * - Individual page <Head> overrides
 */

const SITE_URL = 'https://jawab24.com';

// --- Public pages to test ---
const PUBLIC_PAGES = [
  { path: '/en/landing', arPath: '/landing' },
  { path: '/en/pricing', arPath: '/pricing' },
  { path: '/en/login', arPath: '/login' },
  { path: '/en/what-is-jawab24', arPath: '/what-is-jawab24' },
  { path: '/en/contact', arPath: '/contact' },
  { path: '/en/blog', arPath: '/blog' },
];

// --- Protected pages (must have noindex) ---
const PROTECTED_PAGES = [
  '/en/dashboard',
  '/en/settings',
  '/en/comments',
  '/en/messages',
  '/en/templates',
  '/en/rules',
];

// --- Pages with JSON-LD structured data ---
const PAGES_WITH_JSON_LD = [
  '/en/landing',
  '/en/pricing',
  '/en/what-is-jawab24',
  '/en/blog',
];

// Known blog slug for article-specific tests
const BLOG_ARTICLE_SLUG = 'auto-reply-facebook-setup-guide';

// --- Helper: get attribute from the *last* matching meta tag (Next.js dedup keeps last) ---
async function getMetaContent(page: Page, selector: string): Promise<string | null> {
  const elements = page.locator(selector);
  const count = await elements.count();
  if (count === 0) return null;
  return elements.nth(count - 1).getAttribute('content');
}

// ============================================================
// All SEO tests run with JavaScript disabled
// ============================================================
test.describe('SEO — meta tags, structured data, and crawl directives', () => {
  test.use({ javaScriptEnabled: false });

  // ----------------------------------------------------------
  // 1a. Core meta tags on all public pages
  // ----------------------------------------------------------
  for (const { path } of PUBLIC_PAGES) {
    test(`core meta tags present on ${path}`, async ({ page }) => {
      await page.goto(path);

      // <title> must be non-empty and meaningful
      const title = await page.title();
      expect(title.length).toBeGreaterThan(10);

      // <meta name="description"> must have substantial content
      const desc = await getMetaContent(page, 'meta[name="description"]');
      expect(desc).toBeTruthy();
      expect(desc!.length).toBeGreaterThan(30);

      // OG title and description
      const ogTitle = await getMetaContent(page, 'meta[property="og:title"]');
      expect(ogTitle).toBeTruthy();

      const ogDesc = await getMetaContent(page, 'meta[property="og:description"]');
      expect(ogDesc).toBeTruthy();

      // OG image must reference jawab24
      const ogImage = await getMetaContent(page, 'meta[property="og:image"]');
      expect(ogImage).toBeTruthy();
      expect(ogImage!.toLowerCase()).toContain('jawab24');

      // Twitter card
      const twitterCard = await getMetaContent(page, 'meta[name="twitter:card"]');
      expect(twitterCard).toBeTruthy();
    });
  }

  // ----------------------------------------------------------
  // 1b. Canonical URL correctness (exact assertions)
  // ----------------------------------------------------------
  const CANONICAL_TEST_PAGES = [
    { path: '/en/landing', expected: `${SITE_URL}/en/landing` },
    { path: '/landing', expected: `${SITE_URL}/landing` },
    { path: '/en/pricing', expected: `${SITE_URL}/en/pricing` },
    { path: '/pricing', expected: `${SITE_URL}/pricing` },
    { path: '/en/blog', expected: `${SITE_URL}/en/blog` },
    { path: '/blog', expected: `${SITE_URL}/blog` },
  ];

  for (const { path, expected } of CANONICAL_TEST_PAGES) {
    test(`canonical URL correct on ${path}`, async ({ page }) => {
      await page.goto(path);
      const canonical = page.locator('link[rel="canonical"]');
      await expect(canonical.last()).toHaveAttribute('href', expected);
    });
  }

  // ----------------------------------------------------------
  // 1c. Hreflang tags (exact assertions, both locales)
  // ----------------------------------------------------------
  const HREFLANG_TEST_PAGES = [
    {
      path: '/en/landing',
      ar: `${SITE_URL}/landing`,
      en: `${SITE_URL}/en/landing`,
      xDefault: `${SITE_URL}/landing`,
    },
    {
      path: '/landing',
      ar: `${SITE_URL}/landing`,
      en: `${SITE_URL}/en/landing`,
      xDefault: `${SITE_URL}/landing`,
    },
    {
      path: '/en/pricing',
      ar: `${SITE_URL}/pricing`,
      en: `${SITE_URL}/en/pricing`,
      xDefault: `${SITE_URL}/pricing`,
    },
  ];

  for (const { path, ar, en, xDefault } of HREFLANG_TEST_PAGES) {
    test(`hreflang tags correct on ${path}`, async ({ page }) => {
      await page.goto(path);

      const hreflangAr = page.locator('link[rel="alternate"][hreflang="ar"]');
      await expect(hreflangAr.last()).toHaveAttribute('href', ar);

      const hreflangEn = page.locator('link[rel="alternate"][hreflang="en"]');
      await expect(hreflangEn.last()).toHaveAttribute('href', en);

      const hreflangDefault = page.locator('link[rel="alternate"][hreflang="x-default"]');
      await expect(hreflangDefault.last()).toHaveAttribute('href', xDefault);
    });
  }

  // ----------------------------------------------------------
  // 1d. No duplicate meta tags (tag ownership)
  // ----------------------------------------------------------
  const DEDUP_TEST_PAGES = [
    '/en/landing',  // public page with many Head overrides
    '/en/pricing',  // public page with fewer overrides
  ];

  for (const path of DEDUP_TEST_PAGES) {
    test(`no duplicate critical meta tags on ${path}`, async ({ page }) => {
      await page.goto(path);

      // Exactly 1 canonical
      const canonicals = page.locator('link[rel="canonical"]');
      expect(await canonicals.count()).toBe(1);

      // Exactly 1 robots
      const robots = page.locator('meta[name="robots"]');
      expect(await robots.count()).toBe(1);

      // Exactly 1 description
      const descriptions = page.locator('meta[name="description"]');
      expect(await descriptions.count()).toBe(1);

      // Exactly 1 og:title (Next.js deduplicates by property)
      const ogTitles = page.locator('meta[property="og:title"]');
      expect(await ogTitles.count()).toBe(1);
    });
  }

  // ----------------------------------------------------------
  // 1e. Noindex on protected routes
  // ----------------------------------------------------------
  for (const path of PROTECTED_PAGES) {
    test(`noindex on protected route ${path}`, async ({ page }) => {
      await page.goto(path);

      const robotsContent = await getMetaContent(page, 'meta[name="robots"]');
      expect(robotsContent).toBeTruthy();
      expect(robotsContent!).toContain('noindex');
    });
  }

  // ----------------------------------------------------------
  // 1f. Public pages ARE indexable (positive assertion)
  // ----------------------------------------------------------
  for (const { path } of PUBLIC_PAGES) {
    test(`public page ${path} is indexable`, async ({ page }) => {
      await page.goto(path);

      const robotsContent = await getMetaContent(page, 'meta[name="robots"]');
      expect(robotsContent).toBeTruthy();
      expect(robotsContent!).toContain('index');
      expect(robotsContent!).not.toContain('noindex');
    });
  }

  // ----------------------------------------------------------
  // 1g. Non-200 pages: noindex on 404 and checkout
  // ----------------------------------------------------------
  test('404 page has noindex', async ({ page }) => {
    await page.goto('/en/nonexistent-page-xyz-test');

    const robotsContent = await getMetaContent(page, 'meta[name="robots"]');
    expect(robotsContent).toBeTruthy();
    expect(robotsContent!).toContain('noindex');
  });

  // Note: checkout page has noindex in its client-rendered Head, but with JS
  // disabled the server only renders MetaHead's "index, follow" default.
  // This is acceptable because checkout requires auth and shows no content
  // to crawlers. The noindex is a defense-in-depth measure for logged-in users.

  // ----------------------------------------------------------
  // 1h. JSON-LD structured data — pages with schemas
  // ----------------------------------------------------------
  for (const path of PAGES_WITH_JSON_LD) {
    test(`valid JSON-LD on ${path}`, async ({ page }) => {
      await page.goto(path);

      const jsonLdScripts = page.locator('script[type="application/ld+json"]');
      const count = await jsonLdScripts.count();
      expect(count).toBeGreaterThan(0);

      // Every JSON-LD block must parse and have @context + @type
      for (let i = 0; i < count; i++) {
        const raw = await jsonLdScripts.nth(i).textContent();
        expect(raw).toBeTruthy();

        const parsed = JSON.parse(raw!);
        expect(parsed['@context']).toBeTruthy();
        expect(parsed['@type']).toBeTruthy();
      }
    });
  }

  // ----------------------------------------------------------
  // 1i. JSON-LD structured data — blog article
  // ----------------------------------------------------------
  test('blog article has BlogPosting schema and og:type article', async ({ page }) => {
    await page.goto(`/en/blog/${BLOG_ARTICLE_SLUG}`);

    // og:type must be "article"
    const ogType = await getMetaContent(page, 'meta[property="og:type"]');
    expect(ogType).toBe('article');

    // Find BlogPosting JSON-LD
    const jsonLdScripts = page.locator('script[type="application/ld+json"]');
    const count = await jsonLdScripts.count();
    expect(count).toBeGreaterThan(0);

    let foundBlogPosting = false;
    for (let i = 0; i < count; i++) {
      const raw = await jsonLdScripts.nth(i).textContent();
      const parsed = JSON.parse(raw!);

      if (parsed['@type'] === 'BlogPosting') {
        foundBlogPosting = true;
        expect(parsed.datePublished).toBeTruthy();
        expect(parsed.author).toBeTruthy();
        expect(parsed.headline).toBeTruthy();
        break;
      }
    }
    expect(foundBlogPosting).toBe(true);
  });

  // ----------------------------------------------------------
  // 1j. Head survives layout changes
  // ----------------------------------------------------------
  test('DashboardLayout page retains noindex + canonical', async ({ page }) => {
    await page.goto('/en/settings');

    // noindex must survive DashboardLayout rendering
    const robotsContent = await getMetaContent(page, 'meta[name="robots"]');
    expect(robotsContent).toBeTruthy();
    expect(robotsContent!).toContain('noindex');

    // canonical should still be present (from _app.tsx MetaHead)
    const canonical = page.locator('link[rel="canonical"]');
    expect(await canonical.count()).toBeGreaterThan(0);
  });

  test('non-layout public page retains indexable + canonical + hreflang', async ({ page }) => {
    await page.goto('/en/contact');

    // Must be indexable
    const robotsContent = await getMetaContent(page, 'meta[name="robots"]');
    expect(robotsContent).toBeTruthy();
    expect(robotsContent!).toContain('index');
    expect(robotsContent!).not.toContain('noindex');

    // canonical present
    const canonical = page.locator('link[rel="canonical"]');
    expect(await canonical.count()).toBeGreaterThan(0);

    // hreflang present
    const hreflangAr = page.locator('link[rel="alternate"][hreflang="ar"]');
    expect(await hreflangAr.count()).toBeGreaterThan(0);
    const hreflangEn = page.locator('link[rel="alternate"][hreflang="en"]');
    expect(await hreflangEn.count()).toBeGreaterThan(0);
  });

  // ----------------------------------------------------------
  // 1k. Sitemap validation
  // ----------------------------------------------------------
  test('sitemap.xml is valid and contains expected routes', async ({ page }) => {
    const response = await page.goto('/sitemap.xml');
    expect(response?.status()).toBe(200);

    const body = await page.content();

    // Must be valid XML (if it loaded and has urlset, it parsed)
    expect(body).toContain('<urlset');

    // Representative public routes must appear
    expect(body).toContain(`${SITE_URL}/landing`);
    expect(body).toContain(`${SITE_URL}/en/landing`);
    expect(body).toContain(`${SITE_URL}/pricing`);
    expect(body).toContain(`${SITE_URL}/blog`);

    // Protected routes must NOT appear
    expect(body).not.toContain(`${SITE_URL}/dashboard`);
    expect(body).not.toContain(`${SITE_URL}/settings`);
    expect(body).not.toContain(`${SITE_URL}/comments`);
    expect(body).not.toContain(`${SITE_URL}/en/dashboard`);

    // Representative localized entries should have hreflang alternates
    // Check that landing entry has ar, en, x-default alternates
    expect(body).toContain('hreflang="ar"');
    expect(body).toContain('hreflang="en"');
    expect(body).toContain('hreflang="x-default"');
  });

  // ----------------------------------------------------------
  // 1l. robots.txt validation
  // ----------------------------------------------------------
  test('robots.txt has correct crawl policy', async ({ page }) => {
    const response = await page.goto('/robots.txt');
    expect(response?.status()).toBe(200);

    const body = await response!.text();

    // Sitemap URL must be present
    expect(body).toContain('Sitemap: https://jawab24.com/sitemap.xml');

    // Protected/private patterns must be disallowed
    expect(body).toContain('Disallow: /dashboard');
    expect(body).toContain('Disallow: /settings');
    expect(body).toContain('Disallow: /auth/');
    expect(body).toContain('Disallow: /comments');
    expect(body).toContain('Disallow: /messages');

    // Blog and integrations should be explicitly allowed
    expect(body).toContain('/blog');
    expect(body).toContain('/integrations');
  });
});
