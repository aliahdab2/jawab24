import { describe, it, expect } from 'vitest';
import { rankWarmCandidates, type WarmCandidateRow } from '../../src/services/cacheWarming';
import { normalizeForExactCacheKey } from '../../src/utils/exactCacheNormalize';
import { resolveBrandVoiceNotes } from '../../src/services/reply/contextEnricher';

function row(overrides: Partial<WarmCandidateRow>): WarmCandidateRow {
    return {
        message: 'كم السعر؟',
        pageId: 'page-1',
        postMessage: 'منشور المنتج',
        platform: 'facebook',
        messageTags: null,
        ...overrides,
    };
}

describe('normalizeForExactCacheKey', () => {
    it('matches the buildCacheKey pipeline: arabic-normalize, lowercase, strip symbols, collapse spaces', () => {
        expect(normalizeForExactCacheKey('كم السعر؟')).toBe('كم السعر');
        // Alef variants unify, Arabic-Indic digits convert, diacritics strip.
        expect(normalizeForExactCacheKey('أهلاً - الساعة ٥')).toBe(normalizeForExactCacheKey('اهلا الساعة 5'));
        expect(normalizeForExactCacheKey('  HELLO,   World!! ')).toBe('hello world');
    });
});

describe('rankWarmCandidates', () => {
    it('ranks by frequency and caps at topN', () => {
        const rows = [
            row({ message: 'متوفر؟' }),
            row({ message: 'كم السعر؟' }),
            row({ message: 'كم السعر' }),
            row({ message: 'كم  السعر!!' }),
            row({ message: 'الموقع وين' }),
        ];
        const ranked = rankWarmCandidates(rows, 2);
        expect(ranked).toHaveLength(2);
        expect(ranked[0].count).toBe(3);
        expect(normalizeForExactCacheKey(ranked[0].message)).toBe('كم السعر');
        expect(ranked[1].count).toBe(1);
    });

    it('groups spelling variants the way the cache key does (alef variants, punctuation, spacing)', () => {
        const ranked = rankWarmCandidates([
            row({ message: 'أهلا كم السعر؟' }),
            row({ message: 'اهلا كم السعر' }),
        ], 10);
        expect(ranked).toHaveLength(1);
        expect(ranked[0].count).toBe(2);
    });

    it('never merges across pages or posts — both are cache-key segments', () => {
        const ranked = rankWarmCandidates([
            row({}),
            row({ pageId: 'page-2' }),
            row({ postMessage: 'منشور آخر' }),
            row({ postMessage: null }),
        ], 10);
        expect(ranked).toHaveLength(4);
    });

    it('keeps the newest (first-seen) row fields per group — rows arrive newest-first', () => {
        const tags = [{ id: 't1', type: 'user' as const, offset: 0, length: 2 }];
        const ranked = rankWarmCandidates([
            row({ message: 'كم السعر؟', messageTags: tags, postMessage: 'الأحدث' }),
            row({ message: 'كم السعر', messageTags: null, postMessage: 'الأحدث' }),
        ], 10);
        expect(ranked).toHaveLength(1);
        expect(ranked[0].messageTags).toEqual(tags);
        expect(ranked[0].message).toBe('كم السعر؟');
    });

    it('drops rows whose text normalizes to empty and handles empty input', () => {
        expect(rankWarmCandidates([], 10)).toEqual([]);
        expect(rankWarmCandidates([row({ message: '؟؟!!' }), row({ message: '...' })], 10)).toEqual([]);
    });
});

describe('resolveBrandVoiceNotes (extracted from enrichPageContext — parity with the old inline rule)', () => {
    it('prefers the multi entry matching the message language', () => {
        const settings = { brandVoiceNotesMulti: { ar: 'صوت عربي', en: 'English voice' }, supportedLanguages: ['ar', 'en'] };
        expect(resolveBrandVoiceNotes(settings, 'كم السعر؟')).toBe('صوت عربي');
        expect(resolveBrandVoiceNotes(settings, 'How much is this?')).toBe('English voice');
    });

    it('falls back to the first supported language with a value', () => {
        const settings = { brandVoiceNotesMulti: { en: 'English voice' }, supportedLanguages: ['ar', 'en'] };
        expect(resolveBrandVoiceNotes(settings, 'كم السعر؟')).toBe('English voice');
    });

    it('uses the legacy column ONLY when the multi map has never been written', () => {
        expect(resolveBrandVoiceNotes({ brandVoiceNotesMulti: {}, brandVoiceNotes: 'legacy voice' }, 'hello')).toBe('legacy voice');
        // Once multi has any key, a cleared value must NOT resurrect the legacy column.
        expect(resolveBrandVoiceNotes({ brandVoiceNotesMulti: { fr: 'voix' }, brandVoiceNotes: 'legacy voice', supportedLanguages: ['ar', 'en'] }, 'hello')).toBeUndefined();
    });

    it('returns undefined when nothing is configured', () => {
        expect(resolveBrandVoiceNotes({}, 'hello')).toBeUndefined();
    });
});

describe('resolveBrandVoiceNotes — page-level override (pages.brand_voice_notes_multi)', () => {
    const userSettings = {
        brandVoiceNotesMulti: { ar: 'شخصية الحساب', en: 'Account persona' },
        brandVoiceNotes: 'legacy voice',
        supportedLanguages: ['ar', 'en'],
    };

    it('page multi wins over the user-level persona', () => {
        const pageMulti = { ar: 'شخصية الصفحة', en: 'Page persona' };
        expect(resolveBrandVoiceNotes(userSettings, 'كم السعر؟', pageMulti)).toBe('شخصية الصفحة');
        expect(resolveBrandVoiceNotes(userSettings, 'How much?', pageMulti)).toBe('Page persona');
    });

    it('language pick within the page multi mirrors the user-level rule (supported-language fallback)', () => {
        // Only EN authored on the page → an Arabic message still gets the page
        // persona via the supported-languages fallback, same as the user rule.
        expect(resolveBrandVoiceNotes(userSettings, 'كم السعر؟', { en: 'Page persona' })).toBe('Page persona');
        // Active override that resolves to nothing for any supported language →
        // undefined, NOT the user-level persona (mirrors how a written user
        // multi blocks the legacy column — no blending across levels).
        expect(resolveBrandVoiceNotes(userSettings, 'hello', { fr: 'voix de page' })).toBeUndefined();
    });

    it('absent / empty page multi falls through to the user-level rule', () => {
        expect(resolveBrandVoiceNotes(userSettings, 'كم السعر؟')).toBe('شخصية الحساب');
        expect(resolveBrandVoiceNotes(userSettings, 'كم السعر؟', undefined)).toBe('شخصية الحساب');
        expect(resolveBrandVoiceNotes(userSettings, 'كم السعر؟', {})).toBe('شخصية الحساب');
    });

    it('sourceLang-only page multi falls through (metadata is not content)', () => {
        expect(resolveBrandVoiceNotes(userSettings, 'كم السعر؟', { sourceLang: 'ar' })).toBe('شخصية الحساب');
    });

    it('a cleared page override (empty variants) falls through instead of silencing the account persona', () => {
        expect(resolveBrandVoiceNotes(userSettings, 'كم السعر؟', { ar: '', en: '  ', sourceLang: 'ar' })).toBe('شخصية الحساب');
    });

    it('an active page override still applies when the user has no persona at all', () => {
        expect(resolveBrandVoiceNotes({}, 'كم السعر؟', { ar: 'شخصية الصفحة' })).toBe('شخصية الصفحة');
    });

    it('coerces a double-encoded (stringified) page multi like settings reads do', () => {
        expect(resolveBrandVoiceNotes(userSettings, 'كم السعر؟', JSON.stringify({ ar: 'شخصية الصفحة' }))).toBe('شخصية الصفحة');
    });
});
