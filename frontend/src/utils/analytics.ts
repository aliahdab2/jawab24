/**
 * Reading the GA4 client id out of the `_ga` cookie.
 *
 * The cookie's value is `GA<version>.<domainDepth>.<clientId>`, where the client
 * id itself is `<random>.<firstSeenTimestamp>` — e.g. `GA1.1.1234567890.1678901234`
 * carries the client id `1234567890.1678901234`. The two leading segments vary
 * with the property version and how many levels deep the cookie's domain is set,
 * so they must be matched loosely and discarded; only the trailing pair is the id
 * the Measurement Protocol wants.
 *
 * This exists because the conversions worth bidding on happen on the SERVER
 * (a page connected, a first auto-reply sent, a subscription paid) while the id
 * that ties them back to the ad click only exists in the browser. See
 * `backend/src/services/ga4.ts`.
 */

/** Matches the `_ga` cookie and captures only the `<random>.<timestamp>` tail. */
const GA_COOKIE_PATTERN = /(?:^|;\s*)_ga=GA\d+\.\d+\.(\d+\.\d+)/;

/**
 * The current GA4 client id, or null when analytics has not set a cookie.
 *
 * Null is a completely normal result, not an error: the tag is loaded with
 * `strategy="lazyOnload"` so the cookie does not exist until the browser goes
 * idle after load, and any privacy blocker suppresses it permanently. Callers
 * must treat null as "skip", never as something to retry into or warn about.
 */
export function getGaClientId(): string | null {
    if (typeof document === 'undefined') return null;
    return document.cookie.match(GA_COOKIE_PATTERN)?.[1] ?? null;
}
