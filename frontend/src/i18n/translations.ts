import ar from './ar.json';
import en from './en.json';

export type Language = 'ar' | 'en';

export const translations = {
  ar,
  en
} as const;

export type TranslationKeys = typeof ar;

// Get nested value from object using dot notation
function getNestedValue(obj: any, path: string): string {
  return path.split('.').reduce((acc, part) => acc && acc[part], obj) || path;
}

// Create translation function
export function createT(lang: Language) {
  return function t(key: string, params?: Record<string, string | number>): string {
    const translation = getNestedValue(translations[lang], key);
    
    if (!params) return translation;
    
    // Replace {param} with actual values
    return Object.entries(params).reduce(
      (str, [key, value]) => str.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value)),
      translation
    );
  };
}

export { ar, en };

