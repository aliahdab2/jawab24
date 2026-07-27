import { describe, it, expect } from 'vitest';
import { CATALOG_ITEM_TYPES } from '@jawab24/shared';
import { VERTICAL_NAME_EXAMPLES } from './CatalogItemFields';
import en from '@/i18n/en/catalog.json';
import ar from '@/i18n/ar/catalog.json';

/**
 * The add-form name example is chosen by key (`namePlaceholders.<item type>` or
 * `namePlaceholders.<vertical>`), so a key the code asks for but the message file
 * lacks reaches merchants as a raw string — and `translation:validate` cannot
 * catch it, since it only checks en/ar parity, not which keys the code requests.
 * These assertions close both directions of that gap.
 */
describe('namePlaceholders message coverage', () => {
  const locales = { en: en.namePlaceholders as Record<string, string>, ar: ar.namePlaceholders as Record<string, string> };

  it('has an example for every item type, in both locales', () => {
    for (const [locale, messages] of Object.entries(locales)) {
      for (const type of CATALOG_ITEM_TYPES) {
        expect(messages[type], `${locale}: namePlaceholders.${type}`).toBeTruthy();
      }
    }
  });

  it('has an example for every vertical the code claims one for, in both locales', () => {
    for (const [locale, messages] of Object.entries(locales)) {
      for (const vertical of VERTICAL_NAME_EXAMPLES) {
        expect(messages[vertical], `${locale}: namePlaceholders.${vertical}`).toBeTruthy();
      }
    }
  });

  it('carries no orphan examples — every key is a type or a listed vertical', () => {
    const expected = new Set<string>([...CATALOG_ITEM_TYPES, ...VERTICAL_NAME_EXAMPLES]);
    for (const [locale, messages] of Object.entries(locales)) {
      for (const key of Object.keys(messages)) {
        expect(expected.has(key), `${locale}: unused namePlaceholders.${key}`).toBe(true);
      }
    }
  });

  it('gives each listed vertical a DISTINCT example — a duplicate means it should not be listed', () => {
    for (const [locale, messages] of Object.entries(locales)) {
      for (const vertical of VERTICAL_NAME_EXAMPLES) {
        const typeExamples = CATALOG_ITEM_TYPES.map((t) => messages[t]);
        expect(typeExamples, `${locale}: namePlaceholders.${vertical} duplicates a type example`)
          .not.toContain(messages[vertical]);
      }
    }
  });
});
