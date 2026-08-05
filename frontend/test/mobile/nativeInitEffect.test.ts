import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The native init effect in `_app.tsx` must run once per mount — never per
 * navigation.
 *
 * It tears down and re-registers the Android back listener, the app-state
 * listener, the network listener and the keyboard listeners, and it re-runs
 * `SplashScreen.hide()`, `Network.getStatus()` and `setupKeyboard()`. Re-running
 * it on navigation caused:
 *   - back exiting the app from every screen (`navDepth` reset to 0),
 *   - `setupKeyboard()` re-capturing its `baseline` from an already-shrunken
 *     viewport when the user navigated with the keyboard open,
 *   - duplicate handlers when two fast navigations raced.
 *
 * The trap is that `useRouter()` looks stable and is not: the pages router
 * renders its provider with `value={makePublicRouterInstance(router)}`
 * (next/dist/client/index.js), which returns a fresh object on every call, and
 * `AppContainer` re-renders on every navigation. So listing `router` in the
 * dependency array silently re-runs the whole block.
 *
 * This is asserted against the source because the effect is gated behind
 * `isNativePlatform()` — none of it executes in jsdom, so no runtime test can
 * observe the regression. Same approach as android-manifest.test.ts.
 */
describe('_app.tsx native init effect', () => {
  let source: string;
  let effectBody: string;
  let deps: string[];

  beforeAll(() => {
    const appPath = path.resolve(__dirname, '../../src/pages/_app.tsx');
    source = readFileSync(appPath, 'utf-8');

    const start = source.indexOf('const initNativePlatform');
    expect(start, 'initNativePlatform not found — did _app.tsx get restructured?').toBeGreaterThan(-1);

    // First `}, [...]);` after the declaration closes the effect.
    const close = /\n\s*\}, \[([^\]]*)\]\);/.exec(source.slice(start));
    expect(close, 'could not locate the dependency array of the native init effect').not.toBeNull();

    effectBody = source.slice(start, start + close!.index);
    deps = close![1].split(',').map((d) => d.trim()).filter(Boolean);
  });

  it('does not depend on router — useRouter() has no stable identity', () => {
    expect(deps).not.toContain('router');
    expect(deps).not.toContain('routerRef');
  });

  it('depends only on values with a stable identity', () => {
    // hasHydrated is a boolean that flips once; queryClient comes from
    // useState(() => new QueryClient()) and never changes. Anything added here
    // must be equally stable, or the effect starts re-running again.
    expect(deps).toEqual(['hasHydrated', 'queryClient']);
  });

  it('keeps the back-button nav counter outside the effect so it survives a re-run', () => {
    expect(effectBody).not.toMatch(/\b(let|const|var)\s+navDepth\b/);
    expect(effectBody).toContain('navDepthRef.current');
    // Declared at component scope, as a ref.
    expect(source).toMatch(/const navDepthRef = useRef\(createNavDepthTracker\(\)\)/);
  });

  it('marks history pops so the depth can actually decrease', () => {
    // Next emits routeChangeComplete for backward navigation too. Without
    // beforePopState the back handler's decrement is cancelled by the increment
    // from the navigation it triggered, and the depth never falls.
    expect(effectBody).toContain('beforePopState');
    expect(effectBody).toContain('markPop()');
    // The handler must not also decrement — that is the double-count.
    expect(effectBody).not.toMatch(/navDepthRef\.current\s*=/);
    expect(effectBody).not.toMatch(/navTracker\.depth\(\)\s*-\s*1/);
  });

  it('clears a pending pop mark when a navigation fails', () => {
    expect(effectBody).toContain("'routeChangeError'");
    expect(effectBody).toContain('abort()');
  });

  it('reads the router through the ref, so the live router is always in hand', () => {
    expect(effectBody).toContain('routerRef.current.events.on');
    // The only bare `router` inside the body is the local alias of routerRef.current
    // used by the back handler; nothing may capture the outer binding.
    const bareRouterUses = effectBody.match(/(?<![A-Za-z])router\.(?!current)/g) ?? [];
    const aliasedUses = (effectBody.match(/const router = routerRef\.current;/g) ?? []).length;
    expect(aliasedUses, 'back handler should alias routerRef.current').toBe(1);
    // pathname + back() are the alias's only two uses.
    expect(bareRouterUses.length).toBeLessThanOrEqual(2);
  });
});
