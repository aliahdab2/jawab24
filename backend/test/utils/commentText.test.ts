import { describe, it, expect } from 'vitest';
import {
    stripCommentNoise,
    hasMention,
    isPunctuationOnly,
    isContentFree,
    stripTagsByOffsets,
    hasUserTag,
    hasOwnPageTag,
    isConfidentlyNotATag,
    type FacebookMessageTag,
} from '../../src/utils/commentText';

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

describe('isContentFree', () => {
    it('returns true for punctuation, emoji, and combinations', () => {
        expect(isContentFree('.')).toBe(true);
        expect(isContentFree('...')).toBe(true);
        expect(isContentFree('❤️')).toBe(true);
        expect(isContentFree('🎉🔥')).toBe(true);
        expect(isContentFree('... 🎉')).toBe(true);
    });

    it('returns true for digit-only CTA tokens (any script)', () => {
        // ASCII digits
        expect(isContentFree('0')).toBe(true);
        expect(isContentFree('000')).toBe(true);
        expect(isContentFree('123')).toBe(true);
        // Arabic-Indic digits — the لامار الشام case
        expect(isContentFree('٠')).toBe(true);
        expect(isContentFree('٠٠٠')).toBe(true);
        // Mixed digits + punctuation/emoji
        expect(isContentFree('٠٠٠ ❤️')).toBe(true);
        expect(isContentFree('000.')).toBe(true);
    });

    it('returns false when any letter is present (any script)', () => {
        expect(isContentFree('ok')).toBe(false);
        expect(isContentFree('تم')).toBe(false);
        expect(isContentFree('. ok')).toBe(false);
        expect(isContentFree('٠٠ a')).toBe(false);
        // Future-language coverage — \p{L} catches every script.
        expect(isContentFree('好')).toBe(false);     // Chinese
        expect(isContentFree('สวัสดี')).toBe(false); // Thai
        expect(isContentFree('नमस्ते')).toBe(false); // Devanagari
    });

    it('returns false for empty string', () => {
        expect(isContentFree('')).toBe(false);
    });
});

describe('stripTagsByOffsets', () => {
    const userTag = (name: string, offset: number): FacebookMessageTag => ({
        id: '1', name, type: 'user', offset, length: name.length,
    });

    it('strips a single user tag covering the whole message', () => {
        expect(stripTagsByOffsets('Khadeja Alrefae', [userTag('Khadeja Alrefae', 0)])).toBe('');
    });

    it('strips a user tag prefix and keeps trailing Arabic', () => {
        expect(stripTagsByOffsets('Khadeja Alrefae شو السعر؟', [userTag('Khadeja Alrefae', 0)]))
            .toBe('شو السعر؟');
    });

    it('strips multiple tags in descending-offset order (offsets stay valid)', () => {
        const text = 'Ahmad Said and Khadeja Alrefae شو رأيكم؟';
        const tags: FacebookMessageTag[] = [
            userTag('Ahmad Said', 0),
            userTag('Khadeja Alrefae', 15),
        ];
        expect(stripTagsByOffsets(text, tags)).toBe('and شو رأيكم؟');
    });

    it('returns input unchanged when tags is null or empty', () => {
        expect(stripTagsByOffsets('hello', null)).toBe('hello');
        expect(stripTagsByOffsets('hello', [])).toBe('hello');
        expect(stripTagsByOffsets('hello', undefined)).toBe('hello');
    });

    it('skips malformed tags (offset beyond message length) without throwing', () => {
        const tags: FacebookMessageTag[] = [{
            id: '1', name: 'Ghost', type: 'user', offset: 100, length: 5,
        }];
        expect(stripTagsByOffsets('hi', tags)).toBe('hi');
    });

    it('skips tags with negative offset or zero length', () => {
        const tags: FacebookMessageTag[] = [
            { id: '1', name: 'X', type: 'user', offset: -1, length: 3 },
            { id: '2', name: 'Y', type: 'user', offset: 0, length: 0 },
        ];
        expect(stripTagsByOffsets('hello', tags)).toBe('hello');
    });

    it('collapses resulting whitespace', () => {
        expect(stripTagsByOffsets('hi   Khadeja Alrefae   شكرا', [userTag('Khadeja Alrefae', 5)]))
            .toBe('hi شكرا');
    });

    it('rejects overlapping tags (keeps the first-seen in descending order)', () => {
        // Text layout:        "AAAAAAABBBBBBBB"
        // Tag 1 (user@0/10):  "AAAAAAAAAA"         covers 0..9
        // Tag 2 (user@5/10):  "     BBBBBBBBBB"    covers 5..14 — overlaps tag 1 by 5 chars
        // After sorting desc-by-offset, tag 2 is processed first and slices 5..14.
        // Tag 1's range (0..9) now extends past the new minOffset (5) → overlap → skipped.
        // Without the overlap guard we'd slice out of-sync chars, producing garbage.
        const text = 'AAAAABBBBBCCCCC'; // 15 chars
        const tags: FacebookMessageTag[] = [
            { id: '1', name: 'first', type: 'user', offset: 0, length: 10 },
            { id: '2', name: 'second', type: 'user', offset: 5, length: 10 },
        ];
        // Descending-by-offset: tag 2 first (removes 5..14), tag 1 overlaps → skipped.
        // Result: 'AAAAA' (chars 0..4 remain).
        expect(stripTagsByOffsets(text, tags)).toBe('AAAAA');
    });

    it('handles emoji in tag span (UTF-16 surrogate pair correctness)', () => {
        // "🎉" is one emoji, two UTF-16 code units. Tag offset/length must match FB's
        // UTF-16 counting — we don't transform, just slice, so this is a direct check.
        const text = '🎉 hello';         // code units: 🎉=0,1 ' '=2 h=3 e=4 l=5 l=6 o=7
        const tags: FacebookMessageTag[] = [
            { id: '1', name: '🎉', type: 'user', offset: 0, length: 2 },
        ];
        expect(stripTagsByOffsets(text, tags)).toBe('hello');
    });

    it('skips NaN/Infinity offsets', () => {
        const tags: FacebookMessageTag[] = [
            { id: '1', name: 'X', type: 'user', offset: NaN, length: 5 },
            { id: '2', name: 'Y', type: 'user', offset: 0, length: Infinity },
        ];
        expect(stripTagsByOffsets('hello world', tags)).toBe('hello world');
    });
});

describe('hasUserTag', () => {
    it('returns true when at least one user-type tag is present', () => {
        const tags: FacebookMessageTag[] = [
            { id: '1', name: 'A', type: 'user', offset: 0, length: 1 },
            { id: '2', name: 'B', type: 'page', offset: 2, length: 1 },
        ];
        expect(hasUserTag(tags)).toBe(true);
    });

    it('returns false when only page-type tags are present', () => {
        const tags: FacebookMessageTag[] = [
            { id: '1', name: 'P', type: 'page', offset: 0, length: 1 },
        ];
        expect(hasUserTag(tags)).toBe(false);
    });

    it('returns false for null / empty', () => {
        expect(hasUserTag(null)).toBe(false);
        expect(hasUserTag(undefined)).toBe(false);
        expect(hasUserTag([])).toBe(false);
    });
});

describe('hasOwnPageTag', () => {
    const tags: FacebookMessageTag[] = [
        { id: 'user_x', name: 'X', type: 'user', offset: 0, length: 1 },
        { id: 'page_mine', name: 'Mine', type: 'page', offset: 2, length: 4 },
    ];

    it('returns true when a page tag matches our page id', () => {
        expect(hasOwnPageTag(tags, 'page_mine')).toBe(true);
    });

    it('returns false when no page tag matches', () => {
        expect(hasOwnPageTag(tags, 'page_other')).toBe(false);
    });

    it('returns false when a user tag id coincidentally matches our page id', () => {
        expect(hasOwnPageTag(tags, 'user_x')).toBe(false);
    });

    it('returns false for null / empty / missing page id', () => {
        expect(hasOwnPageTag(null, 'page_mine')).toBe(false);
        expect(hasOwnPageTag(tags, null)).toBe(false);
        expect(hasOwnPageTag(tags, undefined)).toBe(false);
        expect(hasOwnPageTag([], 'page_mine')).toBe(false);
    });
});

describe('isConfidentlyNotATag', () => {
    // Returns TRUE when we're certain the text is not a bare user tag —
    // i.e. when the caller can safely skip the Graph API tag fetch. Short
    // bare-name strings must return FALSE so the caller enriches via Graph.

    it('returns false for short bare Latin name (the Ali Ahdab case)', () => {
        expect(isConfidentlyNotATag('Ali Ahdab')).toBe(false);
    });

    it('returns false for short bare Arabic name', () => {
        expect(isConfidentlyNotATag('أحمد')).toBe(false);
    });

    it('returns false for two-word Arabic name', () => {
        expect(isConfidentlyNotATag('خديجة الرفاعي')).toBe(false);
    });

    it('returns true for comment with a question mark', () => {
        expect(isConfidentlyNotATag('شو السعر؟')).toBe(true);
        expect(isConfidentlyNotATag('what is the price?')).toBe(true);
    });

    // ── The Shahin Resort friend-tag leak (prod, 2026-08-24) ──
    //
    // Comment a2d0d3fb-bed5-43f2-a77a-35ae85c5cebd on Shahin Resort: a customer tagged
    // two friends and talked TO THEM about the post. Facebook delivered the webhook with
    // `message_tags` NULL, so `hasUserTag` was blind; the regex fallback `hasMention`
    // cannot help either, because a Facebook tag carries NO "@" in the message body —
    // the friends' names arrive as plain text. The Graph repair fetch in commentProcessor
    // exists precisely for this, but it is gated on `!isConfidentlyNotATag(...)`, and this
    // comment is 60 chars — so the OLD `length > 50` rule declared it "confidently not a
    // tag", skipped the fetch, and the page publicly answered a private exchange.
    //
    // The length rule was an uncorrelated proxy: two tagged names are already 28 chars and
    // THREE are 53, so it failed hardest on exactly the multi-tag comments most likely to
    // be friend-tagging. Measured on 30 days of production: it suppressed the fetch for
    // 553 comments (244 of which got an AI reply) while saving only 3.9% of fetch volume
    // (14,271 → 14,824). Removed in favour of the SEMANTIC signals below, which is why
    // there is no length assertion here any more.
    it('returns false for a friend-tag plus a real sentence (the Shahin Resort leak)', () => {
        // Exact production text, 60 chars, no digits / ?, / URL / currency.
        expect(isConfidentlyNotATag('Ruba Alhomosh  Sara Kaddoura  راحت علينا حفلة نادر الاتات 😁'))
            .toBe(false);
    });

    it('returns false for three tagged names alone (53 chars — over the old cap)', () => {
        expect(isConfidentlyNotATag('Ruba Alhomosh  Sara Kaddoura  Maryaam Alawwad Alhmosh'))
            .toBe(false);
    });

    it('returns false for long prose with no semantic not-a-tag signal', () => {
        // Length alone no longer proves anything — only the content signals do. A wasted
        // Graph fetch is cheap; a public reply to a private exchange is not (see above).
        expect(isConfidentlyNotATag('This is a long comment that definitely is not a tag it goes on'))
            .toBe(false);
    });

    it('still returns true for long text carrying a real not-a-tag signal', () => {
        // The signals that actually correlate keep working at any length.
        expect(isConfidentlyNotATag('This is a long comment that is definitely not a tag, right?'))
            .toBe(true);
        expect(isConfidentlyNotATag('هل يمكنكم إخباري بتفاصيل الحفلة القادمة والعرض المتوفر حالياً؟'))
            .toBe(true);
        expect(isConfidentlyNotATag('راحت علينا الحفلة الكبيرة وكانت التذكرة بـ 5000 ليرة سورية فقط'))
            .toBe(true);
    });

    it('returns true for text containing digits (prices, phones, dates)', () => {
        expect(isConfidentlyNotATag('100 ريال')).toBe(true);
        expect(isConfidentlyNotATag('call me on 0501234567')).toBe(true);
    });

    it('returns true for text containing currency tokens without digits', () => {
        expect(isConfidentlyNotATag('كم السعر بالريال')).toBe(true);
        expect(isConfidentlyNotATag('price in USD')).toBe(true);
    });

    it('returns true for text containing a URL', () => {
        expect(isConfidentlyNotATag('check https://example.com')).toBe(true);
        expect(isConfidentlyNotATag('www.example.com')).toBe(true);
    });

    it('returns true for empty/whitespace text (nothing to tag)', () => {
        expect(isConfidentlyNotATag('')).toBe(true);
        expect(isConfidentlyNotATag('   ')).toBe(true);
    });

    it('returns false for single-word bare token (ambiguous — could be a name)', () => {
        // Arabic single word that's also a common name — must let caller
        // verify via Graph API rather than decide from text alone.
        expect(isConfidentlyNotATag('Sarah')).toBe(false);
    });
});
