import { describe, it, expect } from 'vitest';
import { formatInternationalPhone, normalizeInternationalPhone, resolveCustomerLabel } from '../phone';

describe('formatInternationalPhone', () => {
  it('formats an E.164 wa_id (no plus) into a grouped international number', () => {
    // Swedish mobile — libphonenumber groups as "+46 70 022 47 20".
    const out = formatInternationalPhone('46700224720');
    expect(out).toBe('+46 70 022 47 20');
  });

  it('accepts input that already carries a leading + and separators', () => {
    expect(formatInternationalPhone('+46 700 224 720')).toBe('+46 70 022 47 20');
  });

  it('returns empty string for empty / digit-free input so callers can fall back', () => {
    expect(formatInternationalPhone('')).toBe('');
    expect(formatInternationalPhone('   ')).toBe('');
    expect(formatInternationalPhone('abc')).toBe('');
  });

  it('falls back to bare +<digits> when the number is not a parseable phone', () => {
    // Too short to be a real number — must not throw, must stay usable/copyable.
    expect(formatInternationalPhone('12')).toBe('+12');
  });
});

describe('resolveCustomerLabel', () => {
  it('prefers the display name and marks it as not-a-phone', () => {
    expect(resolveCustomerLabel('Sara', '+46 70 022 47 20', 'Unknown')).toEqual({
      label: 'Sara',
      isPhone: false,
    });
  });

  it('uses the phone number when there is no name, flagging isPhone (→ dir=ltr)', () => {
    expect(resolveCustomerLabel(null, '+46 70 022 47 20', 'Unknown')).toEqual({
      label: '+46 70 022 47 20',
      isPhone: true,
    });
  });

  it('falls back to the generic label when neither name nor number exists', () => {
    expect(resolveCustomerLabel(null, '', 'Unknown')).toEqual({
      label: 'Unknown',
      isPhone: false,
    });
    expect(resolveCustomerLabel('', '', 'Unknown')).toEqual({ label: 'Unknown', isPhone: false });
  });
});

describe('normalizeInternationalPhone', () => {
  it('accepts the messy formats merchants paste and returns E.164', () => {
    expect(normalizeInternationalPhone('+963 944 123 456')).toBe('+963944123456');
    expect(normalizeInternationalPhone('00963-944123456')).toBe('+963944123456');
    expect(normalizeInternationalPhone('963944123456')).toBe('+963944123456');
    expect(normalizeInternationalPhone('+46 (700) 224-720')).toBe('+46700224720');
  });

  it('rejects local formats without a country code (leading zero)', () => {
    expect(normalizeInternationalPhone('0944123456')).toBeNull();
  });

  it('rejects garbage and empty input', () => {
    expect(normalizeInternationalPhone('')).toBeNull();
    expect(normalizeInternationalPhone('call me')).toBeNull();
    expect(normalizeInternationalPhone('+')).toBeNull();
  });
});
