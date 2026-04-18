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
