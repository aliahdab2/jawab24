import { describe, it, expect } from 'vitest';
import { stripCommentNoise, hasMention, isPunctuationOnly } from '../../src/utils/commentText';

describe('stripCommentNoise', () => {
    it('strips Facebook structured mention (alone)', () => {
        expect(stripCommentNoise('@[100012345:Hanaa Kanaan]')).toBe('');
    });

    it('strips Facebook structured mention with trailing Arabic', () => {
        expect(stripCommentNoise('@[100012345:Hanaa Kanaan] شكراً')).toBe('شكراً');
    });

    it('strips Facebook structured mention with trailing question', () => {
        expect(stripCommentNoise('@[100012345:Ali] كيف يمكنني التسجيل؟')).toBe(
            'كيف يمكنني التسجيل؟',
        );
    });

    it('strips plain @mention (single word handle)', () => {
        expect(stripCommentNoise('@hadi')).toBe('');
    });

    it('strips plain @mention with Arabic handle', () => {
        expect(stripCommentNoise('@أحمد')).toBe('');
    });

    it('strips plain @mention + capitalized surname (two-word name)', () => {
        expect(stripCommentNoise('@Ali Ahdab كيف السعر؟')).toBe('كيف السعر؟');
    });

    it('strips URLs (http, https, www)', () => {
        expect(stripCommentNoise('check this https://example.com/path?q=1')).toBe('check this');
        expect(stripCommentNoise('visit www.example.com now')).toBe('visit  now');
    });

    it('strips mixed mention + URL', () => {
        expect(stripCommentNoise('@Ali https://example.com شكراً')).toBe('شكراً');
    });

    it('leaves clean text untouched', () => {
        expect(stripCommentNoise('كم سعر الدورة؟')).toBe('كم سعر الدورة؟');
    });

    it('trims leading/trailing whitespace after stripping', () => {
        expect(stripCommentNoise('   @hadi   ')).toBe('');
        expect(stripCommentNoise('   @[100:Name] شكراً   ')).toBe('شكراً');
    });

    it('handles multiple structured mentions', () => {
        expect(stripCommentNoise('@[1:First] @[2:Second] hello')).toBe('hello');
    });

    // NOTE: emails like "me@example.com" collide with the plain @handle pattern and get
    // partially stripped. Pre-existing behavior — FB comments don't contain raw emails
    // in practice, so we accept this trade-off rather than complicating the regex.
});

describe('hasMention', () => {
    it('detects Facebook structured mention', () => {
        expect(hasMention('@[100012345:Hanaa Kanaan]')).toBe(true);
        expect(hasMention('@[1:X] شكراً')).toBe(true);
    });

    it('detects plain @mention with Latin handle', () => {
        expect(hasMention('@hadi')).toBe(true);
        expect(hasMention('hello @ali there')).toBe(true);
    });

    it('detects plain @mention with Arabic handle', () => {
        expect(hasMention('@أحمد')).toBe(true);
    });

    it('returns false for clean text', () => {
        expect(hasMention('كم سعر الدورة؟')).toBe(false);
        expect(hasMention('hello world')).toBe(false);
    });

    // NOTE: emails like "me@example.com" register as mentions (pre-existing behavior).
    // Acceptable because FB comments don't contain raw emails in practice.

    it('returns false for bare @ with no identifier', () => {
        expect(hasMention('@ ')).toBe(false);
        expect(hasMention('price @ 100')).toBe(false);
    });

    it('returns false for @ followed by non-word non-Arabic', () => {
        // @! is not a mention — neither word char nor Arabic after @
        expect(hasMention('@!hello')).toBe(false);
    });
});

describe('isPunctuationOnly', () => {
    it('returns true for single punctuation', () => {
        expect(isPunctuationOnly('.')).toBe(true);
        expect(isPunctuationOnly('...')).toBe(true);
        expect(isPunctuationOnly('!!')).toBe(true);
    });

    it('returns true for emoji-only text', () => {
        expect(isPunctuationOnly('🎉')).toBe(true);
        expect(isPunctuationOnly('🎉🔥')).toBe(true);
    });

    it('returns true for mixed punctuation and emoji', () => {
        expect(isPunctuationOnly('... 🎉')).toBe(true);
    });

    it('returns false for empty string', () => {
        expect(isPunctuationOnly('')).toBe(false);
    });

    it('returns false for text with any letter', () => {
        expect(isPunctuationOnly('ok')).toBe(false);
        expect(isPunctuationOnly('تم')).toBe(false);
        expect(isPunctuationOnly('. ok')).toBe(false);
    });

    it('returns false for text with digits', () => {
        expect(isPunctuationOnly('123')).toBe(false);
        expect(isPunctuationOnly('. 5')).toBe(false);
    });
});
