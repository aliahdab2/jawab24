import { describe, it, expect } from 'vitest';
import { matchesKeyword, testKeywordsMatch } from '../keyword-matching';
import { normalizeArabic } from '../arabic-normalize';

const match = (text: string, keyword: string) =>
    matchesKeyword(normalizeArabic(text.toLowerCase()), normalizeArabic(keyword.toLowerCase()));

describe('matchesKeyword — Arabic', () => {
    describe('prefix handling (ال + particles)', () => {
        it('matches keyword without ال against text with ال prefix', () => {
            expect(match('العنوان هنا', 'عنوان')).toBe(true);
        });

        it('matches keyword without prefix against text with و + ال', () => {
            expect(match('والسعر جيد', 'سعر')).toBe(true);
        });

        it('matches keyword without prefix against text with ب + ال', () => {
            expect(match('اشتريت بالمنتج', 'منتج')).toBe(true);
        });

        it('matches in the other direction: prefixed keyword against bare text', () => {
            expect(match('عنوان الشقة', 'العنوان')).toBe(true);
        });

        it('matches alef-variant normalization (أ/إ/آ → ا)', () => {
            expect(match('أهلاً بك', 'اهلا')).toBe(true);
        });
    });

    describe('false-positive guards (option 1: no alif-stripping)', () => {
        it('does NOT match كتاب against keyword كتب (different meaning, shared root)', () => {
            // Deliberate tradeoff: root-conflation false positives are worse than
            // missed broken plurals, so we don't collapse roots.
            expect(match('عندي كتاب جديد', 'كتب')).toBe(false);
        });

        it('does NOT match باب against keyword بب', () => {
            expect(match('البابا هنا', 'بب')).toBe(false);
        });

        it('does NOT cross-match unrelated words', () => {
            expect(match('مرحبا بك', 'سعر')).toBe(false);
            expect(match('الجو جميل', 'كتاب')).toBe(false);
        });

        it('does NOT match broken plurals (users must configure both forms)', () => {
            // Documented limitation: أقلام/قلم, أسعار/سعر, أثمان/ثمن are not matched.
            // Add both singular and plural to the keyword list if needed.
            expect(match('عندي أقلام جديدة', 'قلم')).toBe(false);
            expect(match('الأسعار مرتفعة', 'سعر')).toBe(false);
        });

        it('does NOT match when stripping keyword prefixes leaves too few chars', () => {
            // keyword "الي" → strip "ال" → "ي" (1 char). Guard blocks — text containing
            // the consonant ي should not match just because of the guard.
            expect(match('في البيت', 'الي')).toBe(false);
        });
    });

    describe('English keywords', () => {
        it('uses word boundaries (price does not match surprise)', () => {
            expect(match('what a surprise', 'price')).toBe(false);
            expect(match('the price is', 'price')).toBe(true);
        });
    });

    describe('Symbol / emoji keywords', () => {
        it('matches "." when message is exactly dots', () => {
            expect(match('...', '.')).toBe(true);
            expect(match('.', '.')).toBe(true);
        });

        it('does NOT match "." inside a sentence', () => {
            expect(match('hello.', '.')).toBe(false);
        });
    });
});

describe('testKeywordsMatch', () => {
    it('returns the matched keyword', () => {
        const result = testKeywordsMatch('العنوان هنا', ['سعر', 'عنوان']);
        expect(result.matches).toBe(true);
        expect(result.matchedKeyword).toBe('عنوان');
    });

    it('returns false when nothing matches', () => {
        const result = testKeywordsMatch('مرحبا', ['سعر', 'عنوان']);
        expect(result.matches).toBe(false);
    });
});
