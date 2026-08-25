import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The landing page's motion contract, pinned as source.
 *
 * Three rules, each of which was a live defect on 2026-08-25 and each of which
 * silently regresses the moment someone adds one more class:
 *
 *  1. HOVER MOVEMENT IS POINTER-GATED. A touch tap fires a synthetic :hover that
 *     is never cleared, so `hover:-translate-y-2` leaves the card stuck in its
 *     hovered transform after the finger lifts. 11 declarations across 6
 *     components did this. The fix is the `hoverable:` / `group-hoverable:`
 *     variants (tailwind.config.js), which wrap the rule in
 *     `@media (hover: hover) and (pointer: fine)`.
 *
 *     We chose the CONTAINED fix over Tailwind's app-wide
 *     `future.hoverOnlyWhenSupported` flag, which means nothing stops the next
 *     `hover:scale-105` from being written. This spec is what stops it.
 *     Colour-only hovers are deliberately still allowed: a stuck colour is a
 *     hint, a stuck transform is a broken-looking card.
 *
 *  2. ENTRANCES STAY OPAQUE. Framer Motion serialises `initial` into the SSR
 *     markup, so `opacity: 0` ships a visually blank hero that appears only once
 *     the JS has hydrated — ~16s on a cold Slow 3G first visit
 *     (frontend/scripts/perf). Fixed once already in 46c76c1e, "remove opacity-0
 *     from scroll animations to prevent white flash". Easy to reintroduce,
 *     because every animation guide on the internet tells you to add the fade.
 *
 *  3. EVERY INFINITE ANIMATION HONOURS prefers-reduced-motion. `.stat-neon-breathe`
 *     is defined ~560 lines away from the other animations and was missed by the
 *     2026-08 sweep, so it kept pulsing under a reduce preference (WCAG 2.2.2).
 *
 * Mutation check (run 2026-08-25, all three fail as expected):
 *   1. `hoverable:-translate-y-2` -> `hover:-translate-y-2` in LandingFeatures  => fails
 *   2. `opacity: 1, scale: 0.97` -> `opacity: 0, scale: 0.97` in LandingSocialProof => fails
 *   3. delete `.stat-neon-breathe,` from the reduced-motion block               => fails
 *
 * Scope: source text only. Whether the browser actually suppresses the hover on
 * a touch device is a cascade question this cannot prove — see the artifact
 * bench and a real device for that half.
 */

const LANDING_DIR = resolve(__dirname, '../../components/landing');

const landingSources = readdirSync(LANDING_DIR)
  .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
  .map((f) => ({ file: f, text: readFileSync(resolve(LANDING_DIR, f), 'utf-8') }));

describe('landing motion contract', () => {
  it('has landing sources to scan', () => {
    // Guards against the whole suite passing vacuously if the folder moves.
    expect(landingSources.length).toBeGreaterThan(8);
  });

  it('gates every hover MOVEMENT behind a real pointer', () => {
    // Movement only. `hover:bg-*`, `hover:text-*`, `hover:border-*`, `hover:shadow-*`
    // are intentionally out of scope.
    const UNGATED_MOVEMENT = /\b(?:group-)?hover:(?:-?(?:translate|scale|rotate|skew)-|-?translate|rotate-0\b)/;

    const offenders: string[] = [];
    for (const { file, text } of landingSources) {
      for (const [i, line] of text.split('\n').entries()) {
        if (UNGATED_MOVEMENT.test(line)) offenders.push(`${file}:${i + 1}`);
      }
    }

    expect(
      offenders,
      `ungated hover transform — use hoverable:/group-hoverable: instead:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('never starts a SCROLL entrance at opacity: 0', () => {
    // Matches `opacity: 0` and `opacity: 0,` but not `opacity: 0.5`.
    const OPACITY_ZERO = /opacity:\s*0(?![.\d])/;

    // The ban is narrower than "no opacity: 0 anywhere", because only content
    // that is ALWAYS MOUNTED ends up in the SSR markup, and only that content
    // can be blank at first paint. Two conventions separate the cases here:
    //
    //   scroll entrance  -> `hidden:` variant, or a bare `initial={{ … }}`,
    //                       driven by useInView on an always-rendered element.
    //                       THIS is what 46c76c1e fixed. Banned.
    //   dynamic mount    -> `enter:` / `exit:` variants inside AnimatePresence
    //                       (the hero + showcase chat bubbles, which appear one
    //                       at a time as the demo plays), and the FAQ answer,
    //                       which is `{openFaq === i && …}` and so is not in the
    //                       server HTML at rest. Fading these in is correct, and
    //                       46c76c1e explicitly left the accordion unchanged.
    const SCROLL_ENTRANCE = /(\bhidden:\s*\{|initial=\{\{)/;
    // `height` in the same object means a collapse/expand, i.e. the accordion.
    const IS_COLLAPSE = /height:/;

    const offenders: string[] = [];
    for (const { file, text } of landingSources) {
      for (const [i, line] of text.split('\n').entries()) {
        if (!OPACITY_ZERO.test(line)) continue;
        if (!SCROLL_ENTRANCE.test(line)) continue;
        if (IS_COLLAPSE.test(line)) continue;
        offenders.push(`${file}:${i + 1}`);
      }
    }

    expect(
      offenders,
      `scroll entrance starts invisible — reverts 46c76c1e (white flash / blank hero on Slow 3G):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('uses the shared easing token instead of a hand-typed curve', () => {
    const offenders: string[] = [];
    for (const { file, text } of landingSources) {
      for (const [i, line] of text.split('\n').entries()) {
        // The old house curve, and any other raw 4-tuple bezier in a transition.
        if (/ease:\s*\[\s*[\d.]+\s*,/.test(line)) offenders.push(`${file}:${i + 1}`);
      }
    }

    expect(
      offenders,
      `hand-typed cubic-bezier — import EASE_OUT from '@/constants/motion':\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

// Reduced-motion coverage is NOT re-checked here. That contract has one owner:
// animationVocabulary.test.ts, "covers infinite animations on classes NOT named
// animate-*" — which is where the `.stat-neon-breathe` hole was actually closed,
// by discovering animations from their declaration rather than their class name.
// A second copy here would drift and would not have fixed the underlying guard.
