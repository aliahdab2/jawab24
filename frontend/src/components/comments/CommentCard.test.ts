import { describe, it, expect } from 'vitest';
import { flagReasonEn, flagReasonAr } from '@jawab24/shared';
import { translateFlagReason } from '@/utils/flagReason';

describe('translateFlagReason', () => {
    // t() is built from the SAME JSON production loads — i18n/getMessages.ts
    // maps the `flagReason` namespace straight to these two exports.
    //
    // These used to be hand-copied literals. That made the test structurally
    // incapable of catching a wrong label: correcting the data required editing
    // the mock to match, so the two were always in agreement by construction.
    const mockTranslations: Record<string, string> = flagReasonEn;
    const mockTranslationsAr: Record<string, string> = flagReasonAr;

    const tEn = (key: string) => mockTranslations[key] ?? key;
    const tAr = (key: string) => mockTranslationsAr[key] ?? key;

    it('should return empty string for null/undefined', () => {
        expect(translateFlagReason(null, tEn, 'en')).toBe('');
        expect(translateFlagReason(undefined, tEn, 'en')).toBe('');
    });

    it('should translate a single flag reason', () => {
        expect(translateFlagReason('angry_customer', tEn, 'en')).toBe('Angry customer');
    });

    it('should translate to Arabic when locale is ar', () => {
        expect(translateFlagReason('angry_customer', tAr, 'ar')).toBe('عميل غاضب');
    });

    it('should use comma separator for English', () => {
        const result = translateFlagReason('offensive_or_abusive,low_confidence', tEn, 'en');
        expect(result).toBe('Offensive or abusive, Needs your review');
    });

    it('should use Arabic comma separator for Arabic', () => {
        const result = translateFlagReason('offensive_or_abusive,low_confidence', tAr, 'ar');
        expect(result).toBe('محتوى مسيء، يحتاج مراجعتك');
    });

    it('should fall back to raw string when no translation exists', () => {
        expect(translateFlagReason('some_unknown_flag', tEn, 'en')).toBe('some_unknown_flag');
    });

    it('should handle mixed known/unknown flags', () => {
        const result = translateFlagReason('angry_customer,unknown_flag', tEn, 'en');
        expect(result).toBe('Angry customer, unknown_flag');
    });

    it('should trim whitespace around flags', () => {
        const result = translateFlagReason(' angry_customer , low_confidence ', tEn, 'en');
        expect(result).toBe('Angry customer, Needs your review');
    });

    it('renders no Arabic label with the bare-alif «ارجو» (فصحى needs أرجو)', () => {
        // Regression: price/info/phone_not_in_kb all shipped as «ارجو إضافة …».
        // These strings are a single source of truth — they render as the inbox
        // chip here AND inside the flagged_reply push body (translateFlagReason
        // in backend/src/services/notifications.ts) — so one wrong character was
        // wrong on two surfaces at once.
        //
        // Asserted as an absence over the whole map rather than as expected
        // literals: a rewording of the label must not fail this test, but
        // reintroducing the bare alif anywhere must.
        const offenders = Object.entries(mockTranslationsAr)
            .filter(([, label]) => /(^|\s)ارجو/.test(label))
            .map(([key]) => key);
        expect(offenders).toEqual([]);
    });
});
