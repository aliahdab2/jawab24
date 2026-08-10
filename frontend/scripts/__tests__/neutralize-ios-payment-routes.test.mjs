/**
 * Regression tests for the iOS Guideline 3.1.1 price gate.
 *
 * Run: node --test scripts/__tests__/neutralize-ios-payment-routes.test.mjs
 *
 * WHY THESE EXIST. The gate shipped (2026-08-10) reporting "no price markup
 * remains in any of 74 exported pages" for a bundle in which six `compare/*`
 * pages rendered "$15/mo" and "15 دولاراً شهرياً" in visible body text, and five
 * `blog/*` pages carried prices too. Two independent holes produced that:
 *
 *   1. markers were filtered to `length >= 2`, which discarded a bare "$" —
 *      the single most common price marker there is;
 *   2. markers came only from ICU's default `symbol` display, so the
 *      spelled-out form ("دولار") was never derived at all.
 *
 * A gate that only ever passes is indistinguishable from no gate, so every
 * check below is pinned in BOTH directions: it must fire on the real offending
 * strings and stay silent on the prose that surrounds them.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  currencyMarkers,
  pricePattern,
  routeOf,
  isPaymentRoute,
  stub,
  STUB_MARKER,
} = require('../neutralize-ios-payment-routes.js');

describe('currencyMarkers', () => {
  const markers = currencyMarkers();

  test('derives the bare "$" that the shipped bug filtered out', () => {
    assert.ok(markers.includes('$'), `expected "$" among ${JSON.stringify(markers)}`);
  });

  test('derives the spelled-out Arabic form the shipped bug never asked ICU for', () => {
    assert.ok(markers.includes('دولار'), `expected "دولار" among ${JSON.stringify(markers)}`);
  });

  test('keeps the multi-character symbol forms', () => {
    assert.ok(markers.includes('US$'));
    assert.ok(markers.includes('SAR'));
  });

  test('contains no invisible format characters', () => {
    // ICU wraps the Arabic SAR format in U+200F RIGHT-TO-LEFT MARK. Kept as a
    // marker it matches any Arabic page with a number after an RTL mark, which
    // fails the build on innocent pages and is invisible in the error message.
    const invisible = markers.filter((m) => /\p{Cf}/u.test(m));
    assert.deepEqual(invisible, [], `invisible markers leaked: ${JSON.stringify(invisible)}`);
  });

  test('excludes bare "US", which precedes digits in ordinary prose', () => {
    assert.ok(!markers.includes('US'));
  });
});

describe('pricePattern', () => {
  const re = () => pricePattern(currencyMarkers());

  // The exact strings that shipped past the gate, lifted from the built
  // compare/* and blog/* pages of build 8's first bundle.
  for (const text of [
    '$15/mo',
    'السعر يبدأ من $15/mo $14/mo',
    'باقة Starter في جواب24 بـ 15 دولاراً شهرياً',
    '٣٩ دولار',
    'US$ 1,234.00',
    'SAR 99',
    'يبدأ من 15 دولار/شهرياً مقابل 29 دولار/شهرياً',
  ]) {
    test(`fires on a real price: ${text}`, () => {
      assert.ok(re().test(text), 'expected a price match');
    });
  }

  // Adjacency to a digit is what makes a bare "$" safe to keep as a marker.
  for (const text of [
    'a lone $ sign in prose',
    'US 2026 report',
    'class="grid-cols-4"',
    'الرسائل ‏ 12',
    'نتائج ‏ 2026 الجديدة',
  ]) {
    test(`stays silent on non-price text: ${text}`, () => {
      assert.ok(!re().test(text), 'expected no price match');
    });
  }

  test('reports the longest matching marker, not the "$" nested in "US$"', () => {
    const hit = re().exec('US$ 149');
    assert.ok(hit);
    assert.ok(hit[0].startsWith('US$'), `reported ${JSON.stringify(hit[0])}`);
  });
});

describe('routeOf / isPaymentRoute', () => {
  test('maps exported files back to routes', () => {
    const outDir = new URL('../../out/', import.meta.url).pathname;
    assert.equal(routeOf(`${outDir}pricing/scale.html`), '/pricing/scale');
    assert.equal(routeOf(`${outDir}index.html`), '/');
  });

  test('recognises payment routes with and without a locale prefix', () => {
    assert.ok(isPaymentRoute('/pricing/scale'));
    assert.ok(isPaymentRoute('/ar/pricing/scale'));
    assert.ok(isPaymentRoute('/checkout'));
    assert.ok(!isPaymentRoute('/dashboard'));
    assert.ok(!isPaymentRoute('/ar'));
  });
});

describe('stub', () => {
  test('carries the marker the Xcode verification phase greps for', () => {
    assert.ok(stub('/pricing').includes(STUB_MARKER));
  });

  test('carries no price of its own', () => {
    const re = pricePattern(currencyMarkers());
    assert.ok(!re.test(stub('/pricing')));
  });
});
