import { describe, it, expect } from 'vitest';
import {
    isValidTimezone,
    safeTimezone,
    formatTimeInZone,
    isWithinBusinessHours,
    formatUtcOffset,
    getTimezoneOptions,
    utcOffsetMinutes,
} from '../timezone';

// A fixed instant: 2026-07-21 15:26 UTC — the real moment a merchant's customer
// sent a prescription photo and got no reply, because their hours were evaluated
// in Asia/Riyadh (18:26 → closed) instead of Africa/Tripoli (17:26 → open).
const INSTANT = new Date('2026-07-21T15:26:00Z');

describe('isValidTimezone', () => {
    it('accepts valid IANA timezone names', () => {
        expect(isValidTimezone('Asia/Riyadh')).toBe(true);
        expect(isValidTimezone('Asia/Damascus')).toBe(true);
        expect(isValidTimezone('UTC')).toBe(true);
        expect(isValidTimezone('America/New_York')).toBe(true);
    });

    it('rejects invalid, empty, or absent names', () => {
        expect(isValidTimezone('Not/AZone')).toBe(false);
        expect(isValidTimezone('')).toBe(false);
        expect(isValidTimezone(undefined)).toBe(false);
        expect(isValidTimezone(null)).toBe(false);
    });
});

describe('safeTimezone', () => {
    it('returns a valid timezone unchanged', () => {
        expect(safeTimezone('Asia/Riyadh')).toBe('Asia/Riyadh');
    });

    it('falls back to UTC for invalid or absent timezones', () => {
        expect(safeTimezone('Not/AZone')).toBe('UTC');
        expect(safeTimezone('')).toBe('UTC');
        expect(safeTimezone(undefined)).toBe('UTC');
    });
});

describe('formatTimeInZone', () => {
    it('renders 24h HH:MM in the requested zone', () => {
        expect(formatTimeInZone('UTC', INSTANT)).toBe('15:26');
        expect(formatTimeInZone('Africa/Tripoli', INSTANT)).toBe('17:26'); // UTC+2
        expect(formatTimeInZone('Asia/Riyadh', INSTANT)).toBe('18:26');    // UTC+3
    });

    it('pads midnight rather than emitting "24:00"', () => {
        expect(formatTimeInZone('UTC', new Date('2026-07-21T00:05:00Z'))).toBe('00:05');
    });

    it('falls back to local time instead of throwing on a bad zone', () => {
        expect(formatTimeInZone('Not/AZone', INSTANT)).toMatch(/^\d{2}:\d{2}$/);
    });
});

describe('isWithinBusinessHours', () => {
    // The bug the shared definition fixes: the merchant's stored zone decides
    // whether the same instant falls inside or outside the same window.
    it('resolves the same instant differently per timezone', () => {
        expect(isWithinBusinessHours('09:00', '18:00', 'Africa/Tripoli', INSTANT)).toBe(true);
        expect(isWithinBusinessHours('09:00', '18:00', 'Asia/Riyadh', INSTANT)).toBe(false);
    });

    it('treats the end time as EXCLUSIVE — 18:00 closes an 09:00–18:00 day', () => {
        expect(isWithinBusinessHours('09:00', '18:00', 'UTC', new Date('2026-07-21T17:59:00Z'))).toBe(true);
        expect(isWithinBusinessHours('09:00', '18:00', 'UTC', new Date('2026-07-21T18:00:00Z'))).toBe(false);
    });

    it('treats the start time as INCLUSIVE', () => {
        expect(isWithinBusinessHours('09:00', '18:00', 'UTC', new Date('2026-07-21T09:00:00Z'))).toBe(true);
    });

    it('is never open for an empty or inverted window', () => {
        expect(isWithinBusinessHours('00:00', '00:00', 'UTC', INSTANT)).toBe(false);
        expect(isWithinBusinessHours('18:00', '09:00', 'UTC', INSTANT)).toBe(false);
    });
});

describe('formatUtcOffset', () => {
    it('renders offsets as UTC±HH:MM', () => {
        expect(formatUtcOffset('Africa/Tripoli', INSTANT)).toBe('UTC+02:00');
        expect(formatUtcOffset('Asia/Riyadh', INSTANT)).toBe('UTC+03:00');
    });

    it('renders zero offset as UTC+00:00 rather than a bare "GMT"', () => {
        expect(formatUtcOffset('UTC', INSTANT)).toBe('UTC+00:00');
    });

    it('returns empty string for an unusable zone', () => {
        expect(formatUtcOffset('Not/AZone', INSTANT)).toBe('');
    });
});

describe('getTimezoneOptions', () => {
    it('labels each zone with its offset', () => {
        const tripoli = getTimezoneOptions([], INSTANT).find(o => o.value === 'Africa/Tripoli');
        expect(tripoli?.label).toBe('Africa/Tripoli (UTC+02:00)');
    });

    it('includes a stored zone outside the curated list, so it never renders blank', () => {
        // A blank select would silently rewrite the merchant's stored zone on save.
        expect(getTimezoneOptions(['Pacific/Auckland'], INSTANT).some(o => o.value === 'Pacific/Auckland')).toBe(true);
    });

    it('does not duplicate a zone already in the curated list', () => {
        expect(getTimezoneOptions(['Asia/Riyadh', 'Asia/Riyadh'], INSTANT)
            .filter(o => o.value === 'Asia/Riyadh')).toHaveLength(1);
    });

    it('ignores undefined entries (nothing detected / nothing stored)', () => {
        expect(() => getTimezoneOptions([undefined, undefined], INSTANT)).not.toThrow();
    });

    it('orders by REAL UTC offset, west to east', () => {
        // Not by the label: "UTC-04:00" sorts after "UTC+04:00" as a string, which
        // dumped every western zone at the bottom of the picker.
        const minutes = getTimezoneOptions([], INSTANT).map(o => utcOffsetMinutes(o.value, INSTANT));
        expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
        expect(minutes[0]).toBeLessThan(0); // America/Toronto leads, not trails
    });
});
