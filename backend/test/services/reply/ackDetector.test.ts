import { describe, it, expect } from 'vitest';
import { detectAck } from '../../../src/services/reply/ackDetector';

describe('ackDetector.detectAck', () => {
    describe('thanks (love)', () => {
        it.each([
            'شكراً',
            'شكرا',
            'شكر',
            'مشكور',
            'تسلم',
            'thanks',
            'thanks!',
            'Thanks.',
            'thx',
            'ty',
            'Thank you',
            'Thank you 🙏',
            'thanks ❤️',
            'شكراً 🙏',
            'يعطيك العافية',
        ])('detects %j as thanks', (input) => {
            expect(detectAck(input)).toEqual({ kind: 'thanks' });
        });
    });

    describe('ok (like)', () => {
        it.each([
            'ok',
            'OK',
            'okay',
            'تمام',
            'طيب',
            'حسنا',
            'اوكي',
            'ماشي',
            'تم',
            '👍',
            '👌',
            '✅',
            'ok 👌',
            'تمام 👍',
            'تم.',
        ])('detects %j as ok', (input) => {
            expect(detectAck(input)).toEqual({ kind: 'ok' });
        });
    });

    describe('negative cases', () => {
        it.each([
            'شكراً، بس عندي سؤال',
            'okay how much?',
            'ok thanks please send me the link too',
            'thanks for nothing 😡',
            'thank you for the rude response',
            'hello',
            'how much is it',
            '',
            '   ',
            'ok ok thanks but also can you tell me about your products',
        ])('rejects %j', (input) => {
            expect(detectAck(input)).toBeNull();
        });
    });

    describe('length boundary', () => {
        it('accepts a message exactly 30 characters', () => {
            const text = 'thanks ' + '🙏'.repeat(7); // ≈ 30 chars including emojis (each 🙏 is 2 UTF-16 code units)
            // Build a deterministic 30-char input we know matches the regex
            const exact30 = 'thanks!'.padEnd(30, '!'); // 'thanks!' + 23 '!' = 30 chars
            expect(exact30.length).toBe(30);
            expect(detectAck(exact30)).toEqual({ kind: 'thanks' });
            // Sanity: the original test variable shouldn't crash
            expect(typeof text).toBe('string');
        });

        it('rejects a message over 30 characters even if it would match', () => {
            const long = 'thanks!'.padEnd(31, '!'); // 31 chars
            expect(long.length).toBe(31);
            expect(detectAck(long)).toBeNull();
        });
    });

    describe('trimming', () => {
        it('trims surrounding whitespace before matching', () => {
            expect(detectAck('   thanks   ')).toEqual({ kind: 'thanks' });
            expect(detectAck('\n\nok\n')).toEqual({ kind: 'ok' });
        });
    });
});
