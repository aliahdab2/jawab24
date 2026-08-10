import { describe, it, expect } from 'vitest';
import { parseMerchantPrice } from '../price';

/** The parsed number, or the string 'INVALID' — keeps the table readable. */
const parse = (raw: unknown): number | null | 'INVALID' => {
    const r = parseMerchantPrice(raw);
    return r.ok ? r.value : 'INVALID';
};

describe('parseMerchantPrice', () => {
    it('reads the digit systems a merchant actually types', () => {
        expect(parse('50000')).toBe(50000);
        expect(parse('٥٠٠٠٠')).toBe(50000);   // Arabic-Indic
        expect(parse('۵۰۰۰۰')).toBe(50000);   // Extended Arabic-Indic
        expect(parse(50000)).toBe(50000);
    });

    it('reads separators from both conventions', () => {
        expect(parse('50,000')).toBe(50000);
        expect(parse('1,234,567')).toBe(1234567);
        expect(parse('50 000')).toBe(50000);
        expect(parse('35٬000')).toBe(35000);   // Eastern thousands separator
        expect(parse('35٫50')).toBe(35.5);     // Eastern decimal separator
    });

    it('reads a lone comma before 1-2 digits as a DECIMAL comma', () => {
        // Mis-reading "3,50" as 350 would quote a 100x wrong price.
        expect(parse('3,50')).toBe(3.5);
        expect(parse('3,5')).toBe(3.5);
        expect(parse('3,500')).toBe(3500);
    });

    it('refuses a spelled-out magnitude instead of guessing it', () => {
        // The report that started this: «50 ألف» posted, 400 returned, and the
        // merchant told only «try again». Refusing is correct — GUESSING the
        // multiplier is what would be dangerous — but the refusal has to be
        // legible, which is why the editor now calls this too.
        expect(parse('50 ألف')).toBe('INVALID');
        expect(parse('50 الف')).toBe('INVALID');
        expect(parse('50k')).toBe('INVALID');
        expect(parse('خمسون ألف')).toBe('INVALID');
        expect(parse('السعر عند الطلب')).toBe('INVALID');
    });

    it('treats absence as null, never as a price of zero', () => {
        expect(parse(null)).toBeNull();
        expect(parse(undefined)).toBeNull();
        expect(parse('')).toBeNull();
        // Whitespace-only normalizes to '' and `Number('')` is 0 — publishing
        // "free" for a field the merchant left blank. Absence is null.
        expect(parse('   ')).toBeNull();
        // An explicit zero is still a real, quotable price.
        expect(parse('0')).toBe(0);
    });

    it('refuses values that are not text or a finite number', () => {
        expect(parse({})).toBe('INVALID');
        expect(parse(['50'])).toBe('INVALID');
        expect(parse(Number.NaN)).toBe('INVALID');
        expect(parse(Number.POSITIVE_INFINITY)).toBe('INVALID');
    });
});
