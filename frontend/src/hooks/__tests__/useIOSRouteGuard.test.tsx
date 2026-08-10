import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIOSRouteGuard } from '../useIOSRouteGuard';

/**
 * REGRESSION — App Store Guideline 3.1.1 (2026-08-10).
 *
 * Deleting a page's exported HTML does NOT make its route unreachable: Next
 * serves a client-side navigation from the page's JS chunk, which the
 * build-time strip never touches. Fired on a simulator against a build whose
 * `compare/manychat.html` had been deleted,
 * `com.jawab24.app://compare/manychat` rendered the whole comparison table,
 * prices included. This hook is the runtime block that actually closes the
 * route, so its WIRING — not just the route predicate — has to stay pinned.
 *
 * Only `isIOSNative` is mocked: it is the platform detector, the one thing a
 * jsdom test cannot supply. The hook itself and `isIOSBlockedRoute` run for
 * real, so a change to either is caught here rather than by Apple.
 */
const mockIsIOSNative = vi.fn();
vi.mock('@/lib/capacitor', () => ({
    isIOSNative: () => mockIsIOSNative(),
}));

/** A router whose `events` behaves like Next's mitt emitter. */
function makeRouter() {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
        events: {
            on: (ev: string, fn: (...args: unknown[]) => void) => {
                (handlers[ev] ??= []).push(fn);
            },
            off: (ev: string, fn: (...args: unknown[]) => void) => {
                handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== fn);
            },
            emit: (ev: string, ...args: unknown[]) => {
                for (const h of handlers[ev] ?? []) h(...args);
            },
        },
        /** Drive a navigation the way Next does, returning whether it was cancelled. */
        navigate(url: string): { cancelled: boolean; sawRouteChangeError: boolean } {
            let sawRouteChangeError = false;
            const spy = () => { sawRouteChangeError = true; };
            this.events.on('routeChangeError', spy);
            try {
                this.events.emit('routeChangeStart', url);
                return { cancelled: false, sawRouteChangeError };
            } catch {
                return { cancelled: true, sawRouteChangeError };
            } finally {
                this.events.off('routeChangeError', spy);
            }
        },
        handlerCount: () => (handlers['routeChangeStart'] ?? []).length,
    };
}

let router: ReturnType<typeof makeRouter>;
vi.mock('next/router', () => ({
    useRouter: () => router,
}));

describe('useIOSRouteGuard', () => {
    beforeEach(() => {
        router = makeRouter();
        mockIsIOSNative.mockReset();
    });

    describe('on iOS native', () => {
        beforeEach(() => mockIsIOSNative.mockReturnValue(true));

        it.each([
            '/compare/manychat',   // the route that actually leaked
            '/compare',
            '/blog',
            '/blog/best-auto-reply-tools-2026',
            '/what-is-jawab24',
            '/pricing',
            '/pricing/scale',
            '/checkout',
            '/payment/success',
        ])('cancels navigation to %s', (url) => {
            renderHook(() => useIOSRouteGuard());
            expect(router.navigate(url).cancelled).toBe(true);
        });

        it('emits routeChangeError so Next unwinds the navigation cleanly', () => {
            renderHook(() => useIOSRouteGuard());
            expect(router.navigate('/compare/manychat').sawRouteChangeError).toBe(true);
        });

        it.each([
            '/dashboard',
            '/messages',
            '/settings',
            '/business',
            '/comparefoo',
        ])('leaves the real app route %s alone', (url) => {
            renderHook(() => useIOSRouteGuard());
            expect(router.navigate(url).cancelled).toBe(false);
        });

        it('detaches its listener on unmount', () => {
            const { unmount } = renderHook(() => useIOSRouteGuard());
            expect(router.handlerCount()).toBe(1);
            unmount();
            expect(router.handlerCount()).toBe(0);
            // And with nothing attached, the blocked route is no longer cancelled —
            // proving the assertions above came from THIS hook and not from
            // something else in the harness.
            expect(router.navigate('/compare/manychat').cancelled).toBe(false);
        });
    });

    describe('on Android and web', () => {
        beforeEach(() => mockIsIOSNative.mockReturnValue(false));

        it('attaches nothing at all', () => {
            renderHook(() => useIOSRouteGuard());
            expect(router.handlerCount()).toBe(0);
        });

        it.each(['/compare/manychat', '/blog', '/pricing'])(
            'lets %s through — these routes are legitimate off iOS',
            (url) => {
                renderHook(() => useIOSRouteGuard());
                expect(router.navigate(url).cancelled).toBe(false);
            },
        );
    });
});
