import ar from './ar.json';
import en from './en.json';

export type Language = 'ar' | 'en';

// Recursively extract dot-notation keys from a nested object type
type NestedKeyOf<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? NestedKeyOf<T[K], `${Prefix}${K}.`>
    : `${Prefix}${K}`;
}[keyof T & string];

export type TranslationKey = NestedKeyOf<typeof en>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- nested JSON needs any for dict traversal
export const translations: Record<Language, any> = {
  ar,
  en,
};

/** Resolve a dot-notation key against a nested object */
function resolve(obj: Record<string, unknown>, key: string): string | undefined {
  const parts = key.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

// Cached translation functions — one per language, referentially stable
const tCache = new Map<Language, (key: TranslationKey, params?: Record<string, string | number>) => string>();

/**
 * Create (or return cached) translation function with strict key typing.
 * Used by non-React code (_app.tsx meta tags, axiosRetry.ts).
 * React components use useTranslation() from hooks.ts instead.
 */
export function createT(lang: Language) {
  const cached = tCache.get(lang);
  if (cached) return cached;

  const dict = translations[lang];

  const t = function t(key: TranslationKey, params?: Record<string, string | number>): string {
    const translation = resolve(dict, key) || key;

    if (!params) return translation;

    return Object.entries(params).reduce(
      (str, [k, value]) => str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(value)),
      translation,
    );
  };

  tCache.set(lang, t);
  return t;
}

export { ar, en };
