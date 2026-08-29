import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Admin surfaces must not lay out content wider than a phone.
 *
 * Reported 2026-08-29 from a real Android device. Measured in Chrome device
 * emulation at 412x915 against a live 2-page account:
 *
 *   /admin/customers/detail  badge cluster 332px and 517px in a 330px card row,
 *                            sitting at x=-38 and x=-145
 *   /admin/playground        <select> 677px in a 412px viewport, at x=-488
 *
 * Neither was hard-clipped — an ancestor scrolls, so the content could be
 * panned to. That is the point: the admin had to scroll SIDEWAYS inside a
 * vertically-scrolling page to read a badge, which is not what either layout
 * intends. Verified as reachable-but-overflowing with `scrollIntoView` before
 * fixing, so this spec is about layout intent, not about lost information.
 *
 * These are SOURCE pins. jsdom has no layout, so the widths above cannot be
 * re-measured here; what can be pinned is the specific class that produced
 * them in each case.
 *
 * Mutation check: restore `shrink-0` on the cluster, or drop `min-w-0` from
 * the select, and the matching test fails.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf-8');

/** Comments quote the very classes these tests forbid — strip them first. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

describe('admin layouts fit a phone', () => {
  it('the connected-pages badge cluster can shrink and wrap', () => {
    const src = code('components/admin/customer/OverviewSection.tsx');

    // The row must be allowed to break, so an oversized cluster takes its own line.
    expect(src, 'the page row must be able to wrap').toMatch(
      /className="group flex flex-wrap items-center gap-3 p-3/,
    );

    // The cluster itself: wraps internally, and can shrink below its content
    // width so that wrapping is ever reachable.
    const cluster = src.match(/<div className="flex[^"]*items-center gap-1[^"]*">/);
    expect(cluster, 'badge cluster div not found — did the markup move?').not.toBeNull();
    const clusterCls = cluster![0];
    expect(clusterCls, 'shrink-0 is what pushed the cluster off the card').not.toContain('shrink-0');
    expect(clusterCls).toContain('flex-wrap');
    expect(clusterCls).toContain('min-w-0');
  });

  it('the playground page picker can shrink below its longest option', () => {
    const src = code('pages/admin/playground.tsx');
    const select = src.match(/className="flex-1[^"]*rounded-lg text-sm focus:outline-none[^"]*"/);
    expect(select, 'page-select className not found — did the markup move?').not.toBeNull();
    expect(
      select![0],
      'a flex <select> without min-w-0 is floored at its longest option width',
    ).toContain('min-w-0');
  });

  it('the admin wordmark is hidden on phones rather than truncated to nothing', () => {
    const src = code('components/layout/AdminLayout.tsx');
    expect(src).toMatch(/font-display font-bold text-lg truncate hidden sm:inline/);
  });
});
