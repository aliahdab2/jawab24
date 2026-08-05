import { describe, it, expect } from 'vitest';
import { resolveBackAction, createNavDepthTracker, ROOT_SCREENS } from '@/lib/nativeBackButton';

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

/**
 * The counter's arithmetic had never actually executed before the M1 fix: the
 * effect re-ran on every navigation, so the depth was 0 at every press and the
 * increment/decrement paths were dead. These pin the behaviour now that it is
 * live.
 */
describe('createNavDepthTracker', () => {
  /** routeChangeComplete without a preceding beforePopState = forward nav. */
  const forward = (t: ReturnType<typeof createNavDepthTracker>) => t.settle();
  /** beforePopState then routeChangeComplete = backward nav. */
  const backward = (t: ReturnType<typeof createNavDepthTracker>) => { t.markPop(); t.settle(); };

  it('starts empty', () => {
    expect(createNavDepthTracker().depth()).toBe(0);
  });

  it('counts forward navigations', () => {
    const t = createNavDepthTracker();
    forward(t); forward(t); forward(t);
    expect(t.depth()).toBe(3);
  });

  it('unwinds on backward navigation', () => {
    const t = createNavDepthTracker();
    forward(t); forward(t);
    backward(t);
    expect(t.depth()).toBe(1);
    backward(t);
    expect(t.depth()).toBe(0);
  });

  it('is the regression case: a back press must not net to zero', () => {
    // Next emits routeChangeComplete for pops too. Treating that completion as a
    // forward navigation cancels the decrement, so the depth never falls and
    // back stops being able to exit from a non-root screen.
    const t = createNavDepthTracker();
    forward(t);          // dashboard → settings
    expect(t.depth()).toBe(1);
    backward(t);         // back to dashboard
    expect(t.depth()).toBe(0);
  });

  it('never goes below zero', () => {
    const t = createNavDepthTracker();
    backward(t); backward(t);
    expect(t.depth()).toBe(0);
  });

  it('clears the pop mark when a navigation fails, so the next forward nav still counts', () => {
    const t = createNavDepthTracker();
    forward(t);
    t.markPop();
    t.abort();           // routeChangeError — the pop never completed
    forward(t);
    expect(t.depth()).toBe(2);
  });

  it('consumes the pop mark once, not for every later navigation', () => {
    const t = createNavDepthTracker();
    forward(t); forward(t);
    backward(t);
    forward(t);
    expect(t.depth()).toBe(2);
  });

  it('survives the full dashboard → comments → messages → back → back walk', () => {
    const t = createNavDepthTracker();
    forward(t); forward(t);
    expect(resolveBackAction('/messages', t.depth())).toBe('back');
    backward(t);
    expect(resolveBackAction('/comments', t.depth())).toBe('back');
    backward(t);
    // Landed on a root screen with nothing left to unwind — back leaves the app.
    expect(t.depth()).toBe(0);
    expect(resolveBackAction('/dashboard', t.depth())).toBe('exit');
  });
});
