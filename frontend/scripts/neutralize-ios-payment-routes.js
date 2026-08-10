/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * App Store Guideline 3.1.1 — remove every payment surface from the iOS bundle.
 *
 * Run after `build:mobile` and before `cap sync ios`. iOS ONLY: the same `out/`
 * feeds the Android build, where these routes are legitimate.
 *
 * WHY THIS EXISTS (2026-08-10). The pages already self-gate at runtime via
 * `useIOSPaymentRedirect`, but that guard is a REACT guard: it can only blank
 * the page once hydration has run. Next exports these routes as static HTML
 * built with `isIOSNative() === false`, so the shipped `pricing/scale.html`
 * contained the full plan grid — headline, feature list and price — as plain
 * markup that renders with zero JavaScript. Anything that paints that file
 * before hydration shows a reviewer exactly what 3.1.1 forbids. Observed once
 * on a simulator, then not reproducible: a race, which is precisely the kind of
 * defect a guard cannot close (AI_INSTRUCTIONS Rule 14, prevention over
 * detection).
 *
 * Routes are DISCOVERED, not listed: every exported .html is mapped back to its
 * route and matched against the prefixes in `src/config/payment-routes.json` —
 * the same file `src/lib/paymentRoutes.ts` imports. A new page under an existing
 * payment prefix is neutralized automatically, and there is no second list to
 * drift.
 *
 * We REPLACE rather than DELETE. A missing file makes a hard navigation render
 * the WebView's error page; a stub always lands the user somewhere sane. The
 * stub carries no price, no plan name and no upgrade wording, so even if it is
 * painted it is 3.1.1-clean.
 *
 * Client-side navigation is unaffected: Next routes through the page's JS
 * chunk, not through this file, so the runtime guard still handles in-app
 * navigation. The layers are complementary, not redundant.
 */
const fs = require('fs');
const path = require('path');

const { prefixes: PAYMENT_PREFIXES } = require('../src/config/payment-routes.json');

const outDir = path.join(__dirname, '..', 'out');

/** Marker the Xcode verification phase greps for. Keep in sync with
 *  ios/App/Scripts/verify-payment-routes-neutralized.sh. */
const STUB_MARKER = 'jawab24-payment-route-neutralized';

/** Locales the web build prefixes routes with (next.config.js i18n.locales). */
const LOCALES = ['ar', 'en'];

/** Digits in every numbering system the locales above can emit, plus the group
 *  and decimal separators that sit between them. */
const DIGITS = '\\d\\u0660-\\u0669\\u06f0-\\u06f9';

/**
 * Currency markers, DERIVED from ICU rather than hand-typed. `formatUsd` uses
 * Intl.NumberFormat, so the literal a price renders as ("$US", "US$", "US٬")
 * depends on the locale's CLDR data and changes with the ICU version — a
 * hardcoded list would quietly stop matching after a Node upgrade and report
 * a clean bundle. We ask Intl what it emits and strip the digits.
 *
 * ⚠️ THIS UNDER-MATCHED AND SHIPPED A VIOLATION (2026-08-10). The first version
 * kept only tokens of `length >= 2`, which threw away the single most common
 * price marker there is — a bare "$" — and asked ICU only for the default
 * `symbol` display, so the spelled-out form ("15 دولار") had no marker either.
 * The guard duly reported "no price markup remains" for a bundle whose compare
 * pages rendered "$15/mo" and "15 دولاراً شهرياً". We now ask ICU for all three
 * displays and keep short tokens; the digit-adjacency requirement in
 * `pricePattern` is what keeps a bare "$" from firing on ordinary prose.
 */
const currencyMarkers = () => {
  const markers = new Set();
  for (const locale of LOCALES) {
    for (const currency of ['USD', 'SAR']) {
      // symbol: "US$"/"SAR" · narrowSymbol: "$" · name: "دولار أمريكي"/"US dollars"
      for (const currencyDisplay of ['symbol', 'narrowSymbol', 'name']) {
      try {
        const sample = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay }).format(1234);
        // Keep the non-numeric run(s): the currency label/symbol itself.
        for (const token of sample.split(/[\d\s  .,٬٫]+/)) {
          // Drop invisible bidi controls. ICU wraps the Arabic SAR format in
          // U+200F RIGHT-TO-LEFT MARK; kept as a marker it would match every
          // Arabic page that places a number after an RTL mark — a
          // build-breaking false positive, and an invisible one to debug.
          const clean = token.replace(/\p{Cf}/gu, '');
          // Keep symbols of ANY length ("$") and words of 3+ ("SAR", "دولار").
          // Dropping all-letter 2-char tokens keeps ICU's "US" (from "US
          // dollars") out — it sits next to digits in ordinary prose.
          if (clean && (clean.length >= 3 || /[^\p{L}]/u.test(clean))) markers.add(clean);
        }
      } catch {
        /* locale unavailable in this Node's ICU — the other locales still cover us */
      }
      }
    }
  }
  return [...markers];
};

/**
 * A price is a currency marker STANDING NEXT TO A NUMBER. Requiring adjacency is
 * what lets us keep a bare "$" as a marker: "$15" is a price, a lone "$" in
 * prose is not. Markers are matched longest-first so a hit reports "US$" rather
 * than the "$" nested inside it.
 */
const pricePattern = (markers) => {
  const alt = [...markers]
    .sort((a, b) => b.length - a.length)
    .map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`(?:${alt})\\s*[${DIGITS}]|[${DIGITS}]\\s*(?:${alt})`, 'u');
};

/** `out/pricing/scale.html` -> `/pricing/scale`; `out/index.html` -> `/`. */
const routeOf = (absFile) => {
  const rel = path.relative(outDir, absFile).split(path.sep).join('/');
  const noExt = rel.replace(/\.html$/, '');
  return noExt === 'index' ? '/' : `/${noExt.replace(/\/index$/, '')}`;
};

const isPaymentRoute = (route) => {
  let pathname = route;
  for (const locale of LOCALES) {
    if (pathname === `/${locale}`) return false;
    if (pathname.startsWith(`/${locale}/`)) {
      pathname = pathname.slice(locale.length + 1);
      break;
    }
  }
  return PAYMENT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
};

const htmlFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_next') continue; // JS chunks are gated at runtime, not markup
      walk(full);
    } else if (entry.name.endsWith('.html')) {
      htmlFiles.push(full);
    }
  }
};

const stub = (route) => `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Jawab24</title>
<meta name="robots" content="noindex,nofollow">
<script>location.replace('/');</script>
</head><body></body></html>
<!-- ${STUB_MARKER}: ${route} is not available in the iOS build
     (App Store Guideline 3.1.1). Generated by
     scripts/neutralize-ios-payment-routes.js — do not edit. -->
`;

function main() {
  if (!fs.existsSync(outDir)) {
    console.error('out/ directory not found. Run build:mobile first.');
    process.exit(1);
  }

  console.log('Neutralizing payment routes for the iOS bundle (Guideline 3.1.1)...');
  walk(outDir);

  const payment = htmlFiles.filter((f) => isPaymentRoute(routeOf(f)));
  for (const file of payment) {
    const before = Math.round(fs.statSync(file).size / 1024);
    fs.writeFileSync(file, stub(routeOf(file)));
    console.log(`  Replaced ${path.relative(outDir, file)} (${before}KB -> stub)`);
  }

  if (payment.length === 0) {
    console.error(
      'No payment routes found in the export. Either the build is empty or the ' +
      'prefixes in src/config/payment-routes.json no longer match any route. ' +
      'Refusing to ship an unverified bundle.',
    );
    process.exit(1);
  }

  // Verify against the built output rather than trusting the pass above.
  const markers = currencyMarkers();
  const priceRe = pricePattern(markers);
  const offenders = [];
  for (const file of htmlFiles) {
    const route = routeOf(file);
    const raw = fs.readFileSync(file, 'utf8');

    if (isPaymentRoute(route)) {
      if (!raw.includes(STUB_MARKER)) offenders.push(`${route} — payment route was not neutralized`);
      continue;
    }

    // Scan RENDERED markup only. Next serializes the whole next-intl message
    // catalogue into __NEXT_DATA__, so pricing strings legitimately appear as
    // JSON inside a <script> on every page. That is data, not a payment
    // surface — it never paints. Scanning raw HTML flags all 13 dashboard
    // pages and buries the real signal.
    const markup = raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const hit = priceRe.exec(markup);
    if (hit) {
      offenders.push(
        `${route} — renders a price ("${hit[0].trim()}") but is not a known payment route`,
      );
    }
  }

  if (offenders.length > 0) {
    console.error('iOS bundle still exposes payment content:');
    for (const o of offenders) console.error(`  - ${o}`);
    console.error(
      'Either add the route prefix to src/config/payment-routes.json (it is a payment ' +
      'surface) or add it to scripts/strip-mobile-assets.js (it is web-only marketing ' +
      'content). Refusing to ship a 3.1.1 violation.',
    );
    process.exit(1);
  }

  console.log(
    `Neutralized ${payment.length} payment routes; no price markup remains in any of ` +
    `${htmlFiles.length} exported pages (markers: ${markers.join(', ')}).`,
  );
}

module.exports = { routeOf, isPaymentRoute, currencyMarkers, pricePattern, STUB_MARKER, stub };

if (require.main === module) main();
