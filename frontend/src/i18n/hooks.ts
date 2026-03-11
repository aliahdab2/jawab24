import { useLocale } from 'next-intl';
import { useRouter } from 'next/router';
import { useCallback } from 'react';
import { ar, enUS } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { useUIStore } from '@/lib/store';
import { isNativePlatform } from '@/lib/capacitor';
export type Language = 'ar' | 'en';

const DATE_LOCALES: Record<string, Locale> = { ar, en: enUS };
const INTL_LOCALES: Record<string, string> = { ar: 'ar-SA', en: 'en-US' };

/** Get date-fns locale for a language string (standalone, for non-component code) */
export function getDateLocale(language: string): Locale {
  return DATE_LOCALES[language] ?? enUS;
}

/** Get Intl locale string for toLocaleString() (standalone, for non-component code) */
export function getIntlLocale(language: string): string {
  return INTL_LOCALES[language] ?? 'en-US';
}

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
        document.documentElement.dir = newLang === 'ar' ? 'rtl' : 'ltr';
        document.documentElement.lang = newLang;
      } else {
        router.push(router.pathname, router.asPath, { locale: newLang });
      }
    },
    [router],
  );

  const dateLocale = DATE_LOCALES[language] ?? enUS;
  const intlLocale = INTL_LOCALES[language] ?? 'en-US';

  return { language, setLanguage, dateLocale, intlLocale };
}
