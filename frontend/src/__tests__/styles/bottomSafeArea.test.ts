import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../styles/globals.css'), 'utf-8');

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Bodies of every rule whose selector list ends with `selector` before the `{`. */
const bodiesOf = (selector: string): string[] =>
  [...css.matchAll(new RegExp(`${escape(selector)}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);

const declaration = (body: string, prop: string): string | null => {
  const m = body.match(new RegExp(`(?:^|;|\\s)${escape(prop)}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

/**
 * The mobile bottom nav is lifted off the viewport bottom by
 * `.bottom-nav-position { bottom: var(--sai-bottom) }` so it clears the system
 * navigation bar. `.bottom-safe-bg` is the opaque strip that fills the gap that
 * lift opens. The two MUST agree, on every surface.
 *
 * The bug these tests pin (reported 2026-08-16, dashboard opened from a
 * Facebook post link on Android): the lift was ungated, but the strip was
 * `height: 0` on web and only got a height under `.is-native`. Android 15 lays
 * WebViews out edge-to-edge, so in-app browsers (Facebook, Instagram) report a
 * real env(safe-area-inset-bottom) — the nav floated above the viewport bottom
 * over a TRANSPARENT strip and the page scrolled visibly through the gap
 * underneath it.
 *
 * Mutation check: restore `height: 0px` on `.bottom-safe-bg`, or re-gate it
 * behind `.is-native`, and the first two tests fail.
 */
describe('bottom safe-area strip tracks the bottom nav lift', () => {
  it('.bottom-safe-bg fills exactly the gap the nav lift opens', () => {
    const [base] = bodiesOf('.bottom-safe-bg');
    expect(base).toBeDefined();

    const stripHeight = declaration(base, 'height');
    const navLift = declaration(bodiesOf('.bottom-nav-position')[0], 'bottom');

    // Same token on both sides — they track each other by construction rather
    // than by two hand-maintained values that can drift apart.
    expect(navLift).toBe('var(--sai-bottom)');
    expect(stripHeight).toBe(navLift);
  });

  it('does not gate the strip HEIGHT behind .is-native (the web gap bug)', () => {
    // A `.is-native`-scoped height means the web case is transparent again.
    for (const body of bodiesOf('.is-native .bottom-safe-bg')) {
      expect(declaration(body, 'height')).toBeNull();
    }
    expect(css).not.toMatch(/\.bottom-safe-bg\s*\{[^}]*height:\s*0/);
  });

  it('keeps the .is-native display rule that survives the landscape hide', () => {
    // Looks redundant (a div is display:block already) and is NOT: specificity
    // (0,2,1) outranks the landscape `display: none` (0,1,0), which is the only
    // reason the strip still paints behind the iOS home indicator in native
    // landscape. Deleting it as a cleanup is a silent native regression — it
    // happened while fixing the web gap. The painted outcome is pinned in the
    // browser by e2e/safe-area-cascade.spec.ts; this guards the source.
    const bodies = bodiesOf('.is-native .bottom-safe-bg');
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.some((b) => declaration(b, 'display') === 'block')).toBe(true);
  });

  it('collapses the strip in landscape, where the nav sits at bottom: 0', () => {
    const landscape = css.match(
      /@media \(orientation: landscape\) \{\s*\.bottom-safe-bg\s*\{([^}]*)\}/,
    );
    expect(landscape).not.toBeNull();
    expect(declaration((landscape as RegExpMatchArray)[1], 'display')).toBe('none');

    const navLandscape = css.match(
      /@media \(orientation: landscape\) \{\s*\.bottom-nav-position\s*\{([^}]*)\}/,
    );
    expect(navLandscape).not.toBeNull();
    expect(declaration((navLandscape as RegExpMatchArray)[1], 'bottom')).toBe('0');
  });

  it('keeps the strip behind the nav and out of the hit-testing path', () => {
    const [shared] = bodiesOf('.fixed-safe-bg');
    expect(declaration(shared, 'position')).toBe('fixed');
    expect(Number(declaration(shared, 'z-index'))).toBeLessThan(40); // nav is z-40
    expect(declaration(shared, 'pointer-events')).toBe('none');
  });
});
