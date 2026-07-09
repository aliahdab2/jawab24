import { describe, it, expect } from 'vitest';
import { formatInternationalPhone } from '../phone';

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
