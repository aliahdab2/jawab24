/**
 * The app routes that can show a price, a plan, or a purchase action.
 *
 * App Store Guideline 3.1.1 forbids all of them on iOS. They are defended in
 * three independent places, and this module is the single definition the
 * runtime layers share:
 *
 *  1. Build   — `scripts/neutralize-ios-payment-routes.js` replaces the exported
 *               HTML with a stub, so the markup cannot be painted at all.
 *  2. Routing — the deep-link handler in `_app.tsx` refuses to navigate here on
 *               iOS, so the route is never entered from outside the app.
 *  3. Render  — `useIOSPaymentRedirect` blanks the page and redirects.
 *
 * Layer 3 alone is not sufficient: it is a React guard and cannot act until
 * hydration has run, while the statically-exported HTML carries the prices as
 * plain markup. See the header of the build script for the incident.
 */

/** Route prefixes, without query or hash. Keep in sync with PAYMENT_ROUTES in
 *  `scripts/neutralize-ios-payment-routes.js` — `paymentRoutes.test.ts` fails
 *  if the two drift apart. */
export const PAYMENT_ROUTE_PREFIXES = [
    '/pricing',
    '/checkout',
    '/payment',
] as const;

/**
 * True when `pathOrUrl` addresses a payment surface.
 *
 * Accepts a bare path, a path with query/hash, or an absolute URL. Matching is
 * prefix-based on path segments, so `/pricing` and `/pricing/scale` both match
 * while a route that merely starts with the same letters (`/pricingfoo`) does
 * not.
 */
export function isPaymentRoute(pathOrUrl: string): boolean {
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

    return PAYMENT_ROUTE_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}
