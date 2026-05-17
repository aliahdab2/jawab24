import { describe, it, expect, vi } from 'vitest';
import { getDateLocale, getIntlLocale } from '@/i18n/hooks';

// Mock store to prevent Zustand initialization issues
vi.mock('@/lib/store', () => ({
  useUIStore: vi.fn((selector: any) =>
    selector({ language: 'en', _hasHydrated: true })
  ),
}));

describe('i18n hooks - pure utility functions', () => {
  describe('getDateLocale', () => {
    it('should return Arabic locale for "ar"', () => {
      const locale = getDateLocale('ar');
      expect(locale).toBeDefined();
      expect(locale.code).toBe('ar');
    });

    it('should return English (US) locale for "en"', () => {
      const locale = getDateLocale('en');
      expect(locale).toBeDefined();
      expect(locale.code).toBe('en-US');
    });

    it('should fall back to English for unknown language', () => {
      const locale = getDateLocale('fr');
      expect(locale).toBeDefined();
      expect(locale.code).toBe('en-US');
    });

    it('should fall back to English for empty string', () => {
      const locale = getDateLocale('');
      expect(locale.code).toBe('en-US');
    });
  });

  describe('getIntlLocale', () => {
    it('should return Arabic locale with Latin digits for Arabic', () => {
      expect(getIntlLocale('ar')).toBe('ar-SA-u-nu-latn');
    });

    it('should return "en-US" for English', () => {
      expect(getIntlLocale('en')).toBe('en-US');
    });

    it('should fall back to "en-US" for unknown language', () => {
      expect(getIntlLocale('de')).toBe('en-US');
    });

    it('should fall back to "en-US" for empty string', () => {
      expect(getIntlLocale('')).toBe('en-US');
    });
  });
});
