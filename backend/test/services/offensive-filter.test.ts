import { describe, it, expect } from 'vitest';
import { isOffensiveContent } from '../../src/services/offensive-filter';

describe('isOffensiveContent', () => {
    describe('Arabic offensive words', () => {
        it('should detect "يا حمير" (donkeys insult)', () => {
            expect(isOffensiveContent('يا حمير')).toBe(true);
        });

        it('should detect "يا حمير انتم" (donkeys insult with pronoun)', () => {
            expect(isOffensiveContent('يا حمير انتم')).toBe(true);
        });

        it('should detect "يا كلب" (dog insult)', () => {
            expect(isOffensiveContent('يا كلب')).toBe(true);
        });

        it('should detect "شكلكم نصابين" (scammer accusation)', () => {
            expect(isOffensiveContent('شكلكم نصابين')).toBe(true);
        });

        it('should detect "خدمتكم زبالة" (garbage service)', () => {
            expect(isOffensiveContent('خدمتكم زبالة')).toBe(true);
        });

        it('should detect "يا غبي" (stupid insult)', () => {
            expect(isOffensiveContent('يا غبي')).toBe(true);
        });

        it('should detect offensive word with diacritics', () => {
            expect(isOffensiveContent('يَا حِمِير')).toBe(true);
        });
    });

    describe('English offensive words', () => {
        it('should detect "fuck you"', () => {
            expect(isOffensiveContent('fuck you')).toBe(true);
        });

        it('should detect "f*** you" with asterisks', () => {
            expect(isOffensiveContent('f*** you')).toBe(true);
        });

        it('should detect "f**k" with asterisks', () => {
            expect(isOffensiveContent('f**k this')).toBe(true);
        });

        it('should detect "sh*t" with asterisks', () => {
            expect(isOffensiveContent('this is sh*t')).toBe(true);
        });

        it('should detect "a**hole" with asterisks', () => {
            expect(isOffensiveContent('you a**hole')).toBe(true);
        });

        it('should detect "fucking terrible"', () => {
            expect(isOffensiveContent('fucking terrible service')).toBe(true);
        });

        it('should detect "shit" as standalone word', () => {
            expect(isOffensiveContent('this is shit')).toBe(true);
        });

        it('should detect "asshole"', () => {
            expect(isOffensiveContent('you are an asshole')).toBe(true);
        });

        it('should NOT match "class" for "ass" (word boundary)', () => {
            expect(isOffensiveContent('This is a class act')).toBe(false);
        });

        it('should NOT match "assign" for "ass" (word boundary)', () => {
            expect(isOffensiveContent('Please assign the task')).toBe(false);
        });
    });

    describe('clean text (no false positives)', () => {
        it('should return false for normal Arabic question', () => {
            expect(isOffensiveContent('كم سعر دورة الانجليزي؟')).toBe(false);
        });

        it('should return false for normal English question', () => {
            expect(isOffensiveContent('What are your working hours?')).toBe(false);
        });

        it('should return false for complaint without profanity', () => {
            expect(isOffensiveContent('خدمتكم سيئة ومافي احد يرد')).toBe(false);
        });

        it('should return false for greeting', () => {
            expect(isOffensiveContent('مرحبا كيف الحال')).toBe(false);
        });

        it('should return false for compliment', () => {
            expect(isOffensiveContent('ممتازين وهللا')).toBe(false);
        });

        it('should return false for empty string', () => {
            expect(isOffensiveContent('')).toBe(false);
        });

        it('should return false for whitespace only', () => {
            expect(isOffensiveContent('   ')).toBe(false);
        });
    });
});
