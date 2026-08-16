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

describe('resolveBrandVoiceNotes — per-page override (D-084)', () => {
    const ws = { brandVoiceNotesMulti: { ar: 'صوت المساحة', en: 'Workspace voice' }, brandVoiceNotes: 'legacy voice', supportedLanguages: ['ar', 'en'] };

    it('page override wins over the workspace persona, per language', () => {
        const override = { ar: 'صوت الصفحة', en: 'Page voice' };
        expect(resolveBrandVoiceNotes(ws, 'كم السعر؟', override)).toBe('صوت الصفحة');
        expect(resolveBrandVoiceNotes(ws, 'How much?', override)).toBe('Page voice');
    });

    it('an explicit page persona is a PIN — no workspace and no legacy fallback', () => {
        // Override has only EN; an Arabic message picks the first supported
        // language with a value INSIDE the override — never the workspace text.
        expect(resolveBrandVoiceNotes(ws, 'كم السعر؟', { en: 'Page voice' })).toBe('Page voice');
    });

    it('NULL, {} and an all-cleared record all inherit the workspace persona', () => {
        expect(resolveBrandVoiceNotes(ws, 'كم السعر؟', null)).toBe('صوت المساحة');
        expect(resolveBrandVoiceNotes(ws, 'كم السعر؟', {})).toBe('صوت المساحة');
        expect(resolveBrandVoiceNotes(ws, 'كم السعر؟', undefined)).toBe('صوت المساحة');
        // Cleared languages + leftover bookkeeping key = inherit, not silence.
        expect(resolveBrandVoiceNotes(ws, 'كم السعر؟', { ar: '', en: '  ', sourceLang: 'ar' })).toBe('صوت المساحة');
    });

    it('sourceLang bookkeeping never counts as persona content', () => {
        expect(resolveBrandVoiceNotes(ws, 'hello', { sourceLang: 'ar' })).toBe('Workspace voice');
    });

    it('a page persona stored only outside supportedLanguages still applies (pin must not silence)', () => {
        expect(resolveBrandVoiceNotes(ws, 'hello', { fr: 'Voix de la page' })).toBe('Voix de la page');
    });

    it('workspace path stays byte-identical when no override is passed (fleet inertness)', () => {
        // Same four assertions as the legacy describe above, through the new signature.
        expect(resolveBrandVoiceNotes(ws, 'كم السعر؟')).toBe('صوت المساحة');
        expect(resolveBrandVoiceNotes({ brandVoiceNotesMulti: {}, brandVoiceNotes: 'legacy voice' }, 'hello')).toBe('legacy voice');
        expect(resolveBrandVoiceNotes({ brandVoiceNotesMulti: { fr: 'voix' }, brandVoiceNotes: 'legacy voice', supportedLanguages: ['ar', 'en'] }, 'hello')).toBeUndefined();
        expect(resolveBrandVoiceNotes({}, 'hello')).toBeUndefined();
    });
});

describe('resolveBrandVoiceNotes — override normalization (PR #777 review fixes)', () => {
    const ws = { brandVoiceNotesMulti: { ar: 'صوت المساحة', en: 'Workspace voice' }, brandVoiceNotes: 'legacy voice', supportedLanguages: ['ar', 'en'] };

    it('a whitespace-only variant neither pins alone nor is ever returned', () => {
        // { ar: real, en: '  ' }: an EN message must get the AR text through the
        // any-language tail — never the truthy whitespace string as the persona
        // (the pin has already suppressed the workspace fallback).
        expect(resolveBrandVoiceNotes(ws, 'hello', { ar: 'صوت الصفحة', en: '   ' })).toBe('صوت الصفحة');
    });

    it('a double-encoded override (jsonb persisted as a JSON string) still resolves', () => {
        // The business_profile precedent: the same jsonb family has stored
        // stringified JSON in production. coerceMultiLang unwraps it.
        expect(resolveBrandVoiceNotes(ws, 'كم السعر؟', JSON.stringify({ ar: 'صوت الصفحة' }))).toBe('صوت الصفحة');
    });

    it('a malformed string override inherits the workspace persona instead of crashing', () => {
        expect(resolveBrandVoiceNotes(ws, 'كم السعر؟', 'not-json')).toBe('صوت المساحة');
    });
});
