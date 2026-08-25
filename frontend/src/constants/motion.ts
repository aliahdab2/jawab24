/**
 * Motion tokens — the easing curves and duration budgets the UI animates on.
 *
 * Motion was the only design axis in this codebase with no token layer: colour,
 * spacing, safe areas and the toast scale all live in `globals.css` / this
 * folder, while `[0.25, 0.46, 0.45, 0.94]` was hand-typed in 13 places across 7
 * landing files, next to 14 distinct durations. Two copies drifting 20ms apart
 * is not a bug anyone reports — it is why the page reads as slightly unsettled.
 *
 * ── The opacity rule ──────────────────────────────────────────────────────
 * There is deliberately no "fade in" token here. Landing entrances are
 * TRANSFORM-ONLY: every `hidden`/`initial` variant pins `opacity: 1`. Framer
 * Motion serialises `initial` into the SSR markup, so `opacity: 0` ships a
 * visually blank hero that appears only once the JS bundle has hydrated — on a
 * cold Slow 3G first visit that is ~16s of nothing (frontend/scripts/perf).
 * That was a shipped bug, fixed in 46c76c1e ("remove opacity-0 from scroll
 * animations to prevent white flash"). Do not reintroduce an opacity-0 entrance
 * on a public page; shrink the transform's amplitude instead.
 */

/**
 * Strong ease-out — the default for anything entering, exiting or responding to
 * input. Starts fast, so the frame the user is watching is the one that moves.
 *
 * Replaces `[0.25, 0.46, 0.45, 0.94]` (a quadratic ease-out), which decelerates
 * too gently to read as a response to a click.
 */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const

/** Strong ease-in-out — for something already on screen moving to a new place. */
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const

/**
 * Duration budget, in seconds (Framer Motion's unit).
 *
 * UI stays under 300ms: a 190ms dropdown feels more responsive than a 400ms one
 * because the wait, not the travel, is what registers. `section` is the one
 * entry allowed past that ceiling — a scroll-triggered section entrance is
 * explanatory rather than a response to input.
 */
export const DUR = {
  /** Press / release feedback. */
  press: 0.16,
  /** Dropdowns, selects, accordions — anything trigger-anchored. */
  dropdown: 0.19,
  /** Panels and small popovers. */
  panel: 0.24,
  /** Scroll-triggered section entrances. */
  section: 0.3,
} as const

/**
 * Stagger between members of a group entrance, in seconds.
 *
 * The readable band is 30–80ms. Past that the group stops arriving as a group:
 * at the previous 200ms, the third of three stats landed 1.4s after the first.
 */
export const STAGGER = 0.06
