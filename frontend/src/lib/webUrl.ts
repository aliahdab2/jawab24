/**
 * Single source of truth for building absolute URLs into the public
 * jawab24.com web app. Honors the caller's current locale — Arabic is the
 * default (no prefix); English pages live under `/en`.
 *
 * Use this when the native app needs to route users out to the web
 * (e.g. for payments, which are web-only per Google Play / App Store
 * policy). Avoids scattering `https://jawab24.com${...}` string concat
 * across callers.
 */
const WEB_ORIGIN = 'https://jawab24.com';

export function buildWebUrl(path: string, locale: string | undefined): string {
  const localePrefix = locale === 'en' ? '/en' : '';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${WEB_ORIGIN}${localePrefix}${normalizedPath}`;
}

/**
 * Same, for a destination that only works when SIGNED IN — routed via `/login`
 * so the browser can establish its own session first.
 *
 * The native app's session cannot travel with the link: auth is a JWT in
 * `localStorage` and the Capacitor WebView's origin is not `jawab24.com`, so a
 * bare deep link drops the merchant on a logged-out screen. `/login` is not an
 * extra step for someone who already has a browser session — the login page
 * forwards straight to `redirect` when it finds one — so this is strictly
 * better than linking the destination directly.
 *
 * @param path in-app destination, e.g. `/pages`. Encoded into `?redirect=`.
 */
export function buildWebAuthedUrl(path: string, locale: string | undefined): string {
  return buildWebUrl(`/login?redirect=${encodeURIComponent(path)}`, locale);
}
