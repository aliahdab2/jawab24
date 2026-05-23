import { describe, it, expect } from 'vitest';
import { priceMinorToText, parseMoneyToPriceMinor, formatPrice } from '@/utils/money';

describe('priceMinorToText', () => {
    it('returns empty string for null/undefined (so form fields render blank, not "0")', () => {
        expect(priceMinorToText(null)).toBe('');
        expect(priceMinorToText(undefined)).toBe('');
    });

    it('drops the trailing decimal on integer amounts', () => {
        expect(priceMinorToText(5000)).toBe('50');
        expect(priceMinorToText(0)).toBe('0');
    });

    it('keeps decimals when they carry information', () => {
        expect(priceMinorToText(2999)).toBe('29.99');
        expect(priceMinorToText(2950)).toBe('29.5');  // trailing zero dropped
    });
});

describe('parseMoneyToPriceMinor', () => {
    it('parses standard period-separated decimal', () => {
        expect(parseMoneyToPriceMinor('29.99')).toBe(2999);
        expect(parseMoneyToPriceMinor('29')).toBe(2900);
    });

    it('accepts locale comma as decimal separator (Arabic / European)', () => {
        expect(parseMoneyToPriceMinor('29,99')).toBe(2999);
        expect(parseMoneyToPriceMinor('0,07')).toBe(7);
    });

    it('tolerates surrounding whitespace', () => {
        expect(parseMoneyToPriceMinor('  29.99  ')).toBe(2999);
    });

    it('returns null for empty / whitespace-only input', () => {
        expect(parseMoneyToPriceMinor('')).toBeNull();
        expect(parseMoneyToPriceMinor('   ')).toBeNull();
    });

    it('returns null for non-numeric garbage', () => {
        expect(parseMoneyToPriceMinor('abc')).toBeNull();
        expect(parseMoneyToPriceMinor('29.99.99')).toBeNull();
    });

    it('returns null for negative numbers (prices are non-negative)', () => {
        expect(parseMoneyToPriceMinor('-5')).toBeNull();
    });

    it('rounds correctly at the cent boundary', () => {
        expect(parseMoneyToPriceMinor('0.005')).toBe(1);    // banker's rounding edge — Math.round → 1
        expect(parseMoneyToPriceMinor('0.001')).toBe(0);
    });
});

describe('formatPrice', () => {
    it('returns null when price or currency is missing', () => {
        expect(formatPrice(null, 'USD', 'en')).toBeNull();
        expect(formatPrice(5000, null, 'en')).toBeNull();
        expect(formatPrice(undefined, undefined, 'en')).toBeNull();
    });

    it('formats with Intl currency symbols in English', () => {
        const result = formatPrice(5000, 'USD', 'en');
        expect(result).toMatch(/50/);
        expect(result).toMatch(/\$|USD/);
    });

    it('drops the cents when price is whole-units', () => {
        const result = formatPrice(5000, 'USD', 'en');
        expect(result).not.toMatch(/\.00/);
    });

    it('keeps the cents when price has them', () => {
        const result = formatPrice(2999, 'USD', 'en');
        expect(result).toMatch(/29\.99|29,99/);
    });

    it('falls back to "amount currency" when Intl rejects the currency code', () => {
        const result = formatPrice(5000, 'BOGUS', 'en');
        expect(result).toBe('50 BOGUS');
    });
});

describe('priceMinorToText / parseMoneyToPriceMinor — round-trip stability', () => {
    it.each([
        [0],
        [100],
        [2999],
        [50000],
        [12345],
    ])('round-trips priceMinor=%i', (priceMinor) => {
        const text = priceMinorToText(priceMinor);
        const back = parseMoneyToPriceMinor(text);
        expect(back).toBe(priceMinor);
    });
});
