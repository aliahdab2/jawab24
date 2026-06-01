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

    // Unicode-script-based detection (was regex-three-scripts before). These
    // tests pin the screenshot-bug scenario: a Burmese-speaking customer's
    // comment must not silently fall through to 'en'.
    it('returns my for Burmese script', () => {
        expect(detectLanguageOrNull('ဈေးဘယ်လောက်လဲ')).toBe('my');
    });
    it('returns th for Thai script', () => {
        expect(detectLanguageOrNull('สวัสดี')).toBe('th');
    });
    it('returns ja for Japanese (Hiragana/Katakana, checked before Han)', () => {
        expect(detectLanguageOrNull('こんにちは')).toBe('ja');
        expect(detectLanguageOrNull('カタカナ')).toBe('ja');
        // Mixed kanji + hiragana — must still resolve to ja, not zh
        expect(detectLanguageOrNull('日本語です')).toBe('ja');
    });
    it('returns zh for pure Han script', () => {
        expect(detectLanguageOrNull('你好')).toBe('zh');
    });
    it('returns ko for Hangul', () => {
        expect(detectLanguageOrNull('안녕하세요')).toBe('ko');
    });
    it('returns ru for Cyrillic', () => {
        expect(detectLanguageOrNull('привет')).toBe('ru');
    });
    it('returns hi for Devanagari', () => {
        expect(detectLanguageOrNull('नमस्ते')).toBe('hi');
    });
    it('returns he for Hebrew', () => {
        expect(detectLanguageOrNull('שלום')).toBe('he');
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

    it('does not let a prior ambiguous Latin token re-anchor an Arabic thread to English', () => {
        // Prod 2026-06-01: the most-recent user turn is a bare course-name token
        // ("Icdl"); an older user turn is Arabic. Before the fromRole ambiguous-token
        // filter, fromRole('user') resolved to 'en' from "Icdl" and replied English.
        // It must skip the token and resolve 'ar' from the older Arabic turn.
        expect(
            resolveInputLanguage({
                comment: 'IcDL',
                conversationHistory: [
                    { role: 'user', content: 'مرحبا بدي أعرف عن الدورات' },
                    { role: 'assistant', content: 'دورة ICDL كلفتها 25 الف ل.س' },
                    { role: 'user', content: 'Icdl' },
                    { role: 'assistant', content: 'دورة ICDL كلفتها 25 الف ل.س' },
                ],
            }),
        ).toBe('ar');
    });

    it('falls through to assistant history when every user turn is an ambiguous Latin token', () => {
        // No real-language user signal exists, so the bot's own Arabic turn anchors.
        expect(
            resolveInputLanguage({
                comment: 'ok',
                conversationHistory: [
                    { role: 'user', content: 'yes' },
                    { role: 'user', content: 'ok' },
                    { role: 'assistant', content: 'مرحبا، كيف فيني ساعدك؟' },
                ],
            }),
        ).toBe('ar');
    });

    it('does not treat a mixed-script history turn as an ambiguous token', () => {
        // "بدي ICDL" contains Arabic script → detectLanguageOrNull → 'ar', so it is
        // not ambiguous and stays a valid Arabic anchor.
        expect(
            resolveInputLanguage({
                comment: 'hi',
                conversationHistory: [
                    { role: 'user', content: 'بدي ICDL' },
                ],
            }),
        ).toBe('ar');
    });

    it('the auto-reply assistant anchor recovers a genuine English customer', () => {
        // A short English opener ("hello") is structurally ambiguous and gets skipped
        // in history, but because Jawab24 auto-replies to every message the bot's
        // prior English turn is always present and anchors the language back to 'en'.
        // This is why the structural (length-based) ambiguous-token filter is
        // sufficient in practice — the assistant anchor covers short English words.
        expect(
            resolveInputLanguage({
                comment: 'ICDL',
                conversationHistory: [
                    { role: 'user', content: 'hello' },
                    { role: 'assistant', content: 'Hi! How can I help?' },
                ],
                postMessage: 'دورات ال ICDL',
            }),
        ).toBe('en');
    });

    it('documents the residual: a short English word alone in history does not anchor', () => {
        // KNOWN, ACCEPTED TRADEOFF of the structural ambiguous-token filter: when the
        // ONLY signal is a short English word in history (no assistant turn yet) and
        // the post is Arabic, the word is skipped and we fall to the Arabic post.
        // This window does not occur in the live auto-reply pipeline (an assistant
        // turn always exists by the 2nd user message — see the test above). Pinned to
        // 'ar' to document behavior; if a future change makes the skip
        // ENGLISH_COMMON-aware, flip this to 'en' deliberately.
        expect(
            resolveInputLanguage({
                comment: 'ICDL',
                conversationHistory: [
                    { role: 'user', content: 'hello' },
                ],
                postMessage: 'دورات ال ICDL',
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
