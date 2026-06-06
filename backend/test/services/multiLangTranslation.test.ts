import { describe, it, expect, vi } from 'vitest';
import { coerceMultiLang, smartTranslateMultiLang } from '../../src/services/multiLangTranslation';

describe('coerceMultiLang', () => {
    it('returns an object unchanged', () => {
        expect(coerceMultiLang({ ar: 'x', en: 'y' })).toEqual({ ar: 'x', en: 'y' });
    });
    it('parses a double-encoded JSON string into an object', () => {
        const encoded = JSON.stringify({ ar: 'مرحبا', en: 'hi', sourceLang: 'ar' });
        expect(coerceMultiLang(encoded)).toEqual({ ar: 'مرحبا', en: 'hi', sourceLang: 'ar' });
    });
    it('returns {} for invalid strings, null, or non-objects', () => {
        expect(coerceMultiLang('not json')).toEqual({});
        expect(coerceMultiLang(null)).toEqual({});
        expect(coerceMultiLang(undefined)).toEqual({});
        expect(coerceMultiLang(42)).toEqual({});
    });
});

describe('smartTranslateMultiLang', () => {
    const opts = (calls: Array<[string, string]>) => ({
        supportedLanguages: ['ar', 'en'],
        translate: async (text: string, src: 'ar' | 'en', tgt: 'ar' | 'en') => {
            calls.push([src, tgt]);
            return `${text} [${tgt}]`;
        },
    });

    it('translates EN when AR changes (object current)', async () => {
        const calls: Array<[string, string]> = [];
        const result = await smartTranslateMultiLang(
            { ar: 'نص جديد', en: 'old en', sourceLang: 'ar' },
            { ar: 'نص قديم', en: 'old en', sourceLang: 'ar' },
            'brandVoiceNotes',
            opts(calls),
        );
        expect(calls).toEqual([['ar', 'en']]);
        expect(result.en).toBe('نص جديد [en]');
        expect(result.sourceLang).toBe('ar');
    });

    it('REGRESSION: still translates when `current` arrives as a double-encoded JSON string', async () => {
        // Prod bug: brand_voice_notes_multi is stored double-encoded, so the driver
        // hands the controller a STRING. Without coercion, current['en'] is undefined,
        // so the re-sent unchanged EN reads as "changed" → changedKeys.length>1 →
        // sourceLang flips to 'manual' and EN never re-translates (stuck on old value).
        const currentAsString = JSON.stringify({ ar: 'نص قديم', en: 'old en', sourceLang: 'ar' });
        const calls: Array<[string, string]> = [];
        const result = await smartTranslateMultiLang(
            // frontend resends the unchanged EN alongside the new AR
            { ar: 'نص جديد مختلف', en: 'old en', sourceLang: 'ar' },
            currentAsString as unknown as Record<string, string>,
            'brandVoiceNotes',
            opts(calls),
        );
        expect(calls).toEqual([['ar', 'en']]);          // translation fired (bug = no call)
        expect(result.en).toBe('نص جديد مختلف [en]');    // EN re-translated from the new AR
        expect(result.sourceLang).toBe('ar');            // not wrongly flipped to 'manual'
    });

    it('preserves a hand-authored target (sourceLang=manual is sticky)', async () => {
        const calls: Array<[string, string]> = [];
        const result = await smartTranslateMultiLang(
            { ar: 'نص جديد', en: 'hand written en', sourceLang: 'ar' },
            { ar: 'نص قديم', en: 'hand written en', sourceLang: 'manual' },
            'brandVoiceNotes',
            opts(calls),
        );
        expect(calls).toEqual([]);                       // did NOT overwrite the manual EN
        expect(result.en).toBe('hand written en');
        expect(result.sourceLang).toBe('manual');
    });
});
