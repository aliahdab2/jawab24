import { describe, it, expect } from 'vitest';
import { translateFlagReason } from './CommentCard';

describe('translateFlagReason', () => {
    // Mock t() that returns translation for known keys, raw key otherwise
    const mockTranslations: Record<string, string> = {
        'flagReason.offensive_or_abusive': 'Offensive or abusive',
        'flagReason.angry_customer': 'Angry customer',
        'flagReason.low_confidence': 'Low confidence reply',
        'flagReason.price_not_in_kb': 'Price not in knowledge base',
    };
    const mockTranslationsAr: Record<string, string> = {
        'flagReason.offensive_or_abusive': 'محتوى مسيء',
        'flagReason.angry_customer': 'عميل غاضب',
        'flagReason.low_confidence': 'ثقة منخفضة في الرد',
        'flagReason.price_not_in_kb': 'سعر غير موجود في قاعدة المعرفة',
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
        expect(result).toBe('Offensive or abusive, Low confidence reply');
    });

    it('should use Arabic comma separator for Arabic', () => {
        const result = translateFlagReason('offensive_or_abusive,low_confidence', tAr, 'ar');
        expect(result).toBe('محتوى مسيء، ثقة منخفضة في الرد');
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
        expect(result).toBe('Angry customer, Low confidence reply');
    });
});
