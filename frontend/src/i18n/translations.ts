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

// Intl.PluralRules instances per locale (cached)
const pluralRulesCache = new Map<Language, Intl.PluralRules>();

function getPluralRules(lang: Language): Intl.PluralRules {
  const cached = pluralRulesCache.get(lang);
  if (cached) return cached;
  const rules = new Intl.PluralRules(lang);
  pluralRulesCache.set(lang, rules);
  return rules;
}

// Cached translation functions — one per language, referentially stable
const tCache = new Map<Language, (key: TranslationKey, params?: Record<string, string | number>) => string>();

// Create (or return cached) translation function with strict key typing
// Supports ICU-style pluralization via Intl.PluralRules when `count` param is present.
// Plural keys use suffixes: _zero, _one, _two, _few, _many, _other
// Example: "pricing.featurePages_one" = "1 Page", "pricing.featurePages_other" = "{count} Pages"
export function createT(lang: Language) {
  const cached = tCache.get(lang);
  if (cached) return cached;

  const dict = translations[lang];
  const pluralRules = getPluralRules(lang);

  const t = function t(key: TranslationKey, params?: Record<string, string | number>): string {
    let translation: string;

    // Pluralization: when `count` is provided, resolve the plural form
    if (params && typeof params.count === 'number') {
      const category = pluralRules.select(params.count);
      // Try plural key (e.g., "key_one", "key_other"), fall back to base key
      const pluralKey = `${key}_${category}` as TranslationKey;
      const otherKey = `${key}_other` as TranslationKey;
      translation = dict[pluralKey] || dict[otherKey] || dict[key] || key;
    } else {
      translation = dict[key] || key;
    }

    if (!params) return translation;

    return Object.entries(params).reduce(
      (str, [k, value]) => str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(value)),
      translation
    );
  };

  tCache.set(lang, t);
  return t;
}

export { ar, en };

