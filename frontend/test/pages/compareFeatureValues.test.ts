import { describe, it, expect } from 'vitest';
import { COMPETITORS, FEATURE_KEYS } from '@/data/competitors';
import enCompare from '@/i18n/en/compare.json';
import arCompare from '@/i18n/ar/compare.json';

/**
 * A string in a COMPETITORS feature cell is an i18n key under `compare.val.*`,
 * never display text — `pages/compare/[slug].tsx` resolves it with `t()`. A key
 * with no entry renders as a raw `val.foo` on a public, indexed page, and only
 * in the locale that is missing it. Nothing else covers this: the hub test
 * never renders a comparison table, and `translation:validate` checks en/ar
 * parity, not whether the data layer's keys exist at all.
 */
const LOCALES = { en: enCompare, ar: arCompare } as const;

const stringCells = Object.values(COMPETITORS).flatMap((competitor) =>
  FEATURE_KEYS.flatMap((featureKey) => {
    const feature = competitor.features[featureKey];
    if (!feature) return [];
    return (['jawab24', 'competitor'] as const)
      .filter((side) => typeof feature[side] === 'string')
      .map((side) => ({
        slug: competitor.slug,
        featureKey,
        side,
        valueKey: feature[side] as string,
      }));
  })
);

describe('compare feature values', () => {
  it('has string cells to check (guards against a vacuous pass)', () => {
    expect(stringCells.length).toBeGreaterThan(0);
  });

  it.each(Object.keys(LOCALES) as (keyof typeof LOCALES)[])(
    'resolves every feature-cell key in %s',
    (locale) => {
      const val = LOCALES[locale].val as Record<string, string>;
      const missing = stringCells
        .filter(({ valueKey }) => typeof val?.[valueKey] !== 'string' || val[valueKey].trim() === '')
        .map(({ slug, featureKey, side, valueKey }) => `${slug}.${featureKey}.${side} -> val.${valueKey}`);
      expect(missing).toEqual([]);
    }
  );

  it('never carries literal display text in a feature cell', () => {
    // A key is a bare identifier. Anything with a space, a currency symbol, or
    // a digit-slash is text that would ship untranslated — the bug that put
    // "Subscription + AI credits" on the Arabic page.
    const literals = stringCells
      .filter(({ valueKey }) => !/^[a-zA-Z][a-zA-Z0-9]*$/.test(valueKey))
      .map(({ slug, featureKey, valueKey }) => `${slug}.${featureKey} = "${valueKey}"`);
    expect(literals).toEqual([]);
  });
});
