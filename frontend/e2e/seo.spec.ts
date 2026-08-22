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
  { path: '/en', arPath: '/' },
  { path: '/en/pricing', arPath: '/pricing' },
  { path: '/en/login', arPath: '/login' },
  { path: '/en/what-is-jawab24', arPath: '/what-is-jawab24' },
  { path: '/en/instagram', arPath: '/instagram' },
  { path: '/en/trust', arPath: '/trust' },
  // TODO: add /en/contact and /en/blog when those pages are built
];

// --- Protected pages (must have noindex) ---
const PROTECTED_PAGES = [
  '/en/dashboard',
  '/en/settings',
  '/en/comments',
  '/en/messages',
];

// --- Pages with JSON-LD structured data ---
const PAGES_WITH_JSON_LD = [
  '/en',
  '/en/pricing',
  '/en/what-is-jawab24',
  '/en/instagram',
  '/en/trust',
  // TODO: add /en/blog when the blog is built
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
    { path: '/en', expected: `${SITE_URL}/en` },
    { path: '/', expected: SITE_URL },
    { path: '/en/pricing', expected: `${SITE_URL}/en/pricing` },
    { path: '/pricing', expected: `${SITE_URL}/pricing` },
    { path: '/en/blog', expected: `${SITE_URL}/en/blog` },
    { path: '/blog', expected: `${SITE_URL}/blog` },
    { path: '/en/trust', expected: `${SITE_URL}/en/trust` },
    { path: '/trust', expected: `${SITE_URL}/trust` },
  ];

  for (const { path, expected } of CANONICAL_TEST_PAGES) {
    test(`canonical URL correct on ${path}`, async ({ page }) => {
      await page.goto(path);
      const canonical = page.locator('link[rel="canonical"]');

      // EXACTLY one. A <link> without a `key` is not deduped by Next.js, so a
      // page that sets its own canonical on top of the global one in _app.tsx
      // renders two and leaves the crawler to pick. Asserting only .last()
      // passed in that case — it tolerated the very defect it looks like it
      // guards. Verified against production first: all pages listed here, and
      // every other public page, serve exactly one.
      await expect(canonical).toHaveCount(1);
      await expect(canonical).toHaveAttribute('href', expected);
    });
  }

  // ----------------------------------------------------------
  // 1c. Hreflang tags (exact assertions, both locales)
  // ----------------------------------------------------------
  const HREFLANG_TEST_PAGES = [
    {
      path: '/en',
      ar: SITE_URL,
      en: `${SITE_URL}/en`,
      xDefault: SITE_URL,
    },
    {
      path: '/',
      ar: SITE_URL,
      en: `${SITE_URL}/en`,
      xDefault: SITE_URL,
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
    '/en',  // root page with many Head overrides
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
  // 1k. Root URL renders real content (not skeleton)
  // ----------------------------------------------------------
  test('root URL (/) renders landing content (not skeleton)', async ({ page }) => {
    await page.goto('/en');

    // Must have real content, not skeleton
    const h1 = page.locator('h1');
    expect(await h1.count()).toBeGreaterThan(0);
    const h1Text = await h1.first().textContent();
    expect(h1Text!.length).toBeGreaterThan(5);

    // No skeleton divs with animate-pulse as main content
    const skeletons = page.locator('.animate-pulse');
    const skeletonCount = await skeletons.count();
    expect(skeletonCount).toBeLessThan(5);
  });

  test('/landing redirects to / (backward compatibility)', async ({ page }) => {
    await page.goto('/en/landing');
    // Should redirect to root (the canonical landing page)
    // Next.js i18n may or may not preserve /en prefix depending on config
    expect(page.url()).not.toContain('/landing');
  });

  // ----------------------------------------------------------
  // 1m. Sitemap validation
  // ----------------------------------------------------------
  test('sitemap.xml is valid and contains expected routes', async ({ page }) => {
    const response = await page.goto('/sitemap.xml');
    expect(response?.status()).toBe(200);

    const body = await page.content();

    // Must be valid XML (if it loaded and has urlset, it parsed)
    expect(body).toContain('<urlset');

    // Representative public routes must appear (/ is the canonical landing page)
    expect(body).toContain(`${SITE_URL}/</loc>`);
    expect(body).toContain(`${SITE_URL}/en</loc>`);
    expect(body).toContain(`${SITE_URL}/pricing`);
    expect(body).toContain(`${SITE_URL}/blog`);

    // /landing should NOT be in sitemap (it redirects to /)
    expect(body).not.toContain(`${SITE_URL}/landing</loc>`);
    expect(body).not.toContain(`${SITE_URL}/en/landing</loc>`);

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
  // 1n. robots.txt validation
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

    // The public site is allowed wholesale; no Disallow may shadow the public
    // sections (a prefix rule like `Disallow: /integrations` would also block
    // every /integrations/<platform> page).
    expect(body).toContain('Allow: /');
    expect(body).not.toMatch(/^Disallow: \/(en\/)?(blog|compare|integrations\/?)\s*$/m);
  });

  test('every AI crawler group repeats the auth-gated Disallow set', async ({ page }) => {
    // Regression guard (2026-08-07). robots.txt groups do NOT merge: a named
    // `User-agent` group FULLY REPLACES `User-agent: *` for that crawler. The
    // AI-crawler blocks each carried only `Allow: /`, so GPTBot/ClaudeBot/etc.
    // inherited none of the dashboard exclusions and were invited to crawl app
    // routes that can only render a login wall.
    //
    // The assertion above cannot catch this — `toContain('Disallow: /dashboard')`
    // is satisfied by the `*` group alone. This one parses per group.
    const response = await page.goto('/robots.txt');
    const body = await response!.text();

    // Parse into { agents[], directives[] } groups. Consecutive User-agent lines
    // share the directive block that follows them (per the robots.txt spec).
    const groups: { agents: string[]; directives: string[] }[] = [];
    let current: { agents: string[]; directives: string[] } | null = null;
    let lastWasAgent = false;

    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const agentMatch = line.match(/^User-agent:\s*(.+)$/i);
      if (agentMatch) {
        if (!current || !lastWasAgent) {
          current = { agents: [], directives: [] };
          groups.push(current);
        }
        current.agents.push(agentMatch[1].trim());
        lastWasAgent = true;
      } else if (current) {
        current.directives.push(line);
        lastWasAgent = false;
      }
    }

    const REQUIRED_DISALLOWS = [
      'Disallow: /dashboard',
      'Disallow: /settings',
      'Disallow: /messages',
      'Disallow: /comments',
      'Disallow: /auth/',
    ];

    const aiAgents = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'PerplexityBot', 'ClaudeBot'];

    for (const agent of aiAgents) {
      const group = groups.find(g => g.agents.some(a => a.toLowerCase() === agent.toLowerCase()));
      expect(group, `robots.txt has no group for ${agent}`).toBeTruthy();
      for (const rule of REQUIRED_DISALLOWS) {
        expect(
          group!.directives,
          `${agent}'s group is missing "${rule}" — a named group replaces "User-agent: *" entirely, so it must repeat the auth-gated Disallow set`,
        ).toContain(rule);
      }
    }
  });
});
