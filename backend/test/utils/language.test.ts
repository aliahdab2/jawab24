import { describe, it, expect } from 'vitest';
import {
    detectLanguage,
    detectLanguageCode,
    isRTL,
    getLanguageName,
    SupportedLanguage,
} from '../../src/utils/language';

describe('Language Detection Utility', () => {
    describe('detectLanguage', () => {
        it('should detect Arabic text', () => {
            const result = detectLanguage('مرحبا كيف حالك');
            expect(result.language).toBe('ar');
            expect(result.isRTL).toBe(true);
            expect(result.script).toBe('Arabic');
            expect(result.confidence).toBeGreaterThan(0.5);
        });

        it('should detect Arabic with mixed content', () => {
            const result = detectLanguage('Hello مرحبا');
            // Should still detect Arabic if Arabic chars are significant
            expect(result.language).toBe('ar');
            expect(result.isRTL).toBe(true);
        });

        it('should detect English text', () => {
            const result = detectLanguage('Hello, how are you doing today?');
            expect(result.language).toBe('en');
            expect(result.isRTL).toBe(false);
            expect(result.script).toBe('Latin');
        });

        it('should detect English with common words', () => {
            const result = detectLanguage('The quick brown fox jumps over the lazy dog');
            expect(result.language).toBe('en');
            expect(result.confidence).toBeGreaterThan(0.5);
        });

        it('should detect Swedish text with special characters', () => {
            const result = detectLanguage('Hej, hur mår du? Jag är från Sverige');
            expect(result.language).toBe('sv');
            expect(result.isRTL).toBe(false);
        });

        it('should detect Swedish text using common words', () => {
            const result = detectLanguage('Det är en bra dag och jag har det bra');
            expect(result.language).toBe('sv');
        });

        it('should detect Swedish text with å character', () => {
            const result = detectLanguage('Vi går till parken');
            expect(result.language).toBe('sv');
            expect(result.confidence).toBeGreaterThanOrEqual(0.9);
        });

        it('should detect Swedish by common words without special chars', () => {
            // Needs at least 2 Swedish common words (och, det, att, som, etc.)
            const result = detectLanguage('det och att som test');
            expect(result.language).toBe('sv');
        });

        it('should handle empty text', () => {
            const result = detectLanguage('');
            expect(result.language).toBe('unknown');
            expect(result.confidence).toBe(0);
        });

        it('should handle whitespace only', () => {
            const result = detectLanguage('   \t\n  ');
            expect(result.language).toBe('unknown');
        });

        it('should detect Turkish text', () => {
            const result = detectLanguage('Merhaba, nasılsınız? Teşekkürler.');
            expect(result.language).toBe('tr');
        });

        it('should detect Turkish text with common words and unique chars', () => {
            const result = detectLanguage('Bu bir şey için ve bu da güzel');
            expect(result.language).toBe('tr');
            expect(result.confidence).toBeGreaterThanOrEqual(0.85);
        });

        it('should detect German text', () => {
            // Use ß (sharp s) which is unique to German
            const result = detectLanguage('Das ist sehr schön und ich bin sehr glücklich darüber');
            expect(result.language).toBe('de');
        });

        it('should detect French text', () => {
            const result = detectLanguage('Bonjour, comment allez-vous? C\'est très bien.');
            expect(result.language).toBe('fr');
        });

        it('should detect Spanish text', () => {
            const result = detectLanguage('Hola, ¿cómo estás? Es un buen día.');
            expect(result.language).toBe('es');
        });

        it('should detect Hebrew script as unknown RTL', () => {
            const result = detectLanguage('שלום עולם');
            expect(result.language).toBe('unknown');
            expect(result.script).toBe('Hebrew');
            expect(result.isRTL).toBe(true);
            expect(result.confidence).toBe(0.8);
        });

        it('should detect CJK characters as unknown', () => {
            const result = detectLanguage('你好世界');
            expect(result.language).toBe('unknown');
            expect(result.script).toBe('CJK');
            expect(result.isRTL).toBe(false);
        });

        it('should detect Japanese text as unknown', () => {
            // Pure hiragana/katakana without kanji (CJK) to hit the Japanese branch
            const result = detectLanguage('こんにちは');
            expect(result.language).toBe('unknown');
            expect(result.script).toBe('Japanese');
            expect(result.isRTL).toBe(false);
        });

        it('should detect Korean text as unknown', () => {
            const result = detectLanguage('안녕하세요');
            expect(result.language).toBe('unknown');
            expect(result.script).toBe('Korean');
            expect(result.isRTL).toBe(false);
        });

        it('should detect Cyrillic text as unknown', () => {
            const result = detectLanguage('Привет мир');
            expect(result.language).toBe('unknown');
            expect(result.script).toBe('Cyrillic');
            expect(result.isRTL).toBe(false);
        });

        it('should detect Thai text as unknown', () => {
            const result = detectLanguage('สวัสดีครับ');
            expect(result.language).toBe('unknown');
            expect(result.script).toBe('Thai');
            expect(result.isRTL).toBe(false);
        });

        it('should detect Turkish by unique chars without common words (fallback)', () => {
            // İ is a unique Turkish char; no Turkish common words present
            const result = detectLanguage('İstanbul');
            expect(result.language).toBe('tr');
            expect(result.confidence).toBe(0.75);
        });

        it('should handle numbers and symbols', () => {
            const result = detectLanguage('123 456 789 !@#$%');
            // No alphabetic characters — language is indeterminate
            expect(result.language).toBe('unknown');
        });

        it('should handle emojis with text', () => {
            const result = detectLanguage('Hello! 👋 How are you? 😊');
            expect(result.language).toBe('en');
        });

        it('should handle Arabic emojis with text', () => {
            const result = detectLanguage('مرحبا! 👋 كيف حالك؟ 😊');
            expect(result.language).toBe('ar');
        });
    });

    describe('detectLanguageCode', () => {
        it('should return just the language code', () => {
            expect(detectLanguageCode('Hello world')).toBe('en');
            expect(detectLanguageCode('مرحبا')).toBe('ar');
            expect(detectLanguageCode('Hej på dig')).toBe('sv');
        });
    });

    describe('isRTL', () => {
        it('should return true for Arabic', () => {
            expect(isRTL('مرحبا')).toBe(true);
        });

        it('should return false for English', () => {
            expect(isRTL('Hello')).toBe(false);
        });

        it('should return false for Swedish', () => {
            expect(isRTL('Hej')).toBe(false);
        });
    });

    describe('getLanguageName', () => {
        it('should return correct language names', () => {
            expect(getLanguageName('ar')).toBe('Arabic');
            expect(getLanguageName('en')).toBe('English');
            expect(getLanguageName('sv')).toBe('Swedish');
            expect(getLanguageName('de')).toBe('German');
            expect(getLanguageName('fr')).toBe('French');
            expect(getLanguageName('es')).toBe('Spanish');
            expect(getLanguageName('tr')).toBe('Turkish');
            expect(getLanguageName('unknown')).toBe('Unknown');
        });
    });

    describe('Real-world examples', () => {
        it('should handle typical Facebook comments in Arabic', () => {
            const comments = [
                'كم السعر؟',
                'متى التوصيل؟',
                'شكرا جزيلا',
                'هل يوجد خصم؟',
                'ممتاز جدا 👍',
            ];
            
            for (const comment of comments) {
                const result = detectLanguage(comment);
                expect(result.language).toBe('ar');
            }
        });

        it('should handle typical Facebook comments in English', () => {
            const comments = [
                'What is the price?',
                'When can you deliver?',
                'Thanks a lot!',
                'Is there a discount?',
                'Great product! 👍',
            ];
            
            for (const comment of comments) {
                const result = detectLanguage(comment);
                expect(result.language).toBe('en');
            }
        });

        it('should handle short one-word comments', () => {
            // Short comments are harder to detect accurately
            expect(detectLanguage('شكرا').language).toBe('ar');
            expect(detectLanguage('Thanks').language).toBe('en');
        });
    });
});
