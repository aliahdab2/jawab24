import { describe, it, expect } from 'vitest';
import { truncateAtSentence } from '../../src/utils/text';

describe('truncateAtSentence', () => {
    it('returns text unchanged when under limit', () => {
        expect(truncateAtSentence('Hello world!', 280)).toBe('Hello world!');
    });

    it('returns text unchanged when exactly at limit', () => {
        const text = 'A'.repeat(280);
        expect(truncateAtSentence(text, 280)).toBe(text);
    });

    it('truncates at last sentence boundary (period)', () => {
        const text = 'First sentence. Second sentence. Third sentence that pushes us way over the limit and keeps going and going to make sure we exceed the max length.';
        const result = truncateAtSentence(text, 50);
        expect(result).toBe('First sentence. Second sentence.');
        expect(result.length).toBeLessThanOrEqual(50);
    });

    it('truncates at last sentence boundary (exclamation)', () => {
        const text = 'Welcome to our store! We have amazing products! Check out our new collection of premium items that just arrived.';
        const result = truncateAtSentence(text, 60);
        expect(result).toBe('Welcome to our store! We have amazing products!');
    });

    it('truncates at last sentence boundary (question mark)', () => {
        const text = 'Need help? We are here for you! Our team is available around the clock to assist with anything you need.';
        const result = truncateAtSentence(text, 40);
        expect(result).toBe('Need help? We are here for you!');
    });

    it('truncates at Arabic question mark (؟)', () => {
        const text = 'هل تحتاج مساعدة؟ نحن هنا لمساعدتك في أي وقت ونقدم لك أفضل الخدمات والمنتجات المتاحة لدينا.';
        const result = truncateAtSentence(text, 50);
        expect(result).toBe('هل تحتاج مساعدة؟');
    });

    it('falls back to word boundary with ellipsis when no sentence boundary', () => {
        const text = 'This is a very long sentence without any period or exclamation that just keeps going and going and going forever without stopping at all';
        const result = truncateAtSentence(text, 60);
        expect(result).toContain('…');
        expect(result.length).toBeLessThanOrEqual(61); // +1 for ellipsis char
    });

    it('handles single long word gracefully', () => {
        const text = 'A'.repeat(300);
        const result = truncateAtSentence(text, 280);
        // No space to break on, falls back to hard truncation with ellipsis
        expect(result).toContain('…');
        expect(result.length).toBeLessThanOrEqual(281);
    });

    it('prefers sentence boundary over word boundary', () => {
        // Sentence ends at char 27, within the 60-char limit and above 30% threshold
        const text = 'Thank you for your comment. We appreciate your feedback very much and want to make sure you know that.';
        const result = truncateAtSentence(text, 60);
        expect(result).toBe('Thank you for your comment.');
    });
});
