/**
 * Web stub. Returns null because server-rendered pages already deliver the
 * correct translations via `pageProps.messages` from `makeGetStaticProps`.
 *
 * Native mobile builds (Capacitor static export) get a different
 * implementation through a webpack alias configured in `next.config.js`:
 *   `@/hooks/useMobileMessages` → `@/hooks/useMobileMessages.native`
 *
 * This split keeps `@/i18n/getMessages` and its ~150 kB of namespace JSONs
 * out of the web client bundle entirely.
 */
export function useMobileMessages(_effectiveLocale: string): null {
  return null;
}
