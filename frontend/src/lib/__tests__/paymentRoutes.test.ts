import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isPaymentRoute, PAYMENT_ROUTE_PREFIXES } from '../paymentRoutes';

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
});

describe('build-script parity (Guideline 3.1.1)', () => {
    // The Node build script cannot import this TS module, so the route list is
    // stated twice by necessity. This test is what stops the two drifting: a
    // route neutralized at build time but not refused at runtime (or vice
    // versa) is a hole, and holes here are App Store rejections.
    const scriptSource = fs.readFileSync(
        path.join(__dirname, '..', '..', '..', 'scripts', 'neutralize-ios-payment-routes.js'),
        'utf8',
    );

    const scriptRoutes = (() => {
        const block = scriptSource.match(/const PAYMENT_ROUTES = \[([\s\S]*?)\];/);
        if (!block) throw new Error('PAYMENT_ROUTES not found in the build script');
        return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    })();

    it('finds the route list in the build script', () => {
        expect(scriptRoutes.length).toBeGreaterThan(0);
    });

    it('refuses every route the build script neutralizes', () => {
        for (const htmlPath of scriptRoutes) {
            const route = `/${htmlPath.replace(/\.html$/, '')}`;
            expect(isPaymentRoute(route), `${htmlPath} is stubbed at build time but allowed at runtime`).toBe(true);
        }
    });

    it('neutralizes at least one route under every prefix it refuses', () => {
        for (const prefix of PAYMENT_ROUTE_PREFIXES) {
            const covered = scriptRoutes.some((htmlPath) => `/${htmlPath}`.startsWith(prefix));
            expect(covered, `no exported HTML is stubbed for ${prefix}`).toBe(true);
        }
    });
});
