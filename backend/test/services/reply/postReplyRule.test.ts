import { describe, it, expect } from 'vitest';
import {
    resolvePostReplyRule,
    matchPostReplyRule,
    evaluateAnyCommentGuard,
    validatePostReplyRuleInput,
    type ContentTriggerFields,
} from '../../../src/services/reply/postReplyRule';

const noContentTrigger: ContentTriggerFields = {
    triggerKeyword: null,
    triggerReply: null,
    triggerType: 'keyword',
};

describe('resolvePostReplyRule', () => {
    it('resolves the per-post keyword rule', () => {
        const content: ContentTriggerFields = {
            triggerKeyword: 'سعر',
            triggerReply: 'تفضل السعر',
            triggerType: 'keyword',
        };
        expect(resolvePostReplyRule(content)).toEqual({ triggerType: 'keyword', triggerKeyword: 'سعر', triggerReply: 'تفضل السعر', triggerExcludeKeyword: null, triggerImageUrl: null, likeComment: false });
    });

    it('resolves the per-post any-comment rule (reply set, no keyword)', () => {
        const content: ContentTriggerFields = { triggerKeyword: null, triggerReply: 'DM sent', triggerType: 'all' };
        expect(resolvePostReplyRule(content)).toEqual({ triggerType: 'all', triggerKeyword: null, triggerReply: 'DM sent', triggerExcludeKeyword: null, triggerImageUrl: null, likeComment: false });
    });

    it('returns null when the content has no rule', () => {
        expect(resolvePostReplyRule(noContentTrigger)).toBeNull();
    });

    it('treats a keyword rule with no keyword as no rule (defensive)', () => {
        const content: ContentTriggerFields = { triggerKeyword: null, triggerReply: 'x', triggerType: 'keyword' };
        expect(resolvePostReplyRule(content)).toBeNull();
    });
});

describe('matchPostReplyRule', () => {
    it('any-comment matches any text with a null keyword', () => {
        const rule = { triggerType: 'all' as const, triggerKeyword: null, triggerReply: 'r' };
        expect(matchPostReplyRule(rule, 'literally anything 😀')).toEqual({ matched: true, keyword: null });
    });

    it('keyword matches when a configured keyword is present (Arabic-normalized)', () => {
        const rule = { triggerType: 'keyword' as const, triggerKeyword: 'سعر, price', triggerReply: 'r' };
        expect(matchPostReplyRule(rule, 'كم السعر؟')).toEqual({ matched: true, keyword: 'سعر' });
        expect(matchPostReplyRule(rule, 'what is the PRICE')).toEqual({ matched: true, keyword: 'price' });
    });

    it('keyword does not match unrelated text', () => {
        const rule = { triggerType: 'keyword' as const, triggerKeyword: 'price', triggerReply: 'r' };
        expect(matchPostReplyRule(rule, 'nice photo')).toEqual({ matched: false });
    });

    it('an excluded keyword vetoes a keyword-mode match (falls through to AI)', () => {
        const rule = { triggerType: 'keyword' as const, triggerKeyword: 'سعر', triggerReply: 'r', triggerExcludeKeyword: 'غالي, expensive' };
        // Comment matches the trigger keyword AND an exclude keyword → vetoed.
        expect(matchPostReplyRule(rule, 'السعر غالي جدا')).toEqual({ matched: false });
        // Same trigger keyword, no exclude term present → still matches.
        expect(matchPostReplyRule(rule, 'كم السعر؟')).toEqual({ matched: true, keyword: 'سعر' });
    });

    it('an excluded keyword vetoes an any-comment match too', () => {
        const rule = { triggerType: 'all' as const, triggerKeyword: null, triggerReply: 'r', triggerExcludeKeyword: 'شكوى' };
        expect(matchPostReplyRule(rule, 'عندي شكوى على المنتج')).toEqual({ matched: false });
        expect(matchPostReplyRule(rule, 'رائع')).toEqual({ matched: true, keyword: null });
    });
});

describe('evaluateAnyCommentGuard', () => {
    it('sends a benign comment', () => {
        expect(evaluateAnyCommentGuard({ skipReason: null, isContentFree: false, fallbackIntent: 'QUESTION', businessActionFlags: [] }))
            .toEqual({ action: 'send' });
    });

    it('skips when preprocess flagged a skip reason', () => {
        expect(evaluateAnyCommentGuard({ skipReason: 'friend_mention', isContentFree: false, fallbackIntent: undefined, businessActionFlags: [] }))
            .toEqual({ action: 'skip', reason: 'friend_mention' });
    });

    it('skips spam/irrelevant', () => {
        expect(evaluateAnyCommentGuard({ skipReason: null, isContentFree: false, fallbackIntent: 'SPAM_OR_IRRELEVANT', businessActionFlags: [] }))
            .toEqual({ action: 'skip', reason: 'spam' });
    });

    it('flags a business-action request (refund/cancel/exchange)', () => {
        expect(evaluateAnyCommentGuard({ skipReason: null, isContentFree: false, fallbackIntent: undefined, businessActionFlags: ['refund_request'] }))
            .toEqual({ action: 'flag', flagReason: 'refund_request' });
    });

    it('flags a complaint', () => {
        expect(evaluateAnyCommentGuard({ skipReason: null, isContentFree: false, fallbackIntent: 'COMPLAINT', businessActionFlags: [] }))
            .toEqual({ action: 'flag', flagReason: 'angry_customer' });
    });

    // D-021: content-free comments (dot/emoji CTA engagement) get the template.
    it('sends a dot comment even though the classifier calls it spam ("علق بنقطة" CTA)', () => {
        expect(evaluateAnyCommentGuard({ skipReason: null, isContentFree: true, fallbackIntent: 'SPAM_OR_IRRELEVANT', businessActionFlags: [] }))
            .toEqual({ action: 'send' });
    });

    it('sends a dot comment on a captionless post (punctuation_no_context is overridden)', () => {
        expect(evaluateAnyCommentGuard({ skipReason: 'punctuation_no_context', isContentFree: true, fallbackIntent: 'SPAM_OR_IRRELEVANT', businessActionFlags: [] }))
            .toEqual({ action: 'send' });
    });

    it('sends a non-compliment emoji-only comment (😂😂)', () => {
        expect(evaluateAnyCommentGuard({ skipReason: null, isContentFree: true, fallbackIntent: 'SPAM_OR_IRRELEVANT', businessActionFlags: [] }))
            .toEqual({ action: 'send' });
    });

    it('friend-tag skips win over content-free (owner directive: never template a friend tag)', () => {
        expect(evaluateAnyCommentGuard({ skipReason: 'friend_mention', isContentFree: true, fallbackIntent: undefined, businessActionFlags: [] }))
            .toEqual({ action: 'skip', reason: 'friend_mention' });
        expect(evaluateAnyCommentGuard({ skipReason: 'user_tag', isContentFree: true, fallbackIntent: undefined, businessActionFlags: [] }))
            .toEqual({ action: 'skip', reason: 'user_tag' });
    });

    it('promo-URL skips win over content-free', () => {
        expect(evaluateAnyCommentGuard({ skipReason: 'external_promo_url', isContentFree: true, fallbackIntent: 'SPAM_OR_IRRELEVANT', businessActionFlags: [] }))
            .toEqual({ action: 'skip', reason: 'external_promo_url' });
    });

    it('still skips punctuation_no_context when the raw text has letters (e.g. bare URL stripped to empty)', () => {
        expect(evaluateAnyCommentGuard({ skipReason: 'punctuation_no_context', isContentFree: false, fallbackIntent: undefined, businessActionFlags: [] }))
            .toEqual({ action: 'skip', reason: 'punctuation_no_context' });
    });
});

describe('validatePostReplyRuleInput', () => {
    it('accepts a valid keyword rule', () => {
        expect(validatePostReplyRuleInput({ triggerType: 'keyword', triggerKeyword: 'a, b', triggerReply: 'hi' })).toBeNull();
    });

    it('accepts a valid any-comment rule', () => {
        expect(validatePostReplyRuleInput({ triggerType: 'all', triggerKeyword: null, triggerReply: 'hi' })).toBeNull();
    });

    it('rejects any-comment with a keyword present', () => {
        expect(validatePostReplyRuleInput({ triggerType: 'all', triggerKeyword: 'x', triggerReply: 'hi' })).toMatch(/must be empty/);
    });

    it('rejects a missing reply', () => {
        expect(validatePostReplyRuleInput({ triggerType: 'keyword', triggerKeyword: 'x', triggerReply: null })).toMatch(/required/);
    });

    it('rejects more than 10 keywords', () => {
        const kw = Array.from({ length: 11 }, (_, i) => `k${i}`).join(',');
        expect(validatePostReplyRuleInput({ triggerType: 'keyword', triggerKeyword: kw, triggerReply: 'hi' })).toMatch(/exceed 10/);
    });

    it('rejects a bad triggerType', () => {
        expect(validatePostReplyRuleInput({ triggerType: 'nope', triggerKeyword: null, triggerReply: 'hi' })).toMatch(/keyword.*all/);
    });

    it('allows up to 1000 chars, and applies the same cap whether or not an image is attached', () => {
        const at1000 = 'x'.repeat(1000);
        const over = 'x'.repeat(1001);
        // The image is sent as its own message, so it never shortens the text budget —
        // the cap is a flat 1000 in every case.
        expect(validatePostReplyRuleInput({ triggerType: 'all', triggerKeyword: null, triggerReply: at1000 })).toBeNull();
        expect(validatePostReplyRuleInput({ triggerType: 'all', triggerKeyword: null, triggerReply: over })).toMatch(/1000/);
    });

    it('accepts exclude keywords within the 10-keyword limit (both modes)', () => {
        expect(validatePostReplyRuleInput({ triggerType: 'keyword', triggerKeyword: 'سعر', triggerReply: 'hi', triggerExcludeKeyword: 'غالي, expensive' })).toBeNull();
        expect(validatePostReplyRuleInput({ triggerType: 'all', triggerKeyword: null, triggerReply: 'hi', triggerExcludeKeyword: 'شكوى' })).toBeNull();
    });

    it('rejects more than 10 exclude keywords', () => {
        const kw = Array.from({ length: 11 }, (_, i) => `x${i}`).join(',');
        expect(validatePostReplyRuleInput({ triggerType: 'all', triggerKeyword: null, triggerReply: 'hi', triggerExcludeKeyword: kw })).toMatch(/exceed 10/);
    });

    it('rejects an over-long exclude keyword', () => {
        expect(validatePostReplyRuleInput({ triggerType: 'all', triggerKeyword: null, triggerReply: 'hi', triggerExcludeKeyword: 'y'.repeat(101) })).toMatch(/100 characters/);
    });
});

describe('resolvePostReplyRule — image', () => {
    it('carries triggerImageUrl through', () => {
        const rule = resolvePostReplyRule({ triggerKeyword: null, triggerReply: 'hi', triggerType: 'all', triggerImageUrl: 'https://cdn/x.jpg' });
        expect(rule?.triggerImageUrl).toBe('https://cdn/x.jpg');
    });
    it('defaults triggerImageUrl to null when absent', () => {
        const rule = resolvePostReplyRule({ triggerKeyword: 'k', triggerReply: 'hi', triggerType: 'keyword' });
        expect(rule?.triggerImageUrl).toBeNull();
    });
});

describe('resolvePostReplyRule — likeComment', () => {
    it('carries likeComment through when set', () => {
        const rule = resolvePostReplyRule({ triggerKeyword: 'k', triggerReply: 'hi', triggerType: 'keyword', likeComment: true });
        expect(rule?.likeComment).toBe(true);
    });
    it('defaults likeComment to false when absent (Instagram rows never carry it)', () => {
        const rule = resolvePostReplyRule({ triggerKeyword: null, triggerReply: 'hi', triggerType: 'all' });
        expect(rule?.likeComment).toBe(false);
    });
});
