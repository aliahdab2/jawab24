import { test, expect, type Page } from '@playwright/test';

/**
 * Bottom safe-area strip — real-cascade regression guard.
 *
 * The mobile bottom nav is lifted off the viewport bottom by
 * `.bottom-nav-position { bottom: var(--sai-bottom) }` so it clears the system
 * navigation bar. `.bottom-safe-bg` is the opaque strip that fills the gap that
 * lift opens.
 *
 * Bug history:
 *   1. The lift was ungated, but the strip was `height: 0` on web and only got
 *      a height under `html.is-native`. Android 15 lays WebViews out
 *      edge-to-edge, so an in-app browser (Facebook, Instagram) reports a real
 *      env(safe-area-inset-bottom): the nav floated above the viewport bottom
 *      over a TRANSPARENT strip and the dashboard scrolled visibly through the
 *      gap underneath it. Reported 2026-08-16 from a Facebook post link.
 *   2. Fixing (1) by deleting the `.is-native` block as "now redundant" broke
 *      NATIVE LANDSCAPE. `html.is-native .bottom-safe-bg { display: block }`
 *      reads as dead weight (a div is block already) but its specificity
 *      (0,2,1) outranks `@media (orientation: landscape) { .bottom-safe-bg {
 *      display: none } }` (0,1,0) — it is the only reason the strip survives
 *      landscape on native. iOS reports a 21px home-indicator inset there, and
 *      on native pages with no bottom nav that strip is all that sits behind
 *      the home indicator.
 *
 * Why this is an E2E spec and not a unit test: (2) is a pure CASCADE defect.
 * Every declaration read correctly in isolation — only a real browser resolving
 * specificity against a real media query catches it. The companion unit test
 * (src/__tests__/styles/bottomSafeArea.test.ts) pins the CSS source text; this
 * pins what the browser actually paints.
 *
 * Runs in the mobile-chrome (portrait) and mobile-chrome-landscape projects.
 */

// Headless Chrome reports zero safe-area insets, so stand in a known non-zero
// value — exactly what an edge-to-edge Android 15 WebView reports.
const INSET_PX = 48;

const SELECTOR = '.bottom-safe-bg';

/**
 * Height the strip actually paints, in px. `display: none` paints nothing.
 *
 * Verifies its own measurement setup before trusting the number. Every
 * assertion here compares against 0, and so does a measurement taken before the
 * stylesheet or the inset override is live — so a broken *harness* reads exactly
 * like a broken *fix*. That is not hypothetical: an early version of this spec
 * injected the inset via `addStyleTag` in beforeEach, and under parallel workers
 * against a cold dev server it returned 0 for every combination, including ones
 * the mutation under test could not affect. It would have gone green in the
 * gate whenever the override silently failed.
 *
 * Two guards, checked at measurement time, not at setup time:
 *  - `position`/`z-index` come from `.fixed-safe-bg` in the same stylesheet —
 *    proof the cascade under test is loaded.
 *  - the element's own resolved `--sai-bottom` — proof the input to
 *    `height: var(--sai-bottom)` is the value this test thinks it set.
 */
async function paintedHeight(page: Page, expectedInset: number): Promise<number> {
  const { display, height, position, zIndex, inset } = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`${selector} is not on the page`);
    const cs = getComputedStyle(el);
    return {
      display: cs.display,
      height: el.getBoundingClientRect().height,
      position: cs.position,
      zIndex: cs.zIndex,
      inset: cs.getPropertyValue('--sai-bottom').trim(),
    };
  }, SELECTOR);

  expect(position, 'globals.css is not applied — measurement is meaningless').toBe('fixed');
  expect(zIndex, 'globals.css is not applied — measurement is meaningless').toBe('39');
  expect(inset, 'the --sai-bottom override is not live — measurement is meaningless').toBe(
    `${expectedInset}px`,
  );

  return display === 'none' ? 0 : height;
}

/**
 * Stand in a known non-zero inset — headless Chrome reports zero safe areas.
 * Set as an inline `!important` on the root element rather than an injected
 * <style> node: it survives re-render, cannot lose a cascade race with the
 * app's own stylesheet, and is re-applied per measurement.
 */
async function primeInset(page: Page, px: number): Promise<void> {
  await page.evaluate((v) => {
    document.documentElement.style.setProperty('--sai-bottom', `${v}px`, 'important');
  }, px);
}

async function setNative(page: Page, native: boolean): Promise<void> {
  await page.evaluate((on) => {
    for (const el of [document.documentElement, document.body]) {
      el.classList.toggle('is-native', on);
    }
  }, native);
}

test.describe('bottom safe-area strip', () => {
  test.beforeEach(async ({ page }) => {
    // /en/login is public and renders the strip (login.tsx: `lg:hidden
    // fixed-safe-bg bottom-safe-bg`), so no auth fixture is needed.
    await page.goto('/en/login');
    await expect(page.locator(SELECTOR).first()).toBeAttached();
  });

  test('web portrait paints the strip; landscape does not', async ({ page }, testInfo) => {
    const isLandscape = testInfo.project.name.includes('landscape');
    await setNative(page, false);
    await primeInset(page, INSET_PX);

    // Portrait: the nav is lifted by the inset, so the gap MUST be filled —
    // this is the Facebook in-app browser bug. Landscape: the nav sits at
    // bottom: 0, so there is no gap and nothing should paint.
    expect(await paintedHeight(page, INSET_PX)).toBe(isLandscape ? 0 : INSET_PX);
  });

  test('native keeps the strip in BOTH orientations', async ({ page }) => {
    await setNative(page, true);
    await primeInset(page, INSET_PX);

    // Unchanged by the web fix, in either orientation. Landscape is the one
    // that a "remove the redundant .is-native rule" cleanup silently drops.
    expect(await paintedHeight(page, INSET_PX)).toBe(INSET_PX);
  });

  test('the strip tracks the nav lift rather than a hard-coded height', async ({ page }) => {
    // Re-point the token; both the strip and the nav offset must follow it.
    await setNative(page, true);
    await primeInset(page, 17);
    expect(await paintedHeight(page, 17)).toBe(17);

    const navLift = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'bottom-nav-position';
      probe.style.position = 'fixed';
      document.body.append(probe);
      const bottom = getComputedStyle(probe).bottom;
      probe.remove();
      return bottom;
    });
    // Portrait lifts by the inset; landscape pins to 0 — either way the strip
    // above matches the gap the nav leaves.
    expect(['17px', '0px']).toContain(navLift);
  });
});
