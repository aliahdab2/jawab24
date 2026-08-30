#!/usr/bin/env node

/**
 * Sitemap Validation Script for Jawab24
 *
 * Checks:
 *  1. No future <lastmod>     — dates after today degrade Google's trust in the sitemap
 *  2. No duplicate <loc>      — each canonical URL must appear exactly once
 *  3. Hreflang pair integrity — every AR <loc> has a matching EN entry and vice versa
 *  4. Production URLs only    — no http://, no localhost, no staging hosts
 *  5. W3C date format         — <lastmod> values match YYYY-MM-DD
 *  6. Route coverage          — every public index,follow build route is in the sitemap
 *                               (the recurrence guard: the static sitemap can no longer
 *                               silently drift from the app's routes)
 *  7. Data-driven <lastmod>   — every blog / compare / integration URL carries the
 *                               `updated ?? date` of its data module entry, so a page
 *                               revised in the data cannot keep an old date here (which
 *                               is what kept IndexNow from ever resubmitting it)
 *  8. robots.txt agreement    — every auth-gated route in EXCLUDED_ROUTES is disallowed
 *                               (AR + EN) in every user-agent group, and no Disallow is a
 *                               prefix of a sitemap URL (a `Disallow: /integrations` would
 *                               silently block every /integrations/<platform> page)
 *
 * The file itself is produced by generate-sitemap.js; this script is the gate.
 *
 * Usage:  node scripts/validate-sitemap.js
 * Exit:   0 = pass, 1 = errors found
 */

const fs = require('fs');
const path = require('path');
const { slugsFromDataFile, entriesFromDataFile, entryLastModified } = require('./lib/dataSlugs');

const PROD_ORIGIN = 'https://jawab24.com';
const SITEMAP_PATH = path.join(__dirname, '..', 'public', 'sitemap.xml');
const ROBOTS_PATH = path.join(__dirname, '..', 'public', 'robots.txt');
const PAGES_DIR = path.join(__dirname, '..', 'src', 'pages');
const DATA_DIR = path.join(__dirname, '..', 'src', 'data');

// ── Coverage config (Check 6) ────────────────────────────────────────────────
// Next.js special files that are not routable pages.
const SPECIAL_FILES = new Set(['_app', '_document', '_error', '404', '500']);

// Routes intentionally absent from the sitemap (noindex, auth-gated, or utility).
// Keep this explicit: adding a new public page forces a decision — list it in the
// sitemap, or add it here with a reason. A stale entry here is also flagged.
const EXCLUDED_ROUTES = new Map([
  ['admin/ai-cost', 'admin panel (auth-gated)'],
  ['admin/customers', 'admin panel (auth-gated)'],
  ['admin/customers/detail', 'admin panel (auth-gated)'],
  ['admin/observability', 'admin panel (auth-gated)'],
  ['admin/offline-payments', 'admin panel (auth-gated)'],
  ['admin/playground', 'admin panel (auth-gated)'],
  ['admin/waitlist', 'admin panel (auth-gated)'],
  ['auth/app-sync', 'auth flow (noindex)'],
  ['auth/callback', 'auth flow (noindex)'],
  ['auth/phone-collect', 'auth flow (noindex)'],
  ['auth/sync', 'auth flow (noindex)'],
  ['business', 'app workspace (auth-gated)'],
  ['catalog', 'app workspace (auth-gated)'],
  ['checkout', 'transactional (noindex)'],
  ['comments', 'app workspace (auth-gated)'],
  ['complete-profile', 'onboarding (auth-gated)'],
  ['dashboard', 'app workspace (auth-gated)'],
  ['ecommerce-analytics', 'app workspace (auth-gated)'],
  ['gdpr/deletion-status', 'data-deletion status page (noindex — the URL returned by the Facebook data-deletion callback)'],
  ['integrations', 'integrations hub (noindex — the /integrations/[slug] subpages are indexable)'],
  ['invites/accept', 'invite flow (noindex)'],
  ['leads', 'app workspace (auth-gated)'],
  ['login', 'utility page (not indexed)'],
  ['logout', 'utility page (not indexed)'],
  ['messages', 'app workspace (auth-gated)'],
  ['pages', 'app workspace (auth-gated)'],
  ['partner', 'reseller portal (auth-gated — backend 403s non-partners)'],
  ['partner/merchant', 'reseller portal merchant detail (auth-gated)'],
  ['payment/cancel', 'transactional (noindex)'],
  ['payment/return', 'transactional (noindex)'],
  ['payment/success', 'transactional (noindex)'],
  ['pricing/scale', 'private high-volume plans (noindex — reachable only via the at-limit nudge / direct link)'],
  ['salla/connected', 'Salla Easy Mode post-install landing (noindex — the App-URL claim page)'],
  ['salla/onboarding', 'merchant onboarding (auth-gated)'],
  ['settings', 'app workspace (auth-gated)'],
  ['shopify/onboarding', 'merchant onboarding (auth-gated)'],
  ['team', 'app workspace (auth-gated)'],
  ['unsubscribe', 'email utility (noindex)'],
  ['zid/embedded', 'Zid Embedded Apps entry (noindex — the iframe Application URL; only reachable with a one-per-store token from Zid)'],
]);

// Dynamic [slug] routes → the data module whose `slug:` entries enumerate the
// generated pages. A discovered [slug] route that is neither registered here nor
// excluded fails the check, so a new dynamic route can't skip coverage.
const DYNAMIC_SLUG_SOURCES = {
  'blog/[slug]': 'blog-posts.ts',
  'compare/[slug]': 'competitors.ts',
  'integrations/[slug]': 'integrations.ts',
};

/**
 * Parse robots.txt into groups. Consecutive `User-agent` lines share the
 * directive block that follows them (RFC 9309) — a named group does NOT inherit
 * from `*`, which is why the check runs per group.
 */
function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const agent = line.match(/^User-agent:\s*(.+)$/i);
    if (agent) {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallows: [] };
        groups.push(current);
      }
      current.agents.push(agent[1].trim());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    const disallow = line.match(/^Disallow:\s*(\S*)$/i);
    if (disallow && current && disallow[1]) current.disallows.push(disallow[1]);
  }
  return groups;
}

/** Recursively list page routes under a Next.js pages dir (excludes /api). */
function walkRoutes(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'api') continue; // API endpoints are not pages
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkRoutes(full, prefix ? `${prefix}/${entry.name}` : entry.name));
    } else if (entry.name.endsWith('.tsx')) {
      const base = entry.name.replace(/\.tsx$/, '');
      out.push(prefix ? `${prefix}/${base}` : base);
    }
  }
  return out;
}

/**
 * Map a route to its AR-canonical URL path(s).
 * Returns null for a dynamic route with no registered slug source.
 */
function routeToPaths(route, dataDir) {
  if (route === 'index') return ['/'];
  if (route.endsWith('/index')) return [`/${route.slice(0, -'/index'.length)}`];
  if (route.includes('[')) {
    const source = DYNAMIC_SLUG_SOURCES[route];
    if (!source) return null;
    const base = route.replace(/\/\[[^\]]+\]$/, '');
    const slugs = slugsFromDataFile(dataDir, source) || [];
    return slugs.map(s => `/${base}/${s}`);
  }
  return [`/${route}`];
}

/**
 * Validate a sitemap XML string. Pure function (no process.exit) so it is unit-testable.
 * @returns {{ errors: string[], entryCount: number }}
 */
function validateSitemap(xml, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const prodOrigin = opts.prodOrigin || PROD_ORIGIN;
  const pagesDir = opts.pagesDir || PAGES_DIR;
  const dataDir = opts.dataDir || DATA_DIR;
  const checkCoverage = opts.checkCoverage !== false; // default on
  // robots.txt text; `null` skips check 8 (tests that only exercise the XML).
  const robotsTxt = opts.robotsTxt !== undefined
    ? opts.robotsTxt
    : (fs.existsSync(ROBOTS_PATH) ? fs.readFileSync(ROBOTS_PATH, 'utf-8') : null);

  const errors = [];

  // Parse <url>…</url> blocks. Static, well-formed sitemap → regex is sufficient
  // (matches the validate-translations.js approach of no extra deps).
  const urlBlocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => m[1]);

  const entries = urlBlocks.map((block, idx) => {
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/);
    const lastmodMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/);
    if (!locMatch) {
      errors.push(`<url> block #${idx + 1}: missing <loc>`);
      return null;
    }
    return {
      loc: locMatch[1].trim(),
      lastmod: lastmodMatch ? lastmodMatch[1].trim() : null,
    };
  }).filter(Boolean);

  // ── Check 1: No future <lastmod> ──────────────────────────────────────────
  for (const { loc, lastmod } of entries) {
    if (lastmod && lastmod > today) {
      errors.push(`Future <lastmod> ${lastmod} (today is ${today}) for ${loc}`);
    }
  }

  // ── Check 2: No duplicate <loc> ───────────────────────────────────────────
  const seen = new Map();
  for (const { loc } of entries) {
    seen.set(loc, (seen.get(loc) || 0) + 1);
  }
  for (const [loc, count] of seen) {
    if (count > 1) {
      errors.push(`Duplicate <loc> appears ${count}x: ${loc}`);
    }
  }

  // ── Check 3: Hreflang AR/EN pair integrity ────────────────────────────────
  // AR canonical: https://jawab24.com/<path>     (default locale, no /ar prefix)
  // EN canonical: https://jawab24.com/en/<path>
  const locs = new Set(entries.map(e => e.loc));
  for (const loc of locs) {
    if (!loc.startsWith(prodOrigin)) continue;
    const pathPart = loc.slice(prodOrigin.length); // "/blog/foo" | "/en/blog/foo" | "/" | "/en"
    if (pathPart === '/' || pathPart === '') {
      if (!locs.has(`${prodOrigin}/en`)) {
        errors.push(`Homepage AR (${loc}) has no EN counterpart at ${prodOrigin}/en`);
      }
    } else if (pathPart === '/en') {
      if (!locs.has(`${prodOrigin}/`)) {
        errors.push(`Homepage EN (${loc}) has no AR counterpart at ${prodOrigin}/`);
      }
    } else if (pathPart.startsWith('/en/')) {
      const arEquivalent = `${prodOrigin}${pathPart.slice(3)}`; // strip "/en"
      if (!locs.has(arEquivalent)) {
        errors.push(`EN URL ${loc} has no AR counterpart at ${arEquivalent}`);
      }
    } else {
      const enEquivalent = `${prodOrigin}/en${pathPart}`;
      if (!locs.has(enEquivalent)) {
        errors.push(`AR URL ${loc} has no EN counterpart at ${enEquivalent}`);
      }
    }
  }

  // ── Check 4: Production URLs only ─────────────────────────────────────────
  for (const { loc } of entries) {
    if (!loc.startsWith(prodOrigin + '/') && loc !== prodOrigin && loc !== `${prodOrigin}/`) {
      errors.push(`Non-production URL: ${loc} (must start with ${prodOrigin})`);
    }
  }

  // ── Check 5: W3C date format (YYYY-MM-DD) ─────────────────────────────────
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  for (const { loc, lastmod } of entries) {
    if (lastmod && !DATE_RE.test(lastmod)) {
      errors.push(`Malformed <lastmod> "${lastmod}" for ${loc} (expected YYYY-MM-DD)`);
    }
  }

  // ── Check 6: Route coverage ───────────────────────────────────────────────
  if (checkCoverage && fs.existsSync(pagesDir)) {
    const discovered = walkRoutes(pagesDir).filter(r => !SPECIAL_FILES.has(r.split('/').pop()));

    // 6a. Flag stale exclusions so the list stays honest.
    for (const route of EXCLUDED_ROUTES.keys()) {
      if (!discovered.includes(route)) {
        errors.push(`EXCLUDED_ROUTES lists "${route}" which no longer exists under src/pages — remove the stale exclusion in validate-sitemap.js`);
      }
    }

    // 6b. Every discovered, non-excluded route must be present (AR + EN) in the sitemap.
    for (const route of discovered) {
      if (EXCLUDED_ROUTES.has(route)) continue;
      const paths = routeToPaths(route, dataDir);
      if (paths === null) {
        errors.push(`Dynamic route "${route}" has no registered slug source — add it to DYNAMIC_SLUG_SOURCES (or EXCLUDED_ROUTES) in validate-sitemap.js so its pages are coverage-checked`);
        continue;
      }
      for (const p of paths) {
        const ar = `${prodOrigin}${p}`;
        const en = `${prodOrigin}/en${p === '/' ? '' : p}`;
        if (!locs.has(ar)) {
          errors.push(`Indexable route missing from sitemap: ${ar} (route: ${route}) — add it to public/sitemap.xml, or exclude the route in validate-sitemap.js with a reason`);
        }
        if (!locs.has(en)) {
          errors.push(`Indexable route missing from sitemap: ${en} (route: ${route}) — add it to public/sitemap.xml, or exclude the route in validate-sitemap.js with a reason`);
        }
      }
    }
  }

  // ── Check 7: data-driven <lastmod> agrees with the data module ───────────
  // A URL generated from src/data/*.ts must carry that entry's `updated ?? date`.
  // Absence is check 6's job; this only judges dates on URLs that are present.
  const byLoc = new Map(entries.map(e => [e.loc, e]));
  for (const [route, source] of Object.entries(DYNAMIC_SLUG_SOURCES)) {
    const dataEntries = entriesFromDataFile(dataDir, source);
    if (!dataEntries) continue;
    const base = route.replace(/\/\[[^\]]+\]$/, '');
    for (const dataEntry of dataEntries) {
      const expected = entryLastModified(dataEntry);
      if (!expected) {
        errors.push(`${source}: "${dataEntry.slug}" has no date: — every entry needs a publish date (see src/data/contentDates.ts)`);
        continue;
      }
      for (const loc of [`${prodOrigin}/${base}/${dataEntry.slug}`, `${prodOrigin}/en/${base}/${dataEntry.slug}`]) {
        const entry = byLoc.get(loc);
        if (entry && entry.lastmod !== expected) {
          errors.push(`<lastmod> ${entry.lastmod} for ${loc} disagrees with ${source} (${expected}) — run \`npm run sitemap:generate\``);
        }
      }
    }
  }

  // ── Check 8: robots.txt agrees with the route inventory ──────────────────
  if (robotsTxt !== null) {
    const groups = parseRobots(robotsTxt);
    if (groups.length === 0) {
      errors.push('robots.txt has no User-agent group');
    }
    // Every auth-gated route, in both locales, must fall under SOME Disallow
    // prefix of the group (`/admin/` covers admin/ai-cost; `/partner` covers
    // partner/merchant). noindex pages are not required — they must stay crawlable.
    const required = [];
    for (const [route, reason] of EXCLUDED_ROUTES) {
      if (!/auth-gated/.test(reason)) continue;
      required.push(`/${route}`, `/en/${route}`);
    }
    for (const group of groups) {
      const label = group.agents.join(', ');
      for (const urlPath of required) {
        if (!group.disallows.some(rule => urlPath.startsWith(rule))) {
          errors.push(`robots.txt group [${label}] does not disallow ${urlPath} (auth-gated route) — a named group does not inherit from "*", so every group must carry the full set`);
        }
      }
      // A Disallow is a prefix match: it must not shadow anything we ask to have indexed.
      for (const rule of group.disallows) {
        for (const loc of locs) {
          const urlPath = loc.slice(prodOrigin.length) || '/';
          if (urlPath.startsWith(rule)) {
            errors.push(`robots.txt group [${label}] disallows ${rule}, which is a prefix of the sitemap URL ${loc} — the page would never be crawled`);
          }
        }
      }
    }
  }

  return { errors, entryCount: entries.length };
}

module.exports = { validateSitemap, parseRobots, EXCLUDED_ROUTES, DYNAMIC_SLUG_SOURCES };

// ── CLI ───────────────────────────────────────────────────────────────────────
if (require.main === module) {
  if (!fs.existsSync(SITEMAP_PATH)) {
    console.error(`ERROR: sitemap not found at ${SITEMAP_PATH}`);
    process.exit(1);
  }
  const xml = fs.readFileSync(SITEMAP_PATH, 'utf-8');
  const { errors, entryCount } = validateSitemap(xml);

  if (errors.length > 0) {
    console.error(`Sitemap validation failed — ${errors.length} issue(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`Sitemap clean — ${entryCount} entries, no future dates, hreflang pairs intact, route coverage complete, data-driven dates current, robots.txt in agreement.`);
  process.exit(0);
}
