/**
 * Shared E2E translation helper.
 * Resolves dot-notation keys against nested translation JSON.
 *
 * Usage:
 *   import { t, tAr } from './i18n';
 *   await page.getByText(t('landing.hero.title1'));
 */
import en from '../src/i18n/en.json';
import ar from '../src/i18n/ar.json';

/** Resolve a dot-notation key from a nested object */
function resolve(obj: Record<string, unknown>, key: string): string {
  const parts = key.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return key;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : key;
}

/** Get English translation by dot-notation key */
export function t(key: string): string {
  return resolve(en, key);
}

/** Get Arabic translation by dot-notation key */
export function tAr(key: string): string {
  return resolve(ar as Record<string, unknown>, key);
}

// Re-export raw objects for cases that need direct access
export { en, ar };
