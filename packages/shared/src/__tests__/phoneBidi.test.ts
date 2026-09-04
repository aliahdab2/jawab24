import { describe, it, expect } from 'vitest';
import { isolateKnownPhones } from '../phoneBidi';
import { LRI, PDI } from '../bidi';

/**
 * jsdom does no bidi layout, so these prove WHAT gets wrapped, not the painted
 * order. The painted order was proven separately in real Chrome (2026-09-04):
 * a single number in one LRI…PDI isolate renders left-to-right correctly, and
 * two separate numbers each in their own isolate keep RTL (typed) order.
 */
const wrap = (t: string) => `${LRI}${t}${PDI}`;

describe('isolateKnownPhones', () => {
    it('isolates a spaced international number that is one of the merchant lines', () => {
        const reply = 'تواصل معنا على +46 70 022 47 20 شكرا';
        expect(isolateKnownPhones(reply, ['+46 70 022 47 20'])).toBe(
            `تواصل معنا على ${wrap('+46 70 022 47 20')} شكرا`,
        );
    });

    it('isolates a sign-less domestic number (the runs reverse without a + too)', () => {
        const reply = 'رقمنا هو 0993 458 423 للطلب';
        expect(isolateKnownPhones(reply, ['0993 458 423'])).toBe(
            `رقمنا هو ${wrap('0993 458 423')} للطلب`,
        );
    });

    it('matches by DIGITS, so it hits however the model re-spaced the number', () => {
        // stored spaced, reply unbroken — still the same line, still isolated.
        const reply = 'اتصل على +46700224720 اليوم';
        expect(isolateKnownPhones(reply, ['+46 70 022 47 20'])).toBe(
            `اتصل على ${wrap('+46700224720')} اليوم`,
        );
    });

    it('wraps each number of a LIST individually — never welds them (keeps order)', () => {
        const nums = ['0935924472', '0112124472', '0937549674'];
        const reply = `أرقامنا ${nums.join(' ')} للطلب`;
        expect(isolateKnownPhones(reply, nums)).toBe(
            `أرقامنا ${nums.map(wrap).join(' ')} للطلب`,
        );
    });

    it('leaves two adjacent NON-phone numbers alone — «50 100» is not a merchant line', () => {
        const reply = 'المقاسات المتوفرة 50 100 سم';
        expect(isolateKnownPhones(reply, ['+46700224720'])).toBe(reply);
    });

    it('leaves a number that is NOT one of the merchant lines untouched', () => {
        const reply = 'رقم الزبون 0555123456 مسجل عندنا';
        expect(isolateKnownPhones(reply, ['+46700224720'])).toBe(reply);
    });

    it('is idempotent — a second pass adds no second isolate', () => {
        const reply = 'رقمنا 0993 458 423 تفضل';
        const once = isolateKnownPhones(reply, ['0993 458 423']);
        expect(isolateKnownPhones(once, ['0993 458 423'])).toBe(once);
    });

    it('is a no-op on a Latin reply — the number lays out correctly already', () => {
        const reply = 'Call us on +46 70 022 47 20 today';
        expect(isolateKnownPhones(reply, ['+46 70 022 47 20'])).toBe(reply);
    });

    it('is a no-op with no known numbers', () => {
        const reply = 'رقمنا 0993 458 423';
        expect(isolateKnownPhones(reply, [])).toBe(reply);
    });

    it('handles empty input', () => {
        expect(isolateKnownPhones('', ['0993 458 423'])).toBe('');
    });
});
