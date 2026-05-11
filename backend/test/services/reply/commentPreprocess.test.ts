import { describe, it, expect } from 'vitest';
import {
    preprocessCommentText,
    resolveCommentLanguage,
    rewritePunctuationForDualDm,
} from '../../../src/services/reply/commentPreprocess';
import type { FacebookMessageTag } from '../../../src/utils/commentText';

const userTag = (name: string, offset: number): FacebookMessageTag => ({
    id: 'u', name, type: 'user', offset, length: name.length,
});
const pageTag = (id: string, name: string, offset: number): FacebookMessageTag => ({
    id, name, type: 'page', offset, length: name.length,
});

describe('preprocessCommentText', () => {
    describe('user-tag rule', () => {
        it('skips a pure user-tag comment (no @ prefix in text)', () => {
            const r = preprocessCommentText({
                text: 'Khadeja Alrefae',
                messageTags: [userTag('Khadeja Alrefae', 0)],
                hasPostContext: true,
            });
            expect(r.skipReason).toBe('user_tag');
            expect(r.commentForAI).toBe('');
        });

        it('skips a user-tag comment even when trailing Arabic text is present', () => {
            const r = preprocessCommentText({
                text: 'Khadeja Alrefae شو السعر؟',
                messageTags: [userTag('Khadeja Alrefae', 0)],
                hasPostContext: true,
            });
            expect(r.skipReason).toBe('user_tag');
        });

        it('does NOT skip when a page-tag of our own page is also present', () => {
            // Text: "Jawab كم السعر؟" — page tag at start covers "Jawab" (5 chars), Arabic question follows
            const text = 'Jawab كم السعر؟';
            const tags: FacebookMessageTag[] = [
                pageTag('OUR_PAGE', 'Jawab', 0),
                userTag('Nobody', 100), // malformed offset — ignored
            ];
            const r = preprocessCommentText({
                text,
                messageTags: tags,
                ourFacebookPageId: 'OUR_PAGE',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe(null);
            expect(r.commentForAI).toContain('كم السعر');
        });

        it('skips when a page-tag matches a different page (not ours)', () => {
            const tags: FacebookMessageTag[] = [userTag('Khadeja Alrefae', 0)];
            const r = preprocessCommentText({
                text: 'Khadeja Alrefae شو السعر؟',
                messageTags: tags,
                ourFacebookPageId: 'OUR_PAGE',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe('user_tag');
        });

        it('user-tag rule wins when both structured tag AND regex @mention are present', () => {
            // Belt-and-suspenders case: the same commenter used both a structured
            // user-tag AND typed an @handle. We must never down-classify to the
            // regex path once a user-tag is confirmed — it could reply if the
            // regex path found >3 words of trailing content.
            const tags: FacebookMessageTag[] = [userTag('Khadeja Alrefae', 0)];
            const r = preprocessCommentText({
                text: 'Khadeja Alrefae @ahmad this is actually a real question about pricing',
                messageTags: tags,
                hasPostContext: true,
            });
            expect(r.skipReason).toBe('user_tag');
        });
    });

    describe('regex @mention fallback (no structured tags)', () => {
        it('skips a pure @mention', () => {
            const r = preprocessCommentText({
                text: '@Ahmad',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe('friend_mention');
            expect(r.hadMention).toBe(true);
        });

        it('skips @mention + ≤3 chatter words', () => {
            const r = preprocessCommentText({
                text: '@Ahmad check this',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe('friend_mention');
        });

        it('does not skip @mention + >3 words (real question)', () => {
            const r = preprocessCommentText({
                text: '@Ahmad can you please tell me the price of the course',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe(null);
        });
    });

    describe('punctuation-only skip', () => {
        it('skips punctuation-only comment when no post context', () => {
            const r = preprocessCommentText({ text: '...', hasPostContext: false });
            expect(r.skipReason).toBe('punctuation_no_context');
        });

        it('does NOT skip punctuation-only when post context is present (AI judges)', () => {
            const r = preprocessCommentText({ text: '...', hasPostContext: true });
            expect(r.skipReason).toBe(null);
        });

        it('skips empty-after-strip comment with no post context', () => {
            const r = preprocessCommentText({
                text: 'https://example.com',
                hasPostContext: false,
            });
            expect(r.skipReason).toBe('punctuation_no_context');
        });
    });

    describe('external promo URL skip', () => {
        // Pattern-level coverage lives in spamPatterns.test.ts. This test only verifies
        // that preprocessCommentText routes the signal to the expected skip reason.
        it('routes external-promo URLs to skipReason="external_promo_url"', () => {
            const r = preprocessCommentText({
                text: '#تعاون يعلن الفريق ❤️ https://www.facebook.com/groups/1416016389339694',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe('external_promo_url');
            expect(r.commentForAI).toBe('');
        });
    });

    describe('normal comments pass through', () => {
        it('returns cleaned text for a normal Arabic question', () => {
            const r = preprocessCommentText({
                text: 'كم سعر الدورة؟',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe(null);
            expect(r.commentForAI).toBe('كم سعر الدورة؟');
        });

        it('returns cleaned text after stripping URLs', () => {
            const r = preprocessCommentText({
                text: 'شو السعر https://example.com',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe(null);
            expect(r.commentForAI).toBe('شو السعر');
        });
    });
});

describe('resolveCommentLanguage', () => {
    it('returns Arabic for Arabic comment regardless of KB language', () => {
        expect(resolveCommentLanguage('كم السعر؟', undefined, 'English KB')).toBe('ar');
    });

    it('returns English for English comment on English KB', () => {
        expect(resolveCommentLanguage('how much is it?', undefined, 'English KB')).toBe('en');
    });

    it('flips short Latin-only comment to Arabic when KB is Arabic (ambiguous brand/product name)', () => {
        expect(resolveCommentLanguage('ICDL', undefined, 'دورات تدريبية متنوعة')).toBe('ar');
        expect(resolveCommentLanguage('Excel', undefined, 'دورات تدريبية متنوعة')).toBe('ar');
    });

    it('keeps English for long English comments even when KB is Arabic', () => {
        expect(
            resolveCommentLanguage('can you send me the full price list please', undefined, 'دورات'),
        ).toBe('en');
    });

    it('falls back to post language for script-less (empty/punctuation) comments', () => {
        expect(resolveCommentLanguage('', 'كم سعر الدورة؟', '')).toBe('ar');
    });
});

describe('rewritePunctuationForDualDm', () => {
    it('rewrites dot on Arabic CTA post to "أريد التفاصيل" in DM channel', () => {
        const out = rewritePunctuationForDualDm({
            commentForAI: '.',
            rawText: '.',
            postMessage: 'علق بنقطة لتصلك تفاصيل الدورة',
            effectiveChannel: 'dm',
        });
        expect(out).toBe('أريد التفاصيل');
    });

    it('rewrites emoji on English post to "I want the details" in DM channel', () => {
        const out = rewritePunctuationForDualDm({
            commentForAI: '👍',
            rawText: '👍',
            postMessage: 'Comment to get pricing on iPhone 15',
            effectiveChannel: 'dm',
        });
        expect(out).toBe('I want the details');
    });

    it('does not rewrite when channel is comment (only DM)', () => {
        const out = rewritePunctuationForDualDm({
            commentForAI: '.',
            rawText: '.',
            postMessage: 'علق بنقطة',
            effectiveChannel: 'comment',
        });
        expect(out).toBe('.');
    });

    it('does not rewrite when post message is missing', () => {
        const out = rewritePunctuationForDualDm({
            commentForAI: '.',
            rawText: '.',
            postMessage: undefined,
            effectiveChannel: 'dm',
        });
        expect(out).toBe('.');
    });

    it('does not rewrite real-text comments', () => {
        const out = rewritePunctuationForDualDm({
            commentForAI: 'كم السعر؟',
            rawText: 'كم السعر؟',
            postMessage: 'علق بنقطة',
            effectiveChannel: 'dm',
        });
        expect(out).toBe('كم السعر؟');
    });

    it('rewrites Arabic-Indic digit CTA "٠٠٠" on Arabic post (لامار الشام case)', () => {
        const out = rewritePunctuationForDualDm({
            commentForAI: '٠٠٠',
            rawText: '٠٠٠',
            postMessage: '#عروض 🔥 دورات بكلفة 25 الف فقط — ICDL، إسعافات، محاسبة الأمين. علق بنقطة ❤️⭕️',
            effectiveChannel: 'dm',
        });
        expect(out).toBe('أريد التفاصيل');
    });

    it('rewrites ASCII-digit CTA "000" on English post', () => {
        const out = rewritePunctuationForDualDm({
            commentForAI: '000',
            rawText: '000',
            postMessage: 'New iPhone 15 — comment 0 to get pricing!',
            effectiveChannel: 'dm',
        });
        expect(out).toBe('I want the details');
    });
});
