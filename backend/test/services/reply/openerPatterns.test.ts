import { describe, it, expect } from 'vitest';
import { isOpenerMessage } from '../../../src/services/reply/openerPatterns';

describe('isOpenerMessage', () => {
    it('matches Facebook Messenger "Get Started" button title (English)', () => {
        expect(isOpenerMessage('Get Started')).toBe(true);
        expect(isOpenerMessage('get started')).toBe(true);
        expect(isOpenerMessage('GET STARTED')).toBe(true);
    });

    it('matches Facebook Messenger "بدء الاستخدام" button title (Arabic)', () => {
        expect(isOpenerMessage('بدء الاستخدام')).toBe(true);
    });

    it('tolerates surrounding whitespace and trailing punctuation', () => {
        expect(isOpenerMessage('  Get Started  ')).toBe(true);
        expect(isOpenerMessage('Get Started!')).toBe(true);
        expect(isOpenerMessage('بدء الاستخدام.')).toBe(true);
        expect(isOpenerMessage('Get Started?')).toBe(true);
    });

    it('does NOT match phrases that contain the opener inside longer text', () => {
        expect(isOpenerMessage('I started having a problem with my order')).toBe(false);
        expect(isOpenerMessage('Get started please tell me the price')).toBe(false);
        expect(isOpenerMessage('بدء الاستخدام لكن عندي سؤال')).toBe(false);
    });

    it('does NOT match generic greetings or unrelated text', () => {
        expect(isOpenerMessage('hi')).toBe(false);
        expect(isOpenerMessage('hello')).toBe(false);
        expect(isOpenerMessage('مرحبا')).toBe(false);
        expect(isOpenerMessage('what are your prices?')).toBe(false);
        expect(isOpenerMessage('start')).toBe(false); // intentionally NOT included — too broad
        expect(isOpenerMessage('ابدأ')).toBe(false); // intentionally NOT included — too broad
    });

    it('does NOT match empty / nullish input', () => {
        expect(isOpenerMessage('')).toBe(false);
        expect(isOpenerMessage('   ')).toBe(false);
        expect(isOpenerMessage(undefined as unknown as string)).toBe(false);
        expect(isOpenerMessage(null as unknown as string)).toBe(false);
    });
});
