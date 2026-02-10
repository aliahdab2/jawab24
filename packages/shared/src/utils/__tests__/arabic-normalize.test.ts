import { describe, it, expect } from 'vitest';
import { normalizeArabic } from '../arabic-normalize';

describe('normalizeArabic', () => {
  describe('diacritics removal (tashkeel)', () => {
    it('removes fatha, kasra, damma, sukun', () => {
      expect(normalizeArabic('مُنْتَجٌ')).toBe('منتج');
    });

    it('removes shadda + tanween', () => {
      expect(normalizeArabic('مُحَمَّدٌ')).toBe('محمد');
    });

    it('removes all tashkeel from a sentence', () => {
      expect(normalizeArabic('بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ'))
        .toBe('بسم الله الرحمن الرحيم');
    });
  });

  describe('alef normalization', () => {
    it('normalizes أ → ا', () => {
      expect(normalizeArabic('أحمد')).toBe('احمد');
    });

    it('normalizes إ → ا', () => {
      expect(normalizeArabic('إبراهيم')).toBe('ابراهيم');
    });

    it('normalizes آ → ا', () => {
      expect(normalizeArabic('آلة')).toBe('الة');
    });

    it('normalizes multiple alef variants in one string', () => {
      expect(normalizeArabic('أنا إنسان آخر')).toBe('انا انسان اخر');
    });

    it('makes "أحمد" and "احمد" identical', () => {
      expect(normalizeArabic('أحمد')).toBe(normalizeArabic('احمد'));
    });
  });

  describe('tatweel removal', () => {
    it('removes tatweel/kashida', () => {
      expect(normalizeArabic('سعـــر')).toBe('سعر');
    });

    it('removes tatweel from decorative text', () => {
      expect(normalizeArabic('مـــرحـــبا')).toBe('مرحبا');
    });
  });

  describe('taa marbuta normalization', () => {
    it('does NOT normalize ة by default', () => {
      expect(normalizeArabic('مدرسة')).toBe('مدرسة');
    });

    it('normalizes ة → ه when flag is on', () => {
      expect(normalizeArabic('مدرسة', { normalizeTaaMarbuta: true })).toBe('مدرسه');
    });

    it('normalizes ة in multiple words', () => {
      expect(normalizeArabic('جامعة القاهرة', { normalizeTaaMarbuta: true }))
        .toBe('جامعه القاهره');
    });
  });

  describe('Arabic-Indic digits', () => {
    it('normalizes ٠-٩ to 0-9 by default', () => {
      expect(normalizeArabic('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    });

    it('normalizes digits in mixed text', () => {
      expect(normalizeArabic('السعر ١٥٠ ريال')).toBe('السعر 150 ريال');
    });

    it('keeps Arabic-Indic digits when flag is off', () => {
      expect(normalizeArabic('٠١٢', { normalizeDigits: false })).toBe('٠١٢');
    });
  });

  describe('whitespace normalization', () => {
    it('collapses multiple spaces', () => {
      expect(normalizeArabic('كلمة   أخرى')).toBe('كلمة اخرى');
    });

    it('trims leading and trailing whitespace', () => {
      expect(normalizeArabic('  مرحبا  ')).toBe('مرحبا');
    });

    it('normalizes tabs and newlines', () => {
      expect(normalizeArabic('سطر\tأول\nسطر\tثاني')).toBe('سطر اول سطر ثاني');
    });
  });

  describe('mixed Arabic + English text', () => {
    it('normalizes Arabic parts, leaves English unchanged', () => {
      expect(normalizeArabic('أهلاً Hello مرحبا World'))
        .toBe('اهلا Hello مرحبا World');
    });

    it('handles product names with English', () => {
      expect(normalizeArabic('iPhone ١٥ بـرو ماكس'))
        .toBe('iPhone 15 برو ماكس');
    });
  });

  describe('edge cases', () => {
    it('returns empty string for empty input', () => {
      expect(normalizeArabic('')).toBe('');
    });

    it('returns null/undefined as-is', () => {
      expect(normalizeArabic(null as unknown as string)).toBe(null);
      expect(normalizeArabic(undefined as unknown as string)).toBe(undefined);
    });

    it('passes through pure Latin text unchanged', () => {
      expect(normalizeArabic('Hello World 123')).toBe('Hello World 123');
    });

    it('handles emoji in text', () => {
      expect(normalizeArabic('مرحبا 👋 أهلاً')).toBe('مرحبا 👋 اهلا');
    });
  });

  describe('combined normalization', () => {
    it('applies all normalizations together', () => {
      // Diacritics + alef + tatweel + digits
      expect(normalizeArabic('أحمَدُ  يُريـد  ١٥  مُنتَجاً'))
        .toBe('احمد يريد 15 منتجا');
    });

    it('produces consistent output for variant forms of same text', () => {
      const variant1 = normalizeArabic('أحـمَدُ');
      const variant2 = normalizeArabic('احمد');
      const variant3 = normalizeArabic('أَحْمَد');
      expect(variant1).toBe(variant2);
      expect(variant2).toBe(variant3);
    });

    it('normalizes "باقة الأحلام" and "باقة الاحلام" to same form', () => {
      expect(normalizeArabic('باقة الأحلام'))
        .toBe(normalizeArabic('باقة الاحلام'));
    });
  });
});
