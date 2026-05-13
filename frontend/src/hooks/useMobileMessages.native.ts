import { useMemo } from 'react';
import { isNativePlatform } from '@/lib/capacitor';
import { loadAllNamespaces } from '@/i18n/getMessages';

/**
 * Native-only implementation. Wired in by webpack alias in `next.config.js`
 * when `IS_MOBILE_BUILD === 'true'` (see `build:mobile` script).
 *
 * On mobile (static export), translations are baked at build time for one
 * locale. This hook reloads the correct messages client-side when the user
 * switches language, so NextIntlClientProvider always receives the right
 * translations — synchronously, with no first-paint flicker.
 */
export function useMobileMessages(effectiveLocale: string) {
  return useMemo(() => {
    if (!isNativePlatform()) return null;
    return loadAllNamespaces(effectiveLocale);
  }, [effectiveLocale]);
}
