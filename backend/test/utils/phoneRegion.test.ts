/**
 * countryFromTimezone — merchant region inference from settings.timezone.
 *
 * The point of this test: coverage is data-driven (the full IANA timezone
 * database via countries-and-timezones), NOT a hand-maintained list. A country
 * we have never explicitly mentioned must still resolve — so onboarding a new
 * country needs zero code changes. That's what the "any continent" cases prove.
 */
import { describe, it, expect } from 'vitest';
import { countryFromTimezone } from '../../src/utils/phoneRegion';

describe('countryFromTimezone', () => {
  it('resolves the timezones present in prod today', () => {
    expect(countryFromTimezone('Asia/Riyadh')).toBe('SA');
    expect(countryFromTimezone('Africa/Tripoli')).toBe('LY');
    expect(countryFromTimezone('Europe/Stockholm')).toBe('SE');
  });

  it('resolves Arabic-market timezones', () => {
    expect(countryFromTimezone('Asia/Damascus')).toBe('SY');
    expect(countryFromTimezone('Africa/Cairo')).toBe('EG');
    expect(countryFromTimezone('Asia/Dubai')).toBe('AE');
  });

  it('resolves countries we have NEVER hard-coded (proves no maintained list)', () => {
    // None of these were ever in a hand-written map — they work because the
    // mapping comes from the IANA database. A new market onboards for free.
    expect(countryFromTimezone('America/New_York')).toBe('US');
    expect(countryFromTimezone('Australia/Sydney')).toBe('AU');
    expect(countryFromTimezone('Asia/Kolkata')).toBe('IN');
    expect(countryFromTimezone('Africa/Lagos')).toBe('NG');
    expect(countryFromTimezone('America/Sao_Paulo')).toBe('BR');
  });

  it('returns undefined for missing/unknown timezone', () => {
    expect(countryFromTimezone(null)).toBeUndefined();
    expect(countryFromTimezone(undefined)).toBeUndefined();
    expect(countryFromTimezone('')).toBeUndefined();
    expect(countryFromTimezone('Not/AZone')).toBeUndefined();
  });
});
