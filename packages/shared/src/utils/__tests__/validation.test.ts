import { describe, it, expect } from 'vitest';
import {
  extractPhoneFromText,
  extractPhonesFromText,
  isValidPhone,
  isArabicPhone,
  normalizeArabicIndic,
} from '../validation';

describe('extractPhoneFromText', () => {
  describe('single number', () => {
    it('extracts a Syrian mobile in national format', () => {
      expect(extractPhoneFromText('رقمي 0935924472')).toBe('+963935924472');
    });

    it('extracts a Syrian mobile in international format', () => {
      expect(extractPhoneFromText('Call +963 93 592 4472 please')).toBe('+963935924472');
    });

    it('extracts a Syrian landline (Damascus)', () => {
      expect(extractPhoneFromText('الأرضي 011 212 4470')).toBe('+963112124470');
    });

    it('handles Arabic-Indic digits', () => {
      expect(extractPhoneFromText('رقمي ٠٩٣٥٩٢٤٤٧٢')).toBe('+963935924472');
    });

    it('returns null when no phone is present', () => {
      expect(extractPhoneFromText('شكراً جزيلاً')).toBeNull();
    });

    it('does not match a 19-digit garbage string', () => {
      // The exact mangled value the old regex produced for two-number input.
      // libphonenumber should reject this as it doesn't fit any country's plan.
      expect(extractPhoneFromText('0935924472011212447')).toBeNull();
    });
  });

  describe('two numbers in one message — regression for mobile+landline welding', () => {
    it('does NOT weld a mobile and a landline separated by a space', () => {
      const result = extractPhoneFromText('للتواصل 0935924472 0112124470');
      // The bug: old regex returned "0935924472011212447" (19 digits, garbage).
      // Fixed: we return one valid number, never the concatenation.
      expect(result).not.toBe('0935924472011212447');
      expect(result).not.toBe('+9630935924472011212447');
      expect(['+963935924472', '+963112124470']).toContain(result);
    });

    it('extracts both numbers via extractPhonesFromText', () => {
      const phones = extractPhonesFromText('للتواصل 0935924472 0112124470');
      expect(phones).toHaveLength(2);
      expect(phones).toContain('+963935924472');
      expect(phones).toContain('+963112124470');
    });

    it('extracts both numbers when separated by Arabic prose', () => {
      const phones = extractPhonesFromText(
        'موبايلي 0935924472 وأرضي البيت 0112124470 للاستفسار',
      );
      expect(phones).toContain('+963935924472');
      expect(phones).toContain('+963112124470');
    });

    it('deduplicates identical numbers in the same message', () => {
      const phones = extractPhonesFromText('0935924472 أو +963935924472');
      expect(phones).toEqual(['+963935924472']);
    });
  });

  describe('other Arabic countries', () => {
    it('extracts a Saudi mobile when default country override is used', () => {
      expect(extractPhoneFromText('+966501234567')).toBe('+966501234567');
    });

    it('accepts an explicit defaultCountry override', () => {
      expect(extractPhoneFromText('0501234567', 'SA')).toBe('+966501234567');
    });
  });
});

describe('isValidPhone', () => {
  it('accepts E.164 phones', () => {
    expect(isValidPhone('+963935924472')).toBe(true);
    expect(isValidPhone('+966501234567')).toBe(true);
  });

  it('rejects non-E.164', () => {
    expect(isValidPhone('0935924472')).toBe(false);
    expect(isValidPhone('0935924472011212447')).toBe(false);
  });
});

describe('isArabicPhone', () => {
  it('returns true for Syrian/Saudi numbers', () => {
    expect(isArabicPhone('+963935924472')).toBe(true);
    expect(isArabicPhone('+966501234567')).toBe(true);
  });

  it('returns false for non-Arabic countries', () => {
    expect(isArabicPhone('+15551234567')).toBe(false);
  });
});

describe('normalizeArabicIndic', () => {
  it('converts Arabic-Indic digits to ASCII', () => {
    expect(normalizeArabicIndic('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('leaves ASCII digits untouched', () => {
    expect(normalizeArabicIndic('hello 123')).toBe('hello 123');
  });
});
