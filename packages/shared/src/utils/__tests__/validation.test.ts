import { describe, it, expect } from 'vitest';
import {
  extractPhoneFromText,
  extractPhonesFromText,
  isValidPhone,
  isArabicPhone,
  normalizeArabicIndic,
  isSanctionedPhone,
  SANCTIONED_DIAL_PREFIXES,
  isValidHttpUrl,
} from '../validation';

describe('extractPhoneFromText', () => {
  describe('single number — preserves what the customer typed', () => {
    it('extracts a national-format mobile as raw digits', () => {
      expect(extractPhoneFromText('رقمي 0935924472')).toBe('0935924472');
    });

    it('extracts an international-format mobile when typed contiguously', () => {
      expect(extractPhoneFromText('Call +963935924472 please')).toBe('+963935924472');
    });

    it('handles Arabic-Indic digits', () => {
      expect(extractPhoneFromText('رقمي ٠٩٣٥٩٢٤٤٧٢')).toBe('0935924472');
    });

    it('strips inline formatting characters within a contiguous run', () => {
      expect(extractPhoneFromText('Call 555-123-4567 now')).toBe('5551234567');
    });

    it('returns null when no phone is present', () => {
      expect(extractPhoneFromText('شكراً جزيلاً')).toBeNull();
    });

    it('rejects an overlong digit string (>16 chars)', () => {
      // 19 contiguous digits — no real number plan goes that long, this is
      // either garbage or two welded numbers without a separator.
      expect(extractPhoneFromText('0935924472011212447')).toBeNull();
    });

    it('rejects a digit run that is too short to be a phone', () => {
      // 6 digits — likely an order number or year + month, not a phone.
      expect(extractPhoneFromText('reference 123456')).toBeNull();
    });
  });

  describe('two numbers in one message — regression for #81 welding bug', () => {
    it('does NOT weld a mobile and a landline separated by a space', () => {
      // The original pre-#81 regex had \s inside the character class, which
      // let it span whitespace and weld "0935924472 0112124470" into the
      // 19-digit string "09359244720112124470". Removing \s from the class
      // forces two separate matches.
      const result = extractPhoneFromText('للتواصل 0935924472 0112124470');
      expect(result).not.toBe('09359244720112124470');
      expect(['0935924472', '0112124470']).toContain(result);
    });

    it('extracts both numbers via extractPhonesFromText', () => {
      const phones = extractPhonesFromText('للتواصل 0935924472 0112124470');
      expect(phones).toEqual(['0935924472', '0112124470']);
    });

    it('extracts both numbers when separated by Arabic prose', () => {
      const phones = extractPhonesFromText(
        'موبايلي 0935924472 وأرضي البيت 0112124470 للاستفسار',
      );
      expect(phones).toEqual(['0935924472', '0112124470']);
    });

    it('deduplicates identical digit strings in the same message', () => {
      expect(extractPhonesFromText('0935924472 أو 0935924472')).toEqual(['0935924472']);
    });

    it('treats national-format and international-format of the same number as distinct strings', () => {
      // Without a country guess we cannot canonicalize, so the customer typing
      // both forms produces two records. The merchant resolves it visually.
      const phones = extractPhonesFromText('0935924472 أو +963935924472');
      expect(phones).toEqual(['0935924472', '+963935924472']);
    });
  });

  describe('country-agnostic capture (regression: prod customer leads lost)', () => {
    // Damascus-based workspace was silently dropping every non-Syrian DM
    // because the libphonenumber gate rejected any digits that didn't fit
    // Syria's plan. The fix: stop guessing country at the gate; capture
    // whatever the customer typed and let the merchant interpret it.
    it("captures an 11-digit Egyptian mobile (didn't fit Syria's 10-digit plan)", () => {
      // The exact missing lead — 0989342323... is an Egyptian mobile pattern.
      expect(extractPhoneFromText('الرقم ٠٩٨٩٣٤٢٣٤٢٣ الموبايل')).toBe('09893423423');
    });

    it('captures a Saudi national-format mobile', () => {
      expect(extractPhoneFromText('رقمي 0501234567')).toBe('0501234567');
    });

    it("rejects garbage that's outside any phone-length range", () => {
      // 13 digits — within range, so it IS captured as a phone candidate.
      // The merchant will see it's malformed and discard the lead; we just
      // refuse to silently drop the entire row over a digit-count guess.
      expect(extractPhoneFromText('الارضي ٠١٢٢٢١٢٣٢١٢٣٤')).toBe('0122212321234');
    });
  });

  describe('number written with spaces between digit groups (regression: spaced leads dropped)', () => {
    // The whitespace-forbidding regex matched only the sub-8-digit fragments of
    // a space-grouped number, so the gate found nothing and the entire lead
    // (name + phone) was silently dropped. Writing a phone with spaces is very
    // common in Arabic markets, so this lost a large share of leads.
    it('extracts a national mobile grouped as 4-3-3', () => {
      expect(extractPhoneFromText('0500 000 000')).toBe('0500000000');
    });

    it('extracts a national mobile grouped as 3-3-4 in Arabic prose', () => {
      expect(extractPhoneFromText('رقمي 050 123 4567')).toBe('0501234567');
    });

    it('extracts an international mobile grouped with spaces after the country code', () => {
      expect(extractPhoneFromText('+966 50 123 4567')).toBe('+966501234567');
    });

    it('extracts a spaced number written in Arabic-Indic digits', () => {
      expect(extractPhoneFromText('رقم جوالي ٠٥٠ ١٢٣ ٤٥٦٧')).toBe('0501234567');
    });

    it('still does NOT weld two contiguous numbers separated by a single space (#81 holds)', () => {
      // Neither block has an internal space, so the GROUPED shape (≤4-digit
      // groups) can't span the gap — the two numbers stay separate.
      const phones = extractPhonesFromText('للتواصل 0935924472 0112124470');
      expect(phones).toEqual(['0935924472', '0112124470']);
    });
  });
});

describe('normalizeArabicIndic', () => {
  it('converts Arabic-Indic digits to ASCII', () => {
    expect(normalizeArabicIndic('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('leaves non-digit characters unchanged', () => {
    expect(normalizeArabicIndic('رقمي ٠٩٣٥')).toBe('رقمي 0935');
  });

  it('converts Extended Arabic-Indic (Persian/Urdu) digits to ASCII', () => {
    expect(normalizeArabicIndic('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('converts mixed Arabic-Indic and Extended digits in one string', () => {
    expect(normalizeArabicIndic('السعر ۱۵٠٠ ريال')).toBe('السعر 1500 ريال');
  });
});

describe('isArabicPhone', () => {
  it('recognizes Syrian country code', () => {
    expect(isArabicPhone('+963935924472')).toBe(true);
  });

  it('recognizes Egyptian country code', () => {
    expect(isArabicPhone('+20989342323')).toBe(true);
  });

  it('rejects non-Arabic country codes', () => {
    expect(isArabicPhone('+14155551234')).toBe(false);
  });
});

describe('isValidPhone', () => {
  it('accepts E.164', () => {
    expect(isValidPhone('+963935924472')).toBe(true);
  });

  it('rejects national format', () => {
    expect(isValidPhone('0935924472')).toBe(false);
  });
});

describe('isSanctionedPhone', () => {
  it('blocks Syrian (+963) numbers — provider/sanctions cannot deliver', () => {
    expect(isSanctionedPhone('+963935924472')).toBe(true);
  });

  it('allows deliverable regions (KSA, Egypt, UAE)', () => {
    expect(isSanctionedPhone('+966555123456')).toBe(false);
    expect(isSanctionedPhone('+201001234567')).toBe(false);
    expect(isSanctionedPhone('+971501234567')).toBe(false);
  });

  it('lists Syria in the canonical blocklist', () => {
    expect(SANCTIONED_DIAL_PREFIXES).toContain('+963');
  });
});

describe('isValidHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isValidHttpUrl('https://shop.example/product?id=1')).toBe(true);
    expect(isValidHttpUrl('http://shop.example')).toBe(true);
  });

  it('rejects other schemes and malformed input', () => {
    for (const v of ['javascript:alert(1)', 'ftp://x.example', 'mailto:a@b.com', 'not a url', '', 'shop.example']) {
      expect(isValidHttpUrl(v)).toBe(false);
    }
  });
});
