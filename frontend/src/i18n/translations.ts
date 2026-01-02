import ar from './ar.json';
import en from './en.json';

export type Language = 'ar' | 'en';

// Define the shape of our dictionary based on English
export type TranslationDictionary = typeof en;
export type TranslationKey = keyof TranslationDictionary;

// Strict typing for the translations object
export const translations: Record<Language, TranslationDictionary> = {
  ar: ar as TranslationDictionary,
  en,
};

// Create translation function with strict key typing
export function createT(lang: Language) {
  const dict = translations[lang];

  return function t(key: TranslationKey, params?: Record<string, string | number>): string {
    const translation = dict[key] || key;

    if (!params) return translation;

    return Object.entries(params).reduce(
      (str, [k, value]) => str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(value)),
      translation
    );
  };
}

export { ar, en };

