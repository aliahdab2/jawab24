import enErrors from '@/i18n/en/errors.json';
import arErrors from '@/i18n/ar/errors.json';

const ERROR_MESSAGES: Record<string, Record<string, string>> = { en: enErrors, ar: arErrors };

/**
 * Resolve an error translation key using the current page locale.
 * Safe to call outside React — reads lang from document.documentElement.lang.
 */
export function tError(key: string): string {
  const lang = (typeof document !== 'undefined' ? document.documentElement.lang : 'en') || 'en';
  const msgs = ERROR_MESSAGES[lang] ?? ERROR_MESSAGES.en;
  return msgs[key] ?? ERROR_MESSAGES.en[key] ?? key;
}
