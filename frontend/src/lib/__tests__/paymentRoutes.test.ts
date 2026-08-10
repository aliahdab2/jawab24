import { describe, it, expect } from 'vitest';
import { isPaymentRoute, isIOSBlockedRoute, PAYMENT_ROUTE_PREFIXES, WEB_ONLY_ROUTE_PREFIXES } from '../paymentRoutes';
import { SUPPORTED_LOCALES } from '@/utils/locale';
// The build script is plain CJS so it can run under bare node; importing it
// here means the test exercises the SAME code the build runs, rather than a
// description of it.
import neutralizer from '../../../scripts/neutralize-ios-payment-routes.js';

describe('isPaymentRoute', () => {
    it.each([
        '/pricing',
        '/pricing/scale',
        '/checkout',
        '/payment/success',
        '/payment/cancel',
        '/payment/return',
    ])('matches the payment surface %s', (route) => {
        expect(isPaymentRoute(route)).toBe(true);
    });

    it.each([
        '/dashboard',
        '/messages',
        '/settings',
        '/business',
        '/auth/app-sync',
        '/',
    ])('leaves the ordinary route %s alone', (route) => {
        expect(isPaymentRoute(route)).toBe(false);
    });

    it('ignores query strings and hashes', () => {
        expect(isPaymentRoute('/checkout?planId=abc&interval=month')).toBe(true);
        expect(isPaymentRoute('/pricing/scale#plans')).toBe(true);
        expect(isPaymentRoute('/dashboard?upgrade=1')).toBe(false);
    });

    it('matches on path segments, not string prefixes', () => {
        // A future route that merely starts with the same letters must not be
        // swallowed — that would silently break a non-payment page on iOS.
        expect(isPaymentRoute('/pricingfoo')).toBe(false);
        expect(isPaymentRoute('/payments-report')).toBe(false);
    });

    it('accepts the absolute URL forms a deep link can arrive as', () => {
        expect(isPaymentRoute('https://jawab24.com/pricing/scale')).toBe(true);
        expect(isPaymentRoute('com.jawab24.app://checkout')).toBe(true);
        expect(isPaymentRoute('https://jawab24.com/dashboard')).toBe(false);
    });

    it('tolerates trailing slashes and empty input', () => {
        expect(isPaymentRoute('/pricing/')).toBe(true);
        expect(isPaymentRoute('')).toBe(false);
    });

    // The web build serves locale-prefixed routes (next.config.js i18n.locales)
    // while the mobile export drops them, and the live AASA lists both
    // /auth/callback and /en/auth/callback — so both shapes reach the handler.
    describe('locale-prefixed paths', () => {
        it.each(SUPPORTED_LOCALES)('matches /%s/pricing', (locale) => {
            expect(isPaymentRoute(`/${locale}/pricing`)).toBe(true);
            expect(isPaymentRoute(`/${locale}/pricing/scale`)).toBe(true);
            expect(isPaymentRoute(`com.jawab24.app://${locale}/checkout`)).toBe(true);
        });

        it.each(SUPPORTED_LOCALES)('leaves /%s/dashboard and the bare locale alone', (locale) => {
            expect(isPaymentRoute(`/${locale}/dashboard`)).toBe(false);
            expect(isPaymentRoute(`/${locale}`)).toBe(false);
        });
    });
});

describe('isIOSBlockedRoute — marketing pages that quote prices', () => {
    // REGRESSION (2026-08-10). These pages were "handled" by deleting their
    // exported HTML in the mobile build. That does NOT close the route: Next
    // serves a client-side navigation from the page's JS chunk under
    // _next/static/, which the strip never touches. Fired on a simulator,
    // com.jawab24.app://compare/manychat rendered the whole comparison table —
    // "باقة Starter في جواب24 بـ 15 دولاراً شهرياً" — from a build whose
    // compare/manychat.html had been deleted. The route has to be blocked at
    // RUNTIME; the strip only removes the static paint.
    it.each([
        '/compare',
        '/compare/manychat',
        '/compare/tidio',
        '/blog',
        '/blog/best-auto-reply-tools-2026',
        '/what-is-jawab24',
    ])('blocks the priced marketing route %s', (route) => {
        expect(isIOSBlockedRoute(route)).toBe(true);
    });

    it('still blocks every payment surface', () => {
        for (const route of ['/pricing', '/pricing/scale', '/checkout', '/payment/success']) {
            expect(isIOSBlockedRoute(route)).toBe(true);
        }
    });

    it('leaves the real app routes alone', () => {
        for (const route of ['/dashboard', '/messages', '/settings', '/business', '/', '/comparefoo']) {
            expect(isIOSBlockedRoute(route)).toBe(false);
        }
    });

    it('handles the custom-scheme deep link shape the incident used', () => {
        expect(isIOSBlockedRoute('com.jawab24.app://compare/manychat')).toBe(true);
        expect(isIOSBlockedRoute('com.jawab24.app://dashboard')).toBe(false);
    });

    it('strips a locale prefix, as the web build and AASA both emit', () => {
        expect(isIOSBlockedRoute('/ar/compare/manychat')).toBe(true);
        expect(isIOSBlockedRoute('/en/blog')).toBe(true);
    });

    it('keeps the two prefix lists disjoint — a route belongs to exactly one', () => {
        // They are treated differently by the build (stub vs strip), so an
        // overlap would make the build's behaviour depend on list order.
        const overlap = WEB_ONLY_ROUTE_PREFIXES.filter((p) => PAYMENT_ROUTE_PREFIXES.includes(p));
        expect(overlap).toEqual([]);
    });

    it('does not widen isPaymentRoute — the build must still only STUB purchase surfaces', () => {
        expect(isPaymentRoute('/compare/manychat')).toBe(false);
        expect(isPaymentRoute('/blog')).toBe(false);
    });
});

describe('build script ↔ runtime agreement (Guideline 3.1.1)', () => {
    // Both sides read src/config/payment-routes.json, so there is no list to
    // keep in sync — these assert that they genuinely agree rather than merely
    // both existing.
    it('classifies routes identically to the build script', () => {
        const cases = [
            '/pricing', '/pricing/scale', '/checkout', '/payment/success',
            '/dashboard', '/messages', '/', '/pricingfoo',
            '/en/pricing', '/ar/checkout', '/en/dashboard',
        ];
        for (const route of cases) {
            expect(neutralizer.isPaymentRoute(route), `disagreement on ${route}`)
                .toBe(isPaymentRoute(route));
        }
    });

    it('maps exported files back to the routes the runtime guards', () => {
        expect(neutralizer.routeOf.length).toBeGreaterThan(0);
        expect(PAYMENT_ROUTE_PREFIXES.length).toBeGreaterThan(0);
    });

    it('derives currency markers from ICU rather than hardcoding copy', () => {
        const markers = neutralizer.currencyMarkers();
        expect(markers.length).toBeGreaterThan(0);
        // NOT `length >= 2`: that pinned the defect, making a bare "$" — the
        // commonest price marker there is — inexpressible, so the gate passed a
        // bundle whose compare/* pages rendered "$15/mo" (2026-08-10). What
        // keeps a short marker safe is the digit-adjacency the scan requires.
        expect(markers).toContain('$');
        expect(neutralizer.pricePattern(markers).test('$15/mo')).toBe(true);
        expect(neutralizer.pricePattern(markers).test('a lone $ in prose')).toBe(false);
    });

    it('emits a stub that carries the marker the Xcode phase greps for', () => {
        const stub = neutralizer.stub('/pricing');
        expect(stub).toContain(neutralizer.STUB_MARKER);
        expect(stub).toContain("location.replace('/')");
        // A stub that leaked a price would defeat the whole exercise.
        for (const m of neutralizer.currencyMarkers()) expect(stub).not.toContain(m);
    });
});
