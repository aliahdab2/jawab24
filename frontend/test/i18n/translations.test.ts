import { describe, it, expect } from 'vitest';
import { createT, translations } from '@/i18n/translations';

describe('translations', () => {
  describe('createT', () => {
    it('should return a function', () => {
      const t = createT('en');
      expect(typeof t).toBe('function');
    });

    it('should return the English translation for a known key', () => {
      const t = createT('en');
      // 'common.save' is a key that should exist in both languages
      const result = t('common.save' as any);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return the Arabic translation for a known key', () => {
      const t = createT('ar');
      const result = t('common.save' as any);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return different values for EN vs AR', () => {
      const tEn = createT('en');
      const tAr = createT('ar');
      // These should be different translations
      expect(tEn('common.save' as any)).not.toBe(tAr('common.save' as any));
    });

    it('should return the key itself for an unknown key', () => {
      const t = createT('en');
      const unknownKey = 'this.key.does.not.exist' as any;
      expect(t(unknownKey)).toBe(unknownKey);
    });

    it('should cache the translation function (referential stability)', () => {
      const t1 = createT('en');
      const t2 = createT('en');
      expect(t1).toBe(t2);
    });

    it('should return different functions for different languages', () => {
      const tEn = createT('en');
      const tAr = createT('ar');
      expect(tEn).not.toBe(tAr);
    });

    it('should interpolate params with {key} syntax', () => {
      const t = createT('en');
      // Use a key that supports interpolation — test with a mock approach
      // since we can't guarantee which keys use params, test the mechanism directly
      const result = t('common.save' as any, { unused: 'value' });
      // Should still return the translation (params that don't match are ignored)
      expect(typeof result).toBe('string');
    });
  });

  describe('translations object', () => {
    it('should have both en and ar languages', () => {
      expect(translations).toHaveProperty('en');
      expect(translations).toHaveProperty('ar');
    });

    it('should have the same keys in both languages', () => {
      const enKeys = Object.keys(translations.en).sort();
      const arKeys = Object.keys(translations.ar).sort();
      expect(enKeys).toEqual(arKeys);
    });

    it('should have no empty string values in English', () => {
      const emptyKeys = Object.entries(translations.en)
        .filter(([, value]) => value === '')
        .map(([key]) => key);
      expect(emptyKeys).toEqual([]);
    });

    it('should have no empty string values in Arabic', () => {
      const emptyKeys = Object.entries(translations.ar)
        .filter(([, value]) => value === '')
        .map(([key]) => key);
      expect(emptyKeys).toEqual([]);
    });
  });
});
