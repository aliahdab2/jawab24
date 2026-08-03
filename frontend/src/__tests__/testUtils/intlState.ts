/**
 * Mutable page-locale for the global next-intl mock (test/setup.ts reads it in
 * `useLocale`). Set `intlState.locale = 'ar'` inside a test to simulate the
 * merchant viewing the Arabic UI; the setup file resets it to 'en' before every
 * test. Kept generic (any locale string) — the app is designed to grow beyond
 * the current ar/en pair.
 */
export const intlState = { locale: 'en' };
