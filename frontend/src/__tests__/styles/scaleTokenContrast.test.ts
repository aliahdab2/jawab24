import { describe, it, expect } from 'vitest';
import {
  AA,
  allPairings,
  contrast,
  inversionBugs,
  pairingsInChunk,
  stripComments,
} from '../testUtils/contrastScan';

/**
 * The surface / brand / accent scales INVERT between themes. Pairing a scale
 * background with a foreground that does not flip with it produces text that is
 * readable in one theme and invisible in the other.
 *
 * This has shipped twice, in opposite directions:
 *   - `.offline-banner`  `bg-surface-800 text-white` → 14.39:1 light, 1.41:1 dark
 *   - sidebar tooltips   `bg-surface-200 text-white` → 1.23:1 light, 18.08:1 dark
 *
 * The second one was invisible on the DEFAULT theme and still went unnoticed,
 * which is the whole argument for a measured gate instead of review: a class
 * string does not tell you what it resolves to in the other theme.
 *
 * Mutation check: revert any fix in the design-system-cleanup commit — e.g. put
 * `bg-surface-200 text-white` back on the tooltips, or drop the `dark:` half of
 * `.badge-info` — and the first test fails naming that file and line.
 */
describe('scale tokens are never paired with a foreground that does not flip', () => {
  it('has no pairing that passes in one theme and fails in the other', () => {
    const offenders = inversionBugs().map(
      (p) =>
        `${p.file}:${p.line}  ${p.light.fg}/${p.light.bg} ${p.light.ratio.toFixed(2)}:1 light` +
        `  →  ${p.dark.fg}/${p.dark.bg} ${p.dark.ratio.toFixed(2)}:1 dark`,
    );
    // Deliberately zero-tolerance. Every inversion bug found in the 2026-08
    // audit was fixed in the same commit that added this test, so any new entry
    // here is a regression introduced after it — not inherited debt.
    expect(offenders).toEqual([]);
  });

  it('detects the two bugs that actually shipped (mutation check)', () => {
    // Proves the scanner fires, without having to break a real file.
    const banner = pairingsInChunk('bg-surface-800 text-white');
    expect(banner).toHaveLength(1);
    expect(banner[0].light.ratio).toBeGreaterThan(AA);
    expect(banner[0].dark.ratio).toBeLessThan(2);

    const tooltip = pairingsInChunk('bg-surface-200 text-white');
    expect(tooltip).toHaveLength(1);
    expect(tooltip[0].light.ratio).toBeLessThan(2);
    expect(tooltip[0].dark.ratio).toBeGreaterThan(AA);

    // …and that the established fix pattern clears it.
    const fixed = pairingsInChunk('bg-surface-800 text-white dark:bg-surface-500');
    expect(fixed[0].light.ratio).toBeGreaterThan(AA);
    expect(fixed[0].dark.ratio).toBeGreaterThan(AA);
  });

  it('does not flag a pairing whose dark background it cannot resolve', () => {
    // `.status-brand` is correctly themed but its dark background carries an
    // opacity modifier, so the effective color depends on what is behind it.
    // An earlier version of this scanner measured the LIGHT token in the dark
    // theme and reported it as broken. Guessing is worse than skipping.
    expect(
      pairingsInChunk('bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'),
    ).toEqual([]);
  });

  it('reads prose in comments as prose, not as class strings', () => {
    // globals.css documents each bug it fixed by quoting the broken pairing, so
    // a scanner that cannot tell code from commentary reports its own
    // documentation as a live bug — and nobody keeps that green for long.
    expect(stripComments('/* was `bg-surface-200 text-white` */').trim()).toBe('');
    expect(stripComments('// was bg-surface-200 text-white').trim()).toBe('');
    // Line count must survive, or every reported line number shifts.
    expect(stripComments('a\n/* x\ny */\nb').split('\n')).toHaveLength(4);
    // A URL is not a comment.
    expect(stripComments('href="https://x.dev"')).toContain('https://x.dev');
  });

  it('scans the shipped UI, and only the shipped UI', () => {
    const files = new Set(allPairings().map((p) => p.file));
    expect(files.size).toBeGreaterThan(20); // it is actually reading the app
    expect([...files].filter((f) => /__tests__|\.test\.|\.spec\./.test(f))).toEqual([]);
  });

  it('computes contrast to the WCAG definition', () => {
    // White on black is the definitional maximum; equal colors the minimum.
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrast([18, 28, 27], [18, 28, 27])).toBeCloseTo(1, 5);
  });
});
