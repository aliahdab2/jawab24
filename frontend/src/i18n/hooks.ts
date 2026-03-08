import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/router';
import { useCallback } from 'react';
import { ar, enUS } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { useUIStore } from '@/lib/store';
import type { Language, TranslationKey } from './translations';

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

/**
 * Compatibility shim: wraps next-intl's useTranslations() but returns the same
 * { t, language, setLanguage, dateLocale, intlLocale } API the codebase expects.
 *
 * ~200 component files import this — ZERO changes needed in consumers.
 */
export function useTranslation() {
  const nextIntlT = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const storeLanguage = useUIStore((state) => state.language);

  // Use next-intl locale (from provider), fallback to router, then store
  const language = (locale || router.locale || storeLanguage) as Language;

  // Wrap next-intl's t() to match existing API: t(key, params?) => string
  // try/catch handles dynamic keys (e.g. `flagReason.${reason}`) that may not exist
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic keys need any
        return nextIntlT(key as any, params as any);
      } catch {
        return key; // Fallback: return the key itself (matches previous behavior)
      }
    },
    [nextIntlT],
  ) as (key: TranslationKey, params?: Record<string, string | number>) => string;

  const setLanguage = useCallback(
    (newLang: Language) => {
      useUIStore.getState().setLanguage(newLang);
      router.push(router.pathname, router.asPath, { locale: newLang });
    },
    [router],
  );

  const dateLocale = DATE_LOCALES[language] ?? enUS;
  const intlLocale = INTL_LOCALES[language] ?? 'en-US';

  return { t, language, setLanguage, dateLocale, intlLocale };
}

// Hook to get/set language — thin wrapper
export function useLanguage() {
  const locale = useLocale();
  const router = useRouter();
  const storeLanguage = useUIStore((state) => state.language);

  const language = (locale || router.locale || storeLanguage) as Language;

  const setLanguage = useCallback(
    (newLang: Language) => {
      useUIStore.getState().setLanguage(newLang);
      router.push(router.pathname, router.asPath, { locale: newLang });
    },
    [router],
  );

  return { language, setLanguage };
}
