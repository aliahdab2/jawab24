import { describe, it, expect } from 'vitest';
import { normalizeCustomerPhoneForWhatsApp } from '../customerPhone';

describe('normalizeCustomerPhoneForWhatsApp', () => {
    it('strips the + and separators to the wa_id shape', () => {
        expect(normalizeCustomerPhoneForWhatsApp('+966 50 123 4567')).toBe('966501234567');
        expect(normalizeCustomerPhoneForWhatsApp('+966-50-123-4567')).toBe('966501234567');
        expect(normalizeCustomerPhoneForWhatsApp('966501234567')).toBe('966501234567');
    });

    it('treats the 00 international prefix as +', () => {
        expect(normalizeCustomerPhoneForWhatsApp('00966501234567')).toBe('966501234567');
    });

    // Order webhooks from Arabic storefronts can carry Arabic-Indic digits.
    it('converts Arabic-Indic and extended Arabic-Indic digits', () => {
        expect(normalizeCustomerPhoneForWhatsApp('+٩٦٦٥٠١٢٣٤٥٦٧')).toBe('966501234567');
        expect(normalizeCustomerPhoneForWhatsApp('۹۶۶۵۰۱۲۳۴۵۶۷')).toBe('966501234567');
    });

    // A national number has no country code, and guessing one could message a
    // stranger in another country — refuse instead.
    it('refuses a local number with a trunk prefix', () => {
        expect(normalizeCustomerPhoneForWhatsApp('0501234567')).toBeUndefined();
    });

    it('refuses implausible lengths and empty input', () => {
        expect(normalizeCustomerPhoneForWhatsApp('12345')).toBeUndefined();            // too short
        expect(normalizeCustomerPhoneForWhatsApp('9665012345678901')).toBeUndefined(); // past E.164's 15
        expect(normalizeCustomerPhoneForWhatsApp('')).toBeUndefined();
        expect(normalizeCustomerPhoneForWhatsApp(null)).toBeUndefined();
        expect(normalizeCustomerPhoneForWhatsApp(undefined)).toBeUndefined();
        expect(normalizeCustomerPhoneForWhatsApp('not a phone')).toBeUndefined();
    });
});
