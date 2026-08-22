import { useLocale } from 'next-intl';
import { useRouter } from 'next/router';
import { useCallback } from 'react';
import { ar, enUS } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { useUIStore } from '@/lib/store';
import { isNativePlatform } from '@/lib/capacitor';
import { getLocaleDirection, getIntlLocale } from '@/utils/locale';
export type Language = 'ar' | 'en';

const DATE_LOCALES: Record<string, Locale> = { ar, en: enUS };

/** Get date-fns locale for a language string (standalone, for non-component code) */
export function getDateLocale(language: string): Locale {
  return DATE_LOCALES[language] ?? enUS;
}

// Re-exported for the many existing importers; the mapping itself lives in
// utils/locale so store-free public pages can use it too.
export { getIntlLocale };

/**
 * Hook to get/set language + date/intl locale helpers.
 * Use this in components that need language switching, date formatting,
 * or RTL detection — but NOT for translations (use useTranslations from next-intl).
 */
export function useLanguage() {
  const locale = useLocale();
  const router = useRouter();
  const storeLanguage = useUIStore((state) => state.language);

  const language = (locale || router.locale || storeLanguage) as Language;

  const setLanguage = useCallback(
    (newLang: Language) => {
      useUIStore.getState().setLanguage(newLang);
      if (isNativePlatform()) {
        // Mobile (static export): no i18n routing — update dir/lang directly
        document.documentElement.dir = getLocaleDirection(newLang);
        document.documentElement.lang = newLang;
      } else {
        router.push(router.pathname, router.asPath, { locale: newLang });
      }
    },
    [router],
  );

  const dateLocale = DATE_LOCALES[language] ?? enUS;
  const intlLocale = getIntlLocale(language);

  return { language, setLanguage, dateLocale, intlLocale };
}
