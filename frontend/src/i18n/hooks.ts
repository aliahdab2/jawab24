import { useRouter } from 'next/router';
import { useCallback, useMemo } from 'react';
import { ar, enUS } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { useUIStore } from '@/lib/store';
import { createT, Language, TranslationKey } from './translations';

export { type TranslationKey };

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

// React hook for translations - uses Next.js router locale
export function useTranslation() {
  const router = useRouter();
  const storeLanguage = useUIStore((state) => state.language);

  // Use router locale if available, fallback to store
  const language = (router.locale as Language) || storeLanguage;
  const t = useMemo(() => createT(language), [language]);

  // Function to change language via Next.js routing (memoized to prevent infinite loops)
  const setLanguage = useCallback((newLang: Language) => {
    // Update store explicitly before navigation to support our redirect logic
    useUIStore.getState().setLanguage(newLang);
    router.push(router.pathname, router.asPath, { locale: newLang });
  }, [router]);

  const dateLocale = DATE_LOCALES[language] ?? enUS;
  const intlLocale = INTL_LOCALES[language] ?? 'en-US';

  return { t, language, setLanguage, dateLocale, intlLocale };
}

// Hook to get/set language - uses Next.js router locale
export function useLanguage() {
  const router = useRouter();
  const storeLanguage = useUIStore((state) => state.language);

  const language = (router.locale as Language) || storeLanguage;

  const setLanguage = useCallback((newLang: Language) => {
    useUIStore.getState().setLanguage(newLang);
    router.push(router.pathname, router.asPath, { locale: newLang });
  }, [router]);

  return { language, setLanguage };
}
