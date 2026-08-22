/** Locales that use right-to-left text direction. */
const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur']);

/** Returns true when the given locale uses right-to-left direction. */
export function isRTLLocale(locale: string): boolean {
  return RTL_LOCALES.has(locale);
}

/** The default locale (no URL prefix in Next.js routing). */
export const DEFAULT_LOCALE = 'ar';

/** All supported locales. Must match next.config.js i18n.locales. */
export const SUPPORTED_LOCALES = ['ar', 'en'] as const;

/** A supported locale string. */
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Narrow an untrusted language string to a supported locale.
 *
 * `settings.dashboard_language` is a `varchar(10)` the server never validates on
 * read, and it reaches the client through the login response and `GET /settings`.
 * Casting it straight to a locale would let a stale or hand-edited row switch the
 * UI to a language with no message bundle.
 */
export function toSupportedLocale(
  value: string | null | undefined,
  fallback: SupportedLocale = DEFAULT_LOCALE,
): SupportedLocale {
  return SUPPORTED_LOCALES.includes(value as SupportedLocale) ? (value as SupportedLocale) : fallback;
}

/** Returns true if this is the default locale (no URL prefix). */
export function isDefaultLocale(locale: string): boolean {
  return locale === DEFAULT_LOCALE;
}

/** Returns the URL path prefix for a locale. Default locale gets '', others get '/en', '/fr', etc. */
export function getLocalePath(locale: string): string {
  return isDefaultLocale(locale) ? '' : `/${locale}`;
}

/** Get the text direction for a locale. */
export function getLocaleDirection(locale: string): 'rtl' | 'ltr' {
  return isRTLLocale(locale) ? 'rtl' : 'ltr';
}

/** Cycle to the next supported locale. Single place to update when adding languages. */
export function getNextLocale(current: string): SupportedLocale {
  const idx = SUPPORTED_LOCALES.indexOf(current as SupportedLocale);
  return SUPPORTED_LOCALES[(idx + 1) % SUPPORTED_LOCALES.length];
}

/**
 * Intl locale tags for Date / number formatting. `-u-nu-latn` forces Latin
 * digits even in the Arabic UI — product decision to keep numerals consistent
 * across languages. Lives here (not in i18n/hooks) so public pages can format
 * a date without pulling the app store and Capacitor into their bundle.
 */
const INTL_LOCALES: Record<string, string> = { ar: 'ar-SA-u-nu-latn', en: 'en-US' };

/** Get Intl locale string for toLocaleString() / Intl.DateTimeFormat. */
export function getIntlLocale(locale: string): string {
  return INTL_LOCALES[locale] ?? 'en-US';
}

/** Open Graph locale mapping. */
const OG_LOCALE_MAP: Record<string, string> = {
  ar: 'ar_SA',
  en: 'en_US',
};

/** Get the OG locale string for a locale. */
export function getOGLocale(locale: string): string {
  return OG_LOCALE_MAP[locale] ?? 'en_US';
}

/** Get all OG alternate locales (all supported except the current). */
export function getOGAlternateLocales(locale: string): string[] {
  return SUPPORTED_LOCALES
    .filter(l => l !== locale)
    .map(l => OG_LOCALE_MAP[l] ?? 'en_US');
}
