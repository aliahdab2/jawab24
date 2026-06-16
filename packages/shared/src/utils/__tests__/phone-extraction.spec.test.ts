/**
 * EXECUTABLE SPEC for the libphonenumber-js phone-extraction migration.
 *
 * This file is written test-FIRST: it defines the target behavior of the new
 * extractor. `extractPhones` lives in ../validation; merchant region inference
 * (countryFromTimezone) lives in the backend (backend/src/utils/phoneRegion.ts)
 * so its timezone dataset never reaches the frontend bundle.
 *
 * It pins the design decisions we agreed for Jawab24:
 *   - libphonenumber-js is the engine (parse + VALIDATE against real numbering
 *     plans) — this is what rejects size/price/date sequences that the old regex
 *     mistook for phones.
 *   - `defaultCountry` is the MERCHANT's country (derived from settings.timezone).
 *     It is only a fallback hint: an explicit +CC the customer types always wins.
 *   - We store BOTH a faithful `raw` (what the customer typed, dials everywhere)
 *     and a canonical `e164` (when confidently resolved — powers wa.me + dedup).
 *   - "Never drop a lead": a phone-plausible run that libphonenumber can't resolve
 *     (unknown region / exotic plan) is still returned as raw with e164=null.
 *
 * Every e164/valid expectation below was captured from libphonenumber-js 1.13.6
 * ground truth, not guessed.
 *
 * Target API (to be implemented in ../validation):
 *   type ExtractedPhone = { raw: string; e164: string | null; valid: boolean };
 *   function extractPhones(text: string, opts?: { defaultCountry?: string }): ExtractedPhone[];
 *   function extractPhoneFromText(text: string, opts?: { defaultCountry?: string }): string | null; // first raw
 */
import { describe, it, expect } from 'vitest';
import { extractPhones, extractPhoneFromText } from '../validation';

// NOTE: countryFromTimezone (merchant region inference) lives in the BACKEND
// (backend/src/utils/phoneRegion.ts), backed by the full IANA dataset — it is
// kept out of @jawab24/shared so its ~0.5 MB of timezone data never reaches the
// frontend bundle. Its tests live alongside it (backend/test/.../phoneRegion).

const e164s = (text: string, defaultCountry?: string) =>
  extractPhones(text, defaultCountry ? { defaultCountry } : undefined).map(p => p.e164);

describe('extractPhones — international numbers (country-agnostic, no region needed)', () => {
  it('parses a +CC number written with spaces', () => {
    expect(extractPhones('اسمي ضحى +963 968 271 162')).toEqual([
      { raw: '+963968271162', e164: '+963968271162', valid: true },
    ]);
  });

  it('parses a US number', () => {
    expect(e164s('Call +14155552671 please')).toEqual(['+14155552671']);
  });

  it('treats a leading 00 as the international prefix', () => {
    // libphonenumber findNumbers ignores 00 on its own — the implementation must
    // normalize 00<cc> -> +<cc> before handing text to the engine.
    expect(e164s('00966501234567')).toEqual(['+966501234567']);
  });
});

describe('extractPhones — national numbers resolved via the merchant defaultCountry → E.164', () => {
  // Golden per-country table. raw stays as the customer typed (digits only);
  // e164 is the canonical form under that merchant region.
  const golden: Array<[string, string, string]> = [
    ['0501234567', 'SA', '+966501234567'],
    ['0912345678', 'LY', '+218912345678'],
    ['0935924472', 'SY', '+963935924472'],
    ['01001234567', 'EG', '+201001234567'],
    ['0501234567', 'AE', '+971501234567'],
    ['07901234567', 'IQ', '+9647901234567'],
    ['0790123456', 'JO', '+962790123456'],
    ['0701234567', 'SE', '+46701234567'],
    ['05551234567', 'TR', '+905551234567'],
  ];
  it.each(golden)('national %s in %s → %s', (input, country, expected) => {
    const [p] = extractPhones(input, { defaultCountry: country });
    expect(p.e164).toBe(expected);
    expect(p.valid).toBe(true);
    expect(p.raw).toBe(input); // faithful to what was typed
  });

  it('handles a national number written with spaces', () => {
    expect(e164s('رقمي 050 123 4567', 'SA')).toEqual(['+966501234567']);
  });

  it('handles a national number in Arabic-Indic digits', () => {
    expect(e164s('رقمي ٠٥٠١٢٣٤٥٦٧', 'SA')).toEqual(['+966501234567']);
  });
});

describe('extractPhones — Libya (LY) coverage — Nourva\'s customer base', () => {
  // Real numbers recovered from prod after the spacing bug dropped them. Locking
  // them in guarantees the migration keeps capturing Nourva's actual customers.
  const realRecoveredLeads: Array<[string, string]> = [
    ['0922190133', '+218922190133'], // هنية
    ['0916223793', '+218916223793'], // Malak
    ['0922798408', '+218922798408'], // وداد
  ];
  it.each(realRecoveredLeads)('real recovered Libyan mobile %s → %s', (input, expected) => {
    const [p] = extractPhones(input, { defaultCountry: 'LY' });
    expect(p).toEqual({ raw: input, e164: expected, valid: true });
  });

  it('handles a Libyan mobile written with spaces', () => {
    expect(e164s('091 622 3793', 'LY')).toEqual(['+218916223793']);
  });

  it("parses هدي's international Libyan number — spaced AND wrapped in bidi marks (real FB form)", () => {
    // Facebook wrapped the number in LRM/PDF directional control characters;
    // the extractor must see through them. No region needed (+218 is explicit).
    expect(e164s('‭+218 91 063 0575‬')).toEqual(['+218910630575']);
  });

  it('covers Libyana / Al-Madar mobile prefixes (091–094)', () => {
    expect(e164s('0945123456', 'LY')).toEqual(['+218945123456']);
  });

  it('parses a Tripoli landline', () => {
    expect(e164s('للتواصل 0212345678', 'LY')).toEqual(['+218212345678']);
  });

  it('treats 00218 as the international prefix for Libya', () => {
    expect(e164s('00218912345678')).toEqual(['+218912345678']);
  });

  it('rejects a Libyan size sequence, not a phone', () => {
    // Nourva sells lingerie — "92 88 90" style size talk must not become +218…
    expect(extractPhones('المقاسات 92 88 90', { defaultCountry: 'LY' })).toEqual([]);
  });
});

describe('extractPhones — VALIDATION rejects non-phone digit sequences (the whole point)', () => {
  it('rejects clothing/size sequences ("75 80 85 90")', () => {
    // The Nourva false positive: bra sizes the old grouped regex welded into 75808590.
    expect(extractPhones('مانعرفش انا نعرف مقاسات 75 80 85 90 وهكي', { defaultCountry: 'SA' })).toEqual([]);
  });

  it('rejects an order-number + price line', () => {
    expect(extractPhones('الطلب رقم 12345 بسعر 250 ريال', { defaultCountry: 'SA' })).toEqual([]);
  });

  it('rejects a bare date', () => {
    expect(extractPhones('الموعد 2026-06-15', { defaultCountry: 'SA' })).toEqual([]);
  });

  it('rejects a too-short fragment even with a region', () => {
    expect(extractPhones('رقم 12345', { defaultCountry: 'SA' })).toEqual([]);
  });
});

describe('extractPhones — an explicit country code ALWAYS overrides the merchant default', () => {
  it('keeps an Egyptian +20 number even when the merchant is Saudi', () => {
    expect(e164s('+20 100 123 4567', 'SA')).toEqual(['+201001234567']);
  });
});

describe('extractPhones — dedup national & international spellings of the same number', () => {
  it('collapses 05.. and +9665.. (same number) into one when the region is known', () => {
    const out = extractPhones('0501234567 و +966501234567', { defaultCountry: 'SA' });
    expect(out).toHaveLength(1);
    expect(out[0].e164).toBe('+966501234567');
  });
});

describe('extractPhones — #81 anti-welding still holds', () => {
  it('returns two distinct numbers, never a welded one', () => {
    const out = extractPhones('للتواصل 0935924472 0112124470', { defaultCountry: 'SY' });
    expect(out.map(p => p.e164)).toEqual(['+963935924472', '+963112124470']);
    expect(out.map(p => p.raw)).not.toContain('09359244720112124470');
  });
});

describe('extractPhones — NEVER drop a lead (permissive fallback)', () => {
  it('keeps a phone-plausible run libphonenumber cannot resolve (no region) as raw, e164=null', () => {
    // 10-digit national, no merchant region to anchor it → not canonicalizable,
    // but it is clearly a phone the merchant can still dial. Keep it.
    expect(extractPhones('0612345678')).toEqual([
      { raw: '0612345678', e164: null, valid: false },
    ]);
  });

  it('does NOT let the fallback resurrect a short size sequence', () => {
    // Guard the fallback: it must be stricter than the old regex so "75 80 85 90"
    // (8 digits) is rejected even when there is no region at all.
    expect(extractPhones('مقاسات 75 80 85 90')).toEqual([]);
  });
});

describe('extractPhoneFromText — back-compat first-raw accessor (used by the capture gate)', () => {
  it('returns the first raw phone string, or null', () => {
    expect(extractPhoneFromText('رقمي 050 123 4567', { defaultCountry: 'SA' })).toBe('0501234567');
    expect(extractPhoneFromText('+963 968 271 162')).toBe('+963968271162');
    expect(extractPhoneFromText('شكراً جزيلاً')).toBeNull();
  });
});
