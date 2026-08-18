/**
 * Which fonts are allowed into <head> as a preload.
 *
 * `next/font` emits a `<link rel="preload" as="font">` for every declared `src`
 * of every font whose `preload` is not false. Those links sit AHEAD of the
 * render-blocking stylesheet, so on a starved link they are pure first-paint
 * cost: measured on production at Slow 3G on 2026-08-18, fonts were 24% of the
 * bytes delivered before first paint on the landing and 29% on /pricing.
 *
 * A font can only earn that cost if it actually renders. Measured in a real
 * browser on both locales (Chrome DevTools, isolated context, prod):
 *
 *   cairo    — status `loaded` on /ar AND /en. It is FIRST in every stack in
 *              tailwind.config.js (`sans`, `display`, `arabic`) and covers
 *              every glyph at every weight 300–900, Latin and Arabic.
 *   outfit   — status `unloaded` on BOTH locales. `display` is
 *              [cairo, outfit, …]; a later family only renders glyphs the
 *              earlier ones lack, and Cairo lacks none, so Outfit is
 *              unreachable. It was preloading 32.5 kB on every page to render
 *              nothing.
 *   tajawal  — not preloaded, yet 4 files reach `loaded`. Cause unknown; see
 *              the note in lib/fonts.ts. Do NOT "fix" that by preloading it
 *              without measuring first.
 *   jetbrainsMono — `font-mono` appears on no public page.
 *
 * This test pins the decision and its evidence together, because the flag is
 * one word in a config file and nothing else fails when it flips: the page
 * still renders, still passes every other test, and only gets slower on a
 * connection CI never emulates.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../../lib/fonts.ts'), 'utf8');

/** The `preload:` value inside a given `export const <name> = localFont({...})`. */
function preloadOf(name: string): boolean {
  const start = SRC.indexOf(`export const ${name} = localFont({`);
  if (start === -1) throw new Error(`font export not found: ${name}`);
  const end = SRC.indexOf('});', start);
  expect(end, `${name}: unterminated localFont call`).toBeGreaterThan(start);
  const block = SRC.slice(start, end);
  return !/preload:\s*false/.test(block); // next/font preloads unless told not to
}

describe('font preloads ahead of the render-blocking stylesheet', () => {
  it('preloads cairo — the only font measured as actually rendering', () => {
    expect(preloadOf('cairo')).toBe(true);
  });

  it.each(['outfit', 'tajawal', 'jetbrainsMono'])(
    'does not preload %s',
    (name) => {
      expect(
        preloadOf(name),
        `${name} must keep preload: false — see the measurement in this file's ` +
          `docblock and in lib/fonts.ts. If it now genuinely renders, re-measure ` +
          `on a real browser in BOTH locales before flipping this.`,
      ).toBe(false);
    },
  );

  it('reads the real file, not an empty string', () => {
    // A regex guard that silently matches nothing would pass every assertion
    // above by accident.
    expect(SRC).toContain('localFont');
    expect(() => preloadOf('doesNotExist')).toThrow();
  });
});
