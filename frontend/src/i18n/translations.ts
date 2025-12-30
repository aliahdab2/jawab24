import ar from './ar.json';
import en from './en.json';

export type Language = 'ar' | 'en';

// Flat key translations - O(1) lookup performance
export const translations: Record<Language, Record<string, string>> = {
  ar,
  en
};

export type TranslationKeys = keyof typeof ar;

// Create translation function with direct O(1) lookup
export function createT(lang: Language) {
  const dict = translations[lang];
  
  return function t(key: string, params?: Record<string, string | number>): string {
    // Direct lookup - no traversal needed (flat keys)
    const translation = dict[key] ?? key;
    
    if (!params) return translation;
    
    // Replace {param} with actual values
    return Object.entries(params).reduce(
      (str, [k, value]) => str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(value)),
      translation
    );
  };
}

export { ar, en };

