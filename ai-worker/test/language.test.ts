import { describe, it, expect } from 'vitest';
import {
    detectLanguageOrNull,
    detectLanguage,
    isAmbiguousLatinToken,
    resolveInputLanguage,
} from '../src/services/language';

describe('detectLanguageOrNull', () => {
    it('returns ar for Arabic text', () => {
        expect(detectLanguageOrNull('مرحبا')).toBe('ar');
    });
    it('returns en for Latin text', () => {
        expect(detectLanguageOrNull('hello')).toBe('en');
    });
    it('returns sv for Swedish-specific characters', () => {
        expect(detectLanguageOrNull('hej då')).toBe('sv');
    });
    it('returns null for punctuation-only', () => {
        expect(detectLanguageOrNull('...')).toBeNull();
    });
    it('returns null for emoji-only', () => {
        expect(detectLanguageOrNull('🔥💖')).toBeNull();
    });
    it('returns null for digits-only', () => {
        expect(detectLanguageOrNull('12345')).toBeNull();
    });
    it('returns null for empty string', () => {
        expect(detectLanguageOrNull('')).toBeNull();
    });
    it('returns ar when Arabic mixed with Latin', () => {
        // Arabic check runs first — any Arabic character wins.
        expect(detectLanguageOrNull('hello مرحبا')).toBe('ar');
    });
});

describe('detectLanguage', () => {
    it('falls back to en when no script is detectable', () => {
        expect(detectLanguage('...')).toBe('en');
        expect(detectLanguage('')).toBe('en');
    });
    it('agrees with detectLanguageOrNull when script is present', () => {
        expect(detectLanguage('مرحبا')).toBe('ar');
        expect(detectLanguage('hello')).toBe('en');
    });
});

describe('isAmbiguousLatinToken', () => {
    it('flags short single-word Latin acronyms', () => {
        expect(isAmbiguousLatinToken('ICDL')).toBe(true);
        expect(isAmbiguousLatinToken('GPS')).toBe(true);
        expect(isAmbiguousLatinToken('iPhone')).toBe(true);
        expect(isAmbiguousLatinToken('ok')).toBe(true);
    });
    it('flags acronyms with surrounding whitespace once trimmed', () => {
        expect(isAmbiguousLatinToken('  ICDL  ')).toBe(true);
    });
    it('does NOT flag multi-word English (has whitespace)', () => {
        expect(isAmbiguousLatinToken('hello world')).toBe(false);
        expect(isAmbiguousLatinToken('how much')).toBe(false);
    });
    it('does NOT flag long Latin tokens (>10 chars)', () => {
        expect(isAmbiguousLatinToken('Antibioticum')).toBe(false);
    });
    it('does NOT flag Arabic input', () => {
        expect(isAmbiguousLatinToken('مرحبا')).toBe(false);
    });
    it('does NOT flag script-less input', () => {
        expect(isAmbiguousLatinToken('...')).toBe(false);
        expect(isAmbiguousLatinToken('🔥')).toBe(false);
        expect(isAmbiguousLatinToken('')).toBe(false);
    });
});

describe('resolveInputLanguage', () => {
    it('honors explicit override above everything', () => {
        expect(
            resolveInputLanguage({
                comment: 'hello',
                language: 'ar',
                postMessage: 'hello world',
            }),
        ).toBe('ar');
    });

    it('uses user history when present even if current message is ambiguous Latin', () => {
        expect(
            resolveInputLanguage({
                comment: 'ICDL',
                conversationHistory: [
                    { role: 'user', content: 'مرحبا بدي أعرف عن الدورات' },
                ],
            }),
        ).toBe('ar');
    });

    it('falls back to assistant history when no user history has script', () => {
        // Regression: dual-DM opener where only the bot has spoken.
        expect(
            resolveInputLanguage({
                comment: 'Icdl',
                conversationHistory: [
                    { role: 'assistant', content: 'أهلاً، عنا دورات متنوعة' },
                ],
            }),
        ).toBe('ar');
    });

    it('prefers user history over assistant drift', () => {
        // If the bot drifted to English, the user's earlier Arabic must still win.
        expect(
            resolveInputLanguage({
                comment: 'Icdl',
                conversationHistory: [
                    { role: 'user', content: 'مرحبا بدي أعرف عن الدورات' },
                    { role: 'assistant', content: 'Hello! How can I help?' },
                ],
            }),
        ).toBe('ar');
    });

    it('defers ambiguous Latin token to Arabic post language', () => {
        // Regression from production screenshot 2026-05-19:
        // First-message DM "ICDL" on an Arabic post must reply in Arabic.
        expect(
            resolveInputLanguage({
                comment: 'ICDL',
                postMessage: 'دورات ال ICDL بكلفة 25 الف ل.س',
            }),
        ).toBe('ar');
    });

    it('still picks English for real multi-word English even when post is Arabic', () => {
        expect(
            resolveInputLanguage({
                comment: 'how much is the ICDL course?',
                postMessage: 'دورات ال ICDL بكلفة 25 الف ل.س',
            }),
        ).toBe('en');
    });

    it('uses KB text when comment is ambiguous and post is empty', () => {
        expect(
            resolveInputLanguage({
                comment: 'GPS',
                kbText: 'الخدمات المتوفرة لدينا تشمل تتبع المركبات',
            }),
        ).toBe('ar');
    });

    it('treats punctuation-only comment as ambiguous and uses post', () => {
        expect(
            resolveInputLanguage({
                comment: '...',
                postMessage: 'مرحبا',
            }),
        ).toBe('ar');
    });

    it('uses comment language as last-resort when no other signal exists', () => {
        // Even an ambiguous Latin token wins over nothing — better than 'en' default.
        expect(
            resolveInputLanguage({
                comment: 'ICDL',
            }),
        ).toBe('en');
    });

    it('honors defaultReplyLanguage when comment has no script and no context', () => {
        expect(
            resolveInputLanguage({
                comment: '🔥',
                defaultReplyLanguage: 'ar',
            }),
        ).toBe('ar');
    });

    it('falls back to en when nothing matches', () => {
        expect(resolveInputLanguage({ comment: '' })).toBe('en');
    });
});
