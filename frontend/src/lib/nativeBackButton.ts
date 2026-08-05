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
