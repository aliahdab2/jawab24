import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A grid inside the dashboard shell must not add columns at `lg`.
 *
 * `lg` (1024px) is the exact width at which DashboardLayout stops hiding its
 * 256px sidebar and offsets the content column by `lg:ms-64`. Tailwind's
 * breakpoints read the VIEWPORT, so a `lg:grid-cols-N` inside that content
 * column asks for room the container lost at the very same breakpoint — the
 * grid is sized for 1024px while it actually has 768px.
 *
 * Reported 2026-08-29 against /pricing on iPad Pro. Measured signed in, live:
 *
 *   1024x1366 (13" portrait)   sidebar 256px   grid 640px   4 cards x 136px  <-
 *   1194x834  (11" landscape)  sidebar 256px   grid 802px   4 cards x 176px
 *   1366x1024 (13" landscape)  sidebar 256px   grid 942px   4 cards x 211px
 *    834x1194 (11" portrait)   sidebar hidden  grid 762px   2 cards x 345px  ok
 *
 * At 136px the Arabic feature text wraps to one word per line and the price
 * blocks render outside the card border. The 11" portrait case is correct
 * precisely BECAUSE it sits below `lg` and never gets the sidebar.
 *
 * This spec pins the SOURCE, which is what a jsdom test can see: there is no
 * layout in jsdom, so the geometry above cannot be re-measured here. The two
 * assertions are deliberately paired — the premise (the sidebar arrives at
 * `lg`) is asserted alongside the consequence (the grid waits for `xl`), so
 * that moving the sidebar's breakpoint fails this spec loudly instead of
 * silently invalidating the reason the grid was moved.
 *
 * Mutation check: restore `lg:grid-cols-4` in pricing.tsx and the second test
 * fails; change DashboardLayout's `lg:ms-64` to `xl:ms-64` and the first fails.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf-8');

describe('dashboard-shell grids do not add columns at the sidebar breakpoint', () => {
  it('DashboardLayout still reveals the sidebar and offsets content at lg', () => {
    const layout = read('components/layout/DashboardLayout.tsx');

    // The premise of the rule below. If this ever moves, the pricing grid's
    // `xl:` column count should be revisited in the same change.
    expect(layout, 'expected the content column to be offset by the sidebar at lg').toContain(
      'lg:ms-64',
    );
    expect(layout, 'expected the desktop sidebar to be gated behind lg').toContain('hidden lg:block');
  });

  it('the pricing plan grid waits for xl before going multi-column beyond 2', () => {
    const pricing = read('pages/pricing.tsx');

    // Strip comments: this file documents the bug using the very string the
    // assertion forbids, and a comment must not be able to fail the test.
    const code = pricing.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

    const lgColumns = code.match(/\blg:grid-cols-\d+/g) ?? [];
    expect(
      lgColumns,
      'a lg: column count inside the dashboard shell is sized for 256px it does not have',
    ).toEqual([]);

    // And the intended layout is actually present, so deleting the classes
    // outright cannot pass this spec.
    expect(code).toMatch(/\bmd:grid-cols-2\b/);
    expect(code).toMatch(/\bxl:grid-cols-4\b/);
    expect(code).toMatch(/\bxl:grid-cols-3\b/);
  });
});
