import { describe, it, expect } from 'vitest';
import { css, bodiesOf, declaration } from '../testUtils/cssSource';

/**
 * An EMPTY `dir="auto"` input must follow the UI direction, not fall back to LTR.
 *
 * `dir=auto` on a form control resolves from the element's VALUE, never its
 * placeholder — so an empty box computes `direction: ltr` however the page is
 * laid out. In the Arabic UI that puts the caret and the placeholder at the LEFT
 * edge of every empty field. Reported 2026-08-19 against the «اختبار الرد الذكي»
 * composer and reproduced in Chrome: `direction: ltr`, `unicode-bidi: plaintext`,
 * `text-align: start` — which is also why the placeholder's trailing «...» renders
 * on the far left while the box itself is left-aligned.
 *
 * This spec pins the CSS SOURCE. What the browser actually resolves — including
 * that an author rule beats the `dir` attribute's presentational hint, and that
 * typing restores full auto-detection — is pinned in
 * e2e/complete-profile.spec.ts, which is the half a source assertion cannot prove.
 *
 * Mutation check: delete the rule from globals.css, or narrow it to `[dir="rtl"]
 * input[dir="auto"]`, and these fail.
 */
describe('empty dir="auto" fields inherit the UI direction', () => {
  const SELECTORS = ['input[dir="auto"]:placeholder-shown', 'textarea[dir="auto"]:placeholder-shown'];

  it('sets direction: inherit for both input and textarea', () => {
    for (const selector of SELECTORS) {
      const bodies = bodiesOf(selector);
      expect(bodies.length, `no rule found for ${selector}`).toBeGreaterThan(0);
      expect(bodies.some((b) => declaration(b, 'direction') === 'inherit')).toBe(true);
    }
  });

  it('does not touch unicode-bidi, so typing restores auto-detection', () => {
    // Forcing `unicode-bidi: normal` would pin the placeholder's own base
    // direction to the UI's, flipping trailing punctuation on a Latin
    // placeholder inside the Arabic UI. `plaintext` (what dir=auto maps to)
    // must survive; only the box's direction is corrected.
    for (const selector of SELECTORS) {
      for (const body of bodiesOf(selector)) {
        expect(declaration(body, 'unicode-bidi')).toBeNull();
      }
    }
  });

  it('is not gated behind a locale or a platform class', () => {
    // `direction: inherit` is correct in BOTH directions — it is a no-op in the
    // LTR locale. Scoping it to `[dir="rtl"]` or `.is-native` would recreate the
    // class of bug that shipped in the safe-area strip: one side of a pair
    // gated, the other not (see bottomSafeArea.test.ts).
    expect(css).not.toMatch(/\[dir="rtl"\]\s+(?:input|textarea)\[dir="auto"\]:placeholder-shown/);
    expect(css).not.toMatch(/\.is-native\s+(?:input|textarea)\[dir="auto"\]:placeholder-shown/);
  });
});
