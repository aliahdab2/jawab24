import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(
  resolve(__dirname, '../../styles/globals.css'),
  'utf-8',
);

const appTsx = readFileSync(
  resolve(__dirname, '../../pages/_app.tsx'),
  'utf-8',
);

/**
 * The toast top offset is the single source of truth for both:
 *  - the React `<Toaster mobileOffset>` prop in _app.tsx (web)
 *  - the `.is-native [data-sonner-toaster]` override in globals.css (Capacitor)
 *
 * These tests guard against three classes of regression:
 *  1. The CSS variable definition disappears or stops using `max()` — which
 *     would make toasts hug the top on no-notch viewports again (the original
 *     bug we fixed).
 *  2. The native override hard-codes a value instead of reading the token,
 *     re-introducing drift.
 *  3. The React Toaster prop hard-codes a value instead of reading the token.
 */
describe('toast safe-area offset — single source of truth', () => {
  it('declares --toast-offset-top exactly once', () => {
    const declarations = css.match(/--toast-offset-top:/g) ?? [];
    expect(declarations).toHaveLength(1);
  });

  it('floors --toast-offset-top with max() so no-notch viewports get a buffer', () => {
    // Match the declaration value (everything between the colon and semicolon)
    const m = css.match(/--toast-offset-top:\s*([^;]+);/);
    expect(m).not.toBeNull();
    const value = (m as RegExpMatchArray)[1];
    // Must use max() to floor at a constant; must reference --sai-top so notch
    // devices still get the real safe-area inset.
    expect(value).toMatch(/max\s*\(/);
    expect(value).toContain('var(--sai-top)');
  });

  it('.is-native sonner override reads the token (no hard-coded value)', () => {
    // Pull the native override block.
    const block = css.match(
      /\.is-native\s+\[data-sonner-toaster\]\[data-y-position="top"\]\s*\{[^}]+\}/,
    );
    expect(block).not.toBeNull();
    const body = (block as RegExpMatchArray)[0];
    expect(body).toContain('var(--toast-offset-top)');
    // Negative guard: must NOT inline the calc/max expression here — that's
    // what created the drift trap in the first place.
    expect(body).not.toMatch(/max\s*\(/);
  });

  it('Toaster mobileOffset reads the token (no hard-coded value)', () => {
    expect(appTsx).toMatch(/mobileOffset=\{\{\s*top:\s*['"]var\(--toast-offset-top\)['"]\s*\}\}/);
    // Negative guard: no inline calc/max — same drift trap.
    const toasterBlock = appTsx.match(/<Toaster[\s\S]*?\/>/);
    expect(toasterBlock).not.toBeNull();
    expect((toasterBlock as RegExpMatchArray)[0]).not.toMatch(/calc\s*\(\s*max/);
  });
});
