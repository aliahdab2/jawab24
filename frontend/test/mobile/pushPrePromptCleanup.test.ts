import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The push pre-prompt effect in `_app.tsx` must cancel its own work.
 *
 * The bug this pins: the cleanup was written INSIDE the dynamic import's
 * `.then()` callback —
 *
 *   import('@/lib/notifications').then(({ ... }) => {
 *     const timer = setTimeout(..., 5000);
 *     return () => clearTimeout(timer);   // returned to the promise chain
 *   });
 *
 * — so it was handed to the promise, which discards it. The effect itself
 * returned `undefined`, React had no cleanup to call, and `clearTimeout` never
 * ran. The 5-second timer therefore outlived the effect: it could raise the
 * pre-prompt after logout, and re-runs (the token refreshing) stacked timers.
 *
 * Three separate async steps can resolve after teardown — the dynamic import,
 * and each of the two Preferences reads — so clearing the timer alone is not
 * enough; a cancellation flag has to guard the state setters too.
 *
 * Asserted against the source because the effect early-returns unless
 * `isNativePlatform()`, so it never executes in jsdom. Same approach as
 * nativeInitEffect.test.ts and android-manifest.test.ts.
 */
describe('_app.tsx push pre-prompt effect cleanup', () => {
    let effectBody: string;

    beforeAll(() => {
        const source = readFileSync(path.resolve(__dirname, '../../src/pages/_app.tsx'), 'utf-8');

        // The effect is the one that imports the notifications module and owns
        // the pre-prompt timer.
        const start = source.indexOf('shouldShowNotificationPrePrompt');
        expect(start, 'pre-prompt effect not found — did _app.tsx get restructured?').toBeGreaterThan(-1);

        const effectStart = source.lastIndexOf('useEffect(', start);
        const effectEnd = source.indexOf('}, [', start);
        expect(effectEnd).toBeGreaterThan(effectStart);

        effectBody = source.slice(effectStart, effectEnd);
    });

    it('returns the cleanup from the effect, not from inside .then()', () => {
        // The cleanup must sit at the effect's own top level. The pre-fix shape
        // had `return () => clearTimeout(timer);` indented inside the promise
        // callback, where React can never reach it.
        expect(effectBody).toMatch(/\n {4}return \(\) => \{/);
    });

    it('clears the pre-prompt timer on teardown', () => {
        expect(effectBody).toMatch(/clearTimeout\(timer\)/);
    });

    it('declares the timer in the effect scope so cleanup can see it', () => {
        // `const timer` inside .then() is invisible to a cleanup defined outside
        // it — the declaration has to be hoisted to the effect body.
        expect(effectBody).toMatch(/let timer(:|\s*=|;)/);
    });

    it('guards the async state setters with a cancellation flag', () => {
        // clearTimeout cannot help once the callback is already running: both
        // Preferences reads resolve later and would setState on a torn-down
        // effect.
        expect(effectBody).toMatch(/cancelled = true/);
        expect(effectBody).toMatch(/!cancelled && show\) setShowPushPrompt/);
        expect(effectBody).toMatch(/!cancelled && show\) setShowPushDeniedBanner/);
    });

    it('abandons the import result if the effect was torn down first', () => {
        // The dynamic import itself can resolve after unmount; continuing would
        // register push listeners for a session that is already gone.
        expect(effectBody).toMatch(/if \(cancelled\) return;/);
    });
});
