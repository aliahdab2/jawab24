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
  let mainCloseIdx: number;
  let bannerUses: number[];

  beforeAll(() => {
    // Comments are stripped first: this file documents its own JSX, so prose
    // like "Inside <main> on purpose" would otherwise register as a second
    // <main> and a commented-out <OfflineBanner /> would count as a render site.
    layout = readFileSync(
      path.resolve(__dirname, '../../src/components/layout/DashboardLayout.tsx'),
      'utf-8'
    )
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    banner = readFileSync(
      path.resolve(__dirname, '../../src/components/ui/OfflineBanner.tsx'),
      'utf-8'
    );

    scrollRootIdx = layout.indexOf('dashboard-scroll-root');
    expect(scrollRootIdx, 'dashboard-scroll-root not found — did the layout get restructured?')
      .toBeGreaterThan(-1);

    mainIdx = layout.indexOf('<main');
    expect(mainIdx, '<main> not found — did the layout get restructured?').toBeGreaterThan(-1);

    mainCloseIdx = layout.indexOf('</main>', mainIdx);
    expect(mainCloseIdx, '</main> not found').toBeGreaterThan(-1);
    expect(layout.indexOf('<main', mainIdx + 1), 'a second <main> would make these offsets meaningless')
      .toBe(-1);

    bannerUses = [];
    for (let i = layout.indexOf('<OfflineBanner'); i !== -1; i = layout.indexOf('<OfflineBanner', i + 1)) {
      bannerUses.push(i);
    }
  });

  it('renders the banner exactly once', () => {
    // Both chrome variants share <main>, so one render site covers them all.
    expect(bannerUses).toHaveLength(1);
  });

  it('renders the banner inside <main>, not merely somewhere after it', () => {
    // This is the regression itself: outside <main> it is a static element under
    // a fixed header, and no z-index can rescue it.
    //
    // Both bounds matter. An earlier version of this guard only checked the
    // lower one, so moving the banner *below* `</main>` — a plausible refactor —
    // left it green while putting the banner straight back outside the
    // header-cleared area.
    expect(
      bannerUses[0],
      'the banner is back above <main> — the fixed header will paint over it again'
    ).toBeGreaterThan(mainIdx);
    expect(
      bannerUses[0],
      'the banner has escaped below </main> and is no longer header-cleared'
    ).toBeLessThan(mainCloseIdx);
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
    // stacking guarantee the element cannot honour. Stacking is the layout's job.
    expect(banner, 'z-index on an unpositioned element does nothing')
      .not.toMatch(/\bz-\d/);
  });

  it('announces itself to assistive technology', () => {
    // The banner appears without user action; without a live region a screen
    // reader user is told nothing at all. That the region OUTLIVES the message —
    // rather than appearing already populated, which TalkBack and VoiceOver
    // routinely drop — is asserted at runtime in OfflineBanner.test.tsx, which
    // can compare node identity across a state change.
    expect(banner).toMatch(/role="status"/);
    expect(banner).toMatch(/aria-live="polite"/);
    expect(banner, 'the live region must not be gated on isOffline')
      .not.toMatch(/if\s*\(\s*!isOffline/);
  });
});
