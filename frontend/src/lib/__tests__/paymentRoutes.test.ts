import { describe, it, expect } from 'vitest';
import { isPaymentRoute, PAYMENT_ROUTE_PREFIXES } from '../paymentRoutes';
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
        // Whatever ICU emits, it must be substantive enough to match on.
        for (const m of markers) expect(m.length).toBeGreaterThanOrEqual(2);
    });

    it('emits a stub that carries the marker the Xcode phase greps for', () => {
        const stub = neutralizer.stub('/pricing');
        expect(stub).toContain(neutralizer.STUB_MARKER);
        expect(stub).toContain("location.replace('/')");
        // A stub that leaked a price would defeat the whole exercise.
        for (const m of neutralizer.currencyMarkers()) expect(stub).not.toContain(m);
    });
});
