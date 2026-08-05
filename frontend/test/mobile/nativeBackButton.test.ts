import { describe, it, expect } from 'vitest';
import { resolveBackAction, ROOT_SCREENS } from '@/lib/nativeBackButton';

/**
 * Android hardware back button semantics.
 *
 * History: the native init effect in `_app.tsx` listed `router` in its
 * dependency array. `useRouter()` has no stable identity in the pages router
 * (next/dist/client/index.js renders the provider with
 * `value={makePublicRouterInstance(router)}`, a fresh object every call), so the
 * effect re-ran on every navigation and the `navDepth` counter that lived inside
 * it was reset to 0 each time. `navDepth === 0` therefore held on every screen
 * and back exited the app from settings, leads, business info — everywhere.
 * Fixed 2026-08-05: the counter is a ref on the component, and the effect no
 * longer depends on `router`. See nativeInitEffect.test.ts for that half.
 */
describe('resolveBackAction', () => {
  it('exits from every root screen regardless of depth', () => {
    for (const root of ROOT_SCREENS) {
      expect(resolveBackAction(root, 0)).toBe('exit');
      expect(resolveBackAction(root, 5)).toBe('exit');
    }
  });

  it('exits from a non-root screen only when no navigation has happened', () => {
    expect(resolveBackAction('/settings', 0)).toBe('exit');
  });

  it('goes back from a non-root screen once the user has navigated', () => {
    expect(resolveBackAction('/settings', 1)).toBe('back');
    expect(resolveBackAction('/leads', 3)).toBe('back');
    expect(resolveBackAction('/business', 1)).toBe('back');
  });

  it('is the regression case: depth survives navigation, so back does not exit', () => {
    // dashboard → comments → settings leaves depth at 2. Before the fix the
    // counter was back to 0 here and this returned 'exit'.
    expect(resolveBackAction('/settings', 2)).toBe('back');
  });

  it('treats a negative depth as exhausted rather than going back', () => {
    expect(resolveBackAction('/settings', -1)).toBe('exit');
  });
});
