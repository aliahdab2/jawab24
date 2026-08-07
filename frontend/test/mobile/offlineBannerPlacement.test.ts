import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The offline banner must render inside the header-cleared area.
 *
 * It used to be the first in-flow child of `.dashboard-scroll-root`, which made
 * it a `position: static` element sitting underneath a `fixed` header. A
 * `z-index` on a static element does nothing, so the header painted over it —
 * and because the banner only renders when `isNativePlatform()` holds, the one
 * context it ever appeared in was the one context in which it was covered. The
 * whole user-visible effect of losing the network was an unexplained downward
 * shift of the content, with no message. Measured in a real browser at 390x844:
 * the banner occupied 0–32px and `elementFromPoint` at its centre returned the
 * header, not the banner.
 *
 * Moving it inside `<main>` — which already carries `pt-header` — puts it below
 * the header while keeping it in normal flow, so it stays visible AND keeps
 * pushing the content down instead of covering the page title. An earlier
 * attempt that lifted it into the fixed header layer did make it visible, but
 * overlapped the heading underneath; the browser probe caught that before it
 * shipped.
 *
 * Asserted against the source, like nativeInitEffect.test.ts and
 * android-manifest.test.ts: the banner returns `null` off-native, so jsdom never
 * renders it, and jsdom computes no layout even if it did.
 */
describe('OfflineBanner placement in DashboardLayout', () => {
  let layout: string;
  let banner: string;
  let scrollRootIdx: number;
  let mainIdx: number;
  let bannerUses: number[];

  beforeAll(() => {
    layout = readFileSync(
      path.resolve(__dirname, '../../src/components/layout/DashboardLayout.tsx'),
      'utf-8'
    );
    banner = readFileSync(
      path.resolve(__dirname, '../../src/components/ui/OfflineBanner.tsx'),
      'utf-8'
    );

    scrollRootIdx = layout.indexOf('dashboard-scroll-root');
    expect(scrollRootIdx, 'dashboard-scroll-root not found — did the layout get restructured?')
      .toBeGreaterThan(-1);

    mainIdx = layout.indexOf('<main');
    expect(mainIdx, '<main> not found — did the layout get restructured?').toBeGreaterThan(-1);

    bannerUses = [];
    for (let i = layout.indexOf('<OfflineBanner'); i !== -1; i = layout.indexOf('<OfflineBanner', i + 1)) {
      bannerUses.push(i);
    }
  });

  it('renders the banner exactly once', () => {
    // Both chrome variants share <main>, so one render site covers them all.
    expect(bannerUses).toHaveLength(1);
  });

  it('never renders the banner as a bare child of the scroll root', () => {
    // This is the regression itself: out there it is a static element under a
    // fixed header, and no z-index can rescue it.
    expect(
      bannerUses[0],
      'the banner is back above <main> — the fixed header will paint over it again'
    ).toBeGreaterThan(mainIdx);
  });

  it('renders it inside the area <main> has already cleared of the header', () => {
    // `pt-header` is what puts the banner below the fixed header. Without it the
    // banner is back underneath, wherever it sits in the tree.
    const mainOpenTag = layout.slice(mainIdx, bannerUses[0]);
    expect(mainOpenTag, '<main> no longer clears the fixed header').toContain('pt-header');
  });

  it('colours the banner through a theme-aware class, not a raw surface token', () => {
    // The surface scale INVERTS in dark mode (--surface-800 goes from 33 44 43
    // to 210 218 230), so `bg-surface-800 text-white` measured 1.41:1 in dark —
    // under the 4.5:1 floor, and unreadable. Nobody caught it for as long as the
    // banner was hidden behind the header.
    expect(banner).toContain('offline-banner');
    expect(banner, 'raw surface token on the banner inverts in dark mode')
      .not.toMatch(/bg-surface-\d/);

    const css = readFileSync(
      path.resolve(__dirname, '../../src/styles/globals.css'),
      'utf-8',
    );
    const rule = /\.offline-banner\s*\{([^}]*)\}/.exec(css);
    expect(rule, '.offline-banner is not defined in globals.css').not.toBeNull();
    expect(rule![1], 'the banner must stay dark in dark mode too').toMatch(/dark:bg-/);
  });

  it('gives the banner no z-index of its own', () => {
    // A z-index without positioning is inert, and carrying one implies a
    // stacking guarantee the element cannot honour.
    const root = /<div\s+([^>]*?)>/.exec(banner);
    expect(root, 'could not find the banner root element').not.toBeNull();
    expect(root![1]).not.toMatch(/\bz-\d/);
  });

  it('announces itself to assistive technology', () => {
    // The banner appears without user action; without a live region a screen
    // reader user is told nothing at all.
    expect(banner).toMatch(/role="status"/);
    expect(banner).toMatch(/aria-live="polite"/);
  });
});
