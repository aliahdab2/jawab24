import paymentRoutesConfig from '@/config/payment-routes.json';
import { SUPPORTED_LOCALES } from '@/utils/locale';

/**
 * The app routes that can show a price, a plan, or a purchase action.
 *
 * App Store Guideline 3.1.1 forbids all of them on iOS. They are defended in
 * three independent places:
 *
 *  1. Build   — `scripts/neutralize-ios-payment-routes.js` replaces the exported
 *               HTML with a stub, so the markup cannot be painted at all, and an
 *               Xcode build phase fails the archive if that did not happen.
 *  2. Routing — the deep-link handler in `_app.tsx` refuses to navigate here on
 *               iOS, so the route is never entered from outside the app.
 *  3. Render  — `useIOSPaymentRedirect` blanks the page and redirects.
 *
 * Layer 3 alone is not sufficient: it is a React guard and cannot act until
 * hydration has run, while the statically-exported HTML carries the prices as
 * plain markup. See the header of the build script for the incident.
 *
 * The prefix list lives in `config/payment-routes.json` because the Node build
 * script cannot import TypeScript — that file is the single source of truth for
 * both sides, so there is no list to keep in sync.
 */
export const PAYMENT_ROUTE_PREFIXES: readonly string[] = paymentRoutesConfig.prefixes;

/**
 * Marketing routes that quote prices in prose — comparison tables, blog posts,
 * the explainer page. They are not purchase surfaces, so they are not in
 * PAYMENT_ROUTE_PREFIXES, but Guideline 3.1.1 does not care about the
 * distinction: a reviewer who reaches them sees "15 دولاراً شهرياً".
 *
 * ⚠️ DELETING THEIR HTML IS NOT ENOUGH, and this cost a build to learn.
 * `strip-mobile-assets.js` removes `blog/`, `compare/` and `what-is-jawab24`
 * from the export, which kills the static paint — but Next serves a
 * CLIENT-SIDE navigation from the page's JS chunk under `_next/static/`, which
 * the strip never touches. On 2026-08-10, `com.jawab24.app://compare/manychat`
 * rendered the full comparison table, prices and all, on a simulator running a
 * build whose `compare/manychat.html` had been deleted. The strip and this
 * runtime block are complementary, and neither alone closes the route.
 */
export const WEB_ONLY_ROUTE_PREFIXES: readonly string[] = paymentRoutesConfig.webOnlyPrefixes;

/**
 * True when `pathOrUrl` addresses a payment surface.
 *
 * Accepts a bare path, a path with query/hash, or an absolute URL (http(s) or
 * the app's custom scheme). A leading locale segment is stripped first: the web
 * build serves `/en/pricing` (next.config.js `i18n.locales`) while the mobile
 * export has no locale prefix, and deep links can carry either shape — the
 * live AASA lists both `/auth/callback` and `/en/auth/callback`.
 *
 * Matching is on whole path segments, so `/pricing` and `/pricing/scale` match
 * while `/pricingfoo` does not.
 */
export function isPaymentRoute(pathOrUrl: string): boolean {
    return matchesPrefix(pathOrUrl, PAYMENT_ROUTE_PREFIXES);
}

/**
 * True when `pathOrUrl` addresses anything iOS must not render — a purchase
 * surface OR a marketing page that quotes prices. This is the predicate the
 * routing layers should use; `isPaymentRoute` stays narrower because the build
 * script treats the two lists differently (stub vs strip).
 */
export function isIOSBlockedRoute(pathOrUrl: string): boolean {
    return matchesPrefix(pathOrUrl, PAYMENT_ROUTE_PREFIXES)
        || matchesPrefix(pathOrUrl, WEB_ONLY_ROUTE_PREFIXES);
}

function matchesPrefix(pathOrUrl: string, prefixes: readonly string[]): boolean {
    if (!pathOrUrl) return false;

    let pathname = pathOrUrl;
    if (/^https?:\/\//i.test(pathname)) {
        try {
            pathname = new URL(pathname).pathname;
        } catch {
            return false;
        }
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pathname)) {
        // Custom scheme (com.jawab24.app://checkout). `new URL` would read
        // "checkout" as the HOST and leave the path empty, so the route would
        // slip through. Everything after the scheme is the path here.
        pathname = `/${pathname.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')}`;
    }

    // Drop query and hash, then any trailing slash (but keep the root '/').
    pathname = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';

    // Strip a leading locale segment: /en/pricing -> /pricing.
    for (const locale of SUPPORTED_LOCALES) {
        if (pathname === `/${locale}`) return false;
        if (pathname.startsWith(`/${locale}/`)) {
            pathname = pathname.slice(locale.length + 1);
            break;
        }
    }

    return prefixes.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}
