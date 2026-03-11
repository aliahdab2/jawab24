import { useMemo } from 'react';
import { isNativePlatform } from '@/lib/capacitor';
import { loadAllNamespaces } from '@/i18n/getMessages';

/**
 * On mobile (static export), translations are baked at build time for one locale.
 * This hook reloads the correct messages client-side when language changes,
 * so NextIntlClientProvider always receives the right translations.
 *
 * Returns null on web (server-rendered pages already have correct messages).
 */
export function useMobileMessages(effectiveLocale: string) {
  return useMemo(() => {
    if (!isNativePlatform()) return null;
    return loadAllNamespaces(effectiveLocale);
  }, [effectiveLocale]);
}
