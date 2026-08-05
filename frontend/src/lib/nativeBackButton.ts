/**
 * Android hardware back button — the decision, separated from the Capacitor
 * plumbing in `_app.tsx` so it can be unit-tested without a native runtime.
 *
 * The press is resolved in three steps, in this order:
 *   1. an open modal/overlay is dismissed (handled by the caller, which owns the
 *      `dismissTopModal()` side effect),
 *   2. otherwise this function decides between leaving the app and going back.
 *
 * `navDepth` counts in-app navigations made during this session, minus the ones
 * already backed out of. It is NOT `window.history.length`, which is a
 * cumulative counter that never resets — deep-linking in can give length 15 with
 * no real back destination.
 *
 * The counter must outlive the effect that registers the listener. When it lived
 * inside that effect it was reset to 0 on every navigation, so `navDepth === 0`
 * held everywhere and back exited the app from every screen.
 */

/** Screens with nothing to go back to — back leaves the app. */
export const ROOT_SCREENS = ['/dashboard', '/login', '/'];

export type BackAction = 'exit' | 'back';

/**
 * @param pathname current route pathname (not asPath — root matching is by route)
 * @param navDepth in-app navigations still available to unwind
 */
export function resolveBackAction(pathname: string, navDepth: number): BackAction {
  if (ROOT_SCREENS.includes(pathname)) return 'exit';
  if (navDepth <= 0) return 'exit';
  return 'back';
}

/**
 * Tracks how many in-app navigations are still available to unwind.
 *
 * The subtlety that makes this a state machine rather than a counter: Next fires
 * `routeChangeComplete` for BACKWARD navigation too — `onPopState` calls
 * `change()`, which emits it (next/dist/shared/lib/router/router.js). So
 * incrementing on every completed navigation counts a back press as a forward
 * one, and the decrement the back handler performs is undone a moment later by
 * the navigation it triggered. The counter then never decreases.
 *
 * `beforePopState` fires first for any history pop and marks the next completion
 * as backward. Because it is driven by the history event rather than by our own
 * handler, it also covers the in-app back buttons that call `router.back()`
 * directly (useUrlSelectedResource, messages.tsx, 404.tsx) and Android's back
 * gesture — none of which pass through the Capacitor listener.
 *
 * Known imprecision, deliberately left: `router.replace()` emits
 * `routeChangeComplete` without adding a history entry, so it counts as +1. The
 * error is in the safe direction — the app over-estimates what it can unwind, so
 * back navigates when it might have exited, and never exits when the user
 * expected to go back.
 */
export interface NavDepthTracker {
  /** Navigations still available to unwind. */
  depth(): number;
  /** A history pop has started — the next completion is backward. */
  markPop(): void;
  /** A navigation completed (routeChangeComplete). */
  settle(): void;
  /** A navigation failed (routeChangeError) — clear any pending pop mark. */
  abort(): void;
}

export function createNavDepthTracker(): NavDepthTracker {
  let depth = 0;
  let popping = false;

  return {
    depth: () => depth,
    markPop: () => { popping = true; },
    settle: () => {
      if (popping) {
        popping = false;
        depth = Math.max(0, depth - 1);
        return;
      }
      depth++;
    },
    abort: () => { popping = false; },
  };
}
