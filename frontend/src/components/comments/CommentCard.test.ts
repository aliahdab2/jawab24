import { describe, it, expect } from 'vitest';
import { translateFlagReason } from '@/utils/flagReason';

describe('translateFlagReason', () => {
    // Mock t() scoped to flagReason namespace (no prefix needed)
    const mockTranslations: Record<string, string> = {
        'offensive_or_abusive': 'Offensive or abusive',
        'angry_customer': 'Angry customer',
        'low_confidence': 'Needs your review',
        'price_not_in_kb': 'Please add price',
    };
    const mockTranslationsAr: Record<string, string> = {
        'offensive_or_abusive': 'محتوى مسيء',
        'angry_customer': 'عميل غاضب',
        'low_confidence': 'يحتاج مراجعتك',
        'price_not_in_kb': 'أرجو إضافة السعر',
    };

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
});
