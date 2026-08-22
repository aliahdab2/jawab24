import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatPlainDate } from './dateUtils';

afterEach(() => vi.useRealTimers());

describe('formatPlainDate', () => {
  it('renders the calendar day with no timezone shift (the UTC-midnight trap)', () => {
    // A tz-naive implementation shows "August 3" west of Greenwich.
    expect(formatPlainDate('2026-08-04', 'en-US')).toMatch(/August 4/);
  });

  it('forces the Gregorian calendar for the Arabic UI locale', () => {
    const out = formatPlainDate('2026-08-04', 'ar-SA-u-nu-latn');
    // Latin digits (deliberate app-wide) and a Gregorian month — never a
    // Hijri year like ١٤٤٨.
    expect(out).toContain('4');
    expect(out).toContain('أغسطس');
  });

  it('adds the year only when it is not the current year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 31, 12));
    expect(formatPlainDate('2026-08-04', 'en-US')).not.toContain('2026');
    expect(formatPlainDate('2027-02-01', 'en-US')).toContain('2027');
  });

  it('always renders the year for article dates when asked (a post date must survive the year turning)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 31, 12));
    expect(formatPlainDate('2026-08-04', 'en-US', { alwaysYear: true })).toBe('August 4, 2026');
    expect(formatPlainDate('2026-08-04', 'ar-SA-u-nu-latn', { alwaysYear: true })).toContain('2026');
  });

  it('passes malformed input through and nulls empty input', () => {
    expect(formatPlainDate(null, 'en-US')).toBeNull();
    expect(formatPlainDate('', 'en-US')).toBeNull();
    expect(formatPlainDate('not-a-date', 'en-US')).toBe('not-a-date');
    expect(formatPlainDate('2026-99-99', 'en-US')).toBe('2026-99-99');
  });
});
