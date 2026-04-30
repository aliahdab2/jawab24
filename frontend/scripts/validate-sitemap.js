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
 *
 * Usage:  node scripts/validate-sitemap.js
 * Exit:   0 = pass, 1 = errors found
 */

const fs = require('fs');
const path = require('path');

const SITEMAP_PATH = path.join(__dirname, '..', 'public', 'sitemap.xml');
const PROD_ORIGIN = 'https://jawab24.com';

if (!fs.existsSync(SITEMAP_PATH)) {
  console.error(`ERROR: sitemap not found at ${SITEMAP_PATH}`);
  process.exit(1);
}

const xml = fs.readFileSync(SITEMAP_PATH, 'utf-8');
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

// Parse <url>…</url> blocks. Static sitemap, well-formed → regex is sufficient
// (matches the validate-translations.js approach of no extra deps).
const urlBlocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => m[1]);

const errors = [];

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

// ── Check 1: No future <lastmod> ────────────────────────────────────────────
for (const { loc, lastmod } of entries) {
  if (lastmod && lastmod > today) {
    errors.push(`Future <lastmod> ${lastmod} (today is ${today}) for ${loc}`);
  }
}

// ── Check 2: No duplicate <loc> ─────────────────────────────────────────────
const seen = new Map();
for (const { loc } of entries) {
  seen.set(loc, (seen.get(loc) || 0) + 1);
}
for (const [loc, count] of seen) {
  if (count > 1) {
    errors.push(`Duplicate <loc> appears ${count}x: ${loc}`);
  }
}

// ── Check 3: Hreflang AR/EN pair integrity ──────────────────────────────────
// AR canonical: https://jawab24.com/<path>     (default locale, no /ar prefix)
// EN canonical: https://jawab24.com/en/<path>
const locs = new Set(entries.map(e => e.loc));
for (const loc of locs) {
  if (!loc.startsWith(PROD_ORIGIN)) continue;
  const pathPart = loc.slice(PROD_ORIGIN.length); // e.g. "/blog/foo" or "/en/blog/foo" or "/" or "/en"
  if (pathPart === '/' || pathPart === '') {
    // Homepage. Pair is "/" (AR) ↔ "/en" (EN).
    if (!locs.has(`${PROD_ORIGIN}/en`)) {
      errors.push(`Homepage AR (${loc}) has no EN counterpart at ${PROD_ORIGIN}/en`);
    }
  } else if (pathPart === '/en') {
    if (!locs.has(`${PROD_ORIGIN}/`)) {
      errors.push(`Homepage EN (${loc}) has no AR counterpart at ${PROD_ORIGIN}/`);
    }
  } else if (pathPart.startsWith('/en/')) {
    const arEquivalent = `${PROD_ORIGIN}${pathPart.slice(3)}`; // strip "/en"
    if (!locs.has(arEquivalent)) {
      errors.push(`EN URL ${loc} has no AR counterpart at ${arEquivalent}`);
    }
  } else {
    const enEquivalent = `${PROD_ORIGIN}/en${pathPart}`;
    if (!locs.has(enEquivalent)) {
      errors.push(`AR URL ${loc} has no EN counterpart at ${enEquivalent}`);
    }
  }
}

// ── Check 4: Production URLs only ───────────────────────────────────────────
for (const { loc } of entries) {
  if (!loc.startsWith(PROD_ORIGIN + '/') && loc !== PROD_ORIGIN && loc !== `${PROD_ORIGIN}/`) {
    errors.push(`Non-production URL: ${loc} (must start with ${PROD_ORIGIN})`);
  }
}

// ── Check 5: W3C date format (YYYY-MM-DD) ───────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
for (const { loc, lastmod } of entries) {
  if (lastmod && !DATE_RE.test(lastmod)) {
    errors.push(`Malformed <lastmod> "${lastmod}" for ${loc} (expected YYYY-MM-DD)`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error(`Sitemap validation failed — ${errors.length} issue(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`Sitemap clean — ${entries.length} entries, no future dates, all hreflang pairs intact.`);
process.exit(0);
