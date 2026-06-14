import { describe, it, expect } from 'vitest';
import { isValidTimezone, safeTimezone } from '../timezone';

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
