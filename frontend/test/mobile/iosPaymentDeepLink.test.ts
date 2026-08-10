/**
 * Wiring invariant: the deep-link handler in `_app.tsx` must refuse payment
 * routes on iOS (App Store Guideline 3.1.1).
 *
 * The handler is defined inside a `useEffect` that early-returns unless
 * `isNativePlatform()`, so it never executes in jsdom and no runtime test can
 * observe it. This repo's established answer for that shape (set by PR #641)
 * is two-part: unit-test the pure decision — `isPaymentRoute`, covered in
 * `src/lib/__tests__/paymentRoutes.test.ts` — and assert the wiring against the
 * SOURCE TEXT here, the way `android-manifest.test.ts` reads the manifest.
 *
 * What this protects: `handleDeepLink` returns a slug that is handed straight
 * to `router.push`, with only a host whitelist in between. Before this guard,
 * `com.jawab24.app://pricing/scale` navigated the iOS app into a live plan grid
 * — reproduced on a simulator on 2026-08-10.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'pages', '_app.tsx'),
    'utf8',
);

// Comments are stripped first: the prose in this file discusses the very
// identifiers being asserted, and a commented-out guard must not count as a
// live one (the trap recorded in the M3 offline-banner guard).
const code = appSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('iOS payment deep-link guard (Guideline 3.1.1)', () => {
    it('imports the shared blocked-route predicate', () => {
        // Widened from isPaymentRoute on 2026-08-10: the deep-link handler must
        // also refuse the marketing routes that quote prices (/compare, /blog,
        // /what-is-jawab24), not only purchase surfaces. isIOSBlockedRoute is
        // the union; asserting the NARROW predicate here would now pass while
        // com.jawab24.app://compare/manychat sailed through.
        expect(code).toMatch(/import\s*\{\s*isIOSBlockedRoute\s*\}\s*from\s*['"]@\/lib\/paymentRoutes['"]/);
    });

    it('imports isIOSNative, not just isNativePlatform', () => {
        // Android may legitimately reach these routes; the guard must be
        // iOS-only or it would break Android's upgrade path.
        expect(code).toMatch(/isIOSNative/);
    });

    it('refuses a blocked slug on iOS inside handleDeepLink', () => {
        expect(code).toMatch(/isIOSNative\(\)\s*&&\s*isIOSBlockedRoute\(\s*slug\s*\)/);
    });

    it('returns null on refusal rather than navigating somewhere', () => {
        expect(code).toMatch(/isIOSNative\(\)\s*&&\s*isIOSBlockedRoute\(\s*slug\s*\)\s*\)\s*return null/);
    });

    it('applies the guard before the slug can reach router.push', () => {
        const guardAt = code.search(/isIOSBlockedRoute\(\s*slug\s*\)/);
        const pushAt = code.search(/\.push\(\s*slug\s*\)/);
        expect(guardAt).toBeGreaterThan(-1);
        expect(pushAt).toBeGreaterThan(-1);
        expect(guardAt).toBeLessThan(pushAt);
    });

    it('also mounts the app-wide route guard, which the deep-link check cannot replace', () => {
        // handleDeepLink only sees links arriving from OUTSIDE the app. An
        // in-app <Link> or router.push goes straight past it, and deleting the
        // page's HTML does not stop that — Next serves the client-side
        // navigation from the page's JS chunk. useIOSRouteGuard is the layer
        // that closes it; losing the call here would reopen the hole silently.
        expect(code).toMatch(/useIOSRouteGuard\(\)/);
        expect(code).toMatch(/import\s*\{\s*useIOSRouteGuard\s*\}\s*from\s*['"]@\/hooks\/useIOSRouteGuard['"]/);
    });
});
