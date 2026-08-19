import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { css } from '../testUtils/cssSource';

const appTsx = readFileSync(
  resolve(__dirname, '../../pages/_app.tsx'),
  'utf-8',
);

/**
 * Toasts anchor to the BOTTOM corner (bottom-right in LTR, bottom-left in RTL).
 * On mobile the bottom nav (4rem) occupies that space, so the offset must clear
 * it plus the gesture safe-area inset. `--toast-offset-bottom` is the single
 * source of truth for both:
 *  - the React `<Toaster mobileOffset>` prop in _app.tsx (web)
 *  - the `.is-native [data-sonner-toaster]` override in globals.css (Capacitor)
 *
 * These tests guard against:
 *  1. The CSS variable disappearing or no longer tracking the gesture inset /
 *     nav clearance — which would let toasts overlap the bottom nav again.
 *  2. The native override hard-coding a value instead of reading the token.
 *  3. The React Toaster prop hard-coding a value instead of reading the token.
 *  4. The toast silently drifting back to a top/center position.
 */
describe('toast safe-area offset — single source of truth', () => {
  // Exactly TWO declarations: the nav-clearing base, and the ≥lg override
  // that returns to a plain corner offset once the bottom nav is gone. The
  // override must live behind the nav's own breakpoint (1024px) — sonner's
  // built-in mobile query switches at 600px, which left the 601–1023px band
  // with toasts painted over the still-visible nav.
  it('declares --toast-offset-bottom exactly twice: base + ≥lg override', () => {
    const declarations = css.match(/--toast-offset-bottom:/g) ?? [];
    expect(declarations).toHaveLength(2);
    const lgOverride = css.match(
      /@media \(min-width: 1024px\)\s*\{\s*:root\s*\{\s*--toast-offset-bottom:\s*([^;]+);/,
    );
    expect(lgOverride).not.toBeNull();
    expect((lgOverride as RegExpMatchArray)[1].trim()).toBe('16px');
  });

  it('--toast-offset-bottom clears the bottom nav and tracks the gesture inset', () => {
    const m = css.match(/--toast-offset-bottom:\s*([^;]+);/);
    expect(m).not.toBeNull();
    const value = (m as RegExpMatchArray)[1];
    // Must reference --sai-bottom so gesture-nav devices keep the real inset,
    // and --nav-bottom-height so the clearance tracks the nav in both
    // orientations (4rem portrait / 3rem landscape) instead of a hard-coded px.
    expect(value).toContain('var(--sai-bottom)');
    expect(value).toContain('var(--nav-bottom-height)');
  });

  // A toast must never paint over an open modal's footer and block Save —
  // sonner ships z-index 999999999. The cap keeps toasts above the app chrome
  // (nav z-40) but under every modal tier (z-50+).
  it('caps the sonner z-index between the nav (40) and the modal tier (50)', () => {
    const block = css.match(/html \[data-sonner-toaster\]\s*\{[^}]*z-index:\s*(\d+)/);
    expect(block).not.toBeNull();
    const z = Number((block as RegExpMatchArray)[1]);
    expect(z).toBeGreaterThan(40);
    expect(z).toBeLessThan(50);
  });

  it('.is-native sonner override targets the bottom position and reads the token', () => {
    const block = css.match(
      /\.is-native\s+\[data-sonner-toaster\]\[data-y-position="bottom"\]\s*\{[^}]+\}/,
    );
    expect(block).not.toBeNull();
    const body = (block as RegExpMatchArray)[0];
    expect(body).toContain('var(--toast-offset-bottom)');
    // Negative guard: must NOT inline the calc expression here — that's the
    // drift trap the single-source-of-truth pattern exists to prevent.
    expect(body).not.toContain('4rem');
  });

  it('Toaster mobileOffset reads the bottom token (no hard-coded value)', () => {
    expect(appTsx).toMatch(/mobileOffset=\{\{\s*bottom:\s*['"]var\(--toast-offset-bottom\)['"]\s*\}\}/);
    // The desktop prop reads the SAME token — the 601–1023px band is "desktop"
    // to sonner but still shows the bottom nav, so a hard-coded 16px here
    // parked toasts on top of the nav and of modal footers.
    expect(appTsx).toMatch(/(?<!mobile)offset=\{\{\s*bottom:\s*['"]var\(--toast-offset-bottom\)['"]\s*\}\}/i);
    const toasterBlock = appTsx.match(/<Toaster[\s\S]*?\/>/);
    expect(toasterBlock).not.toBeNull();
    const block = (toasterBlock as RegExpMatchArray)[0];
    // Negative guard: no inline calc — same drift trap.
    expect(block).not.toMatch(/calc\s*\(/);
    expect(block).not.toMatch(/bottom:\s*['"]\d+px['"]/);
  });

  it('Toaster anchors to the bottom corner, mirrored for RTL', () => {
    const toasterBlock = appTsx.match(/<Toaster[\s\S]*?\/>/);
    expect(toasterBlock).not.toBeNull();
    const block = (toasterBlock as RegExpMatchArray)[0];
    // Locale-aware: bottom-right (LTR) / bottom-left (RTL). Guards against a
    // silent regression back to top/center.
    expect(block).toContain("'bottom-right'");
    expect(block).toContain("'bottom-left'");
    expect(block).not.toMatch(/position=["']top/);
  });
});
