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
        expect(resolvePostReplyRule(content)).toEqual({ triggerType: 'keyword', triggerKeyword: 'سعر', triggerReply: 'تفضل السعر' });
    });

    it('resolves the per-post any-comment rule (reply set, no keyword)', () => {
        const content: ContentTriggerFields = { triggerKeyword: null, triggerReply: 'DM sent', triggerType: 'all' };
        expect(resolvePostReplyRule(content)).toEqual({ triggerType: 'all', triggerKeyword: null, triggerReply: 'DM sent' });
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
});

describe('evaluateAnyCommentGuard', () => {
    it('sends a benign comment', () => {
        expect(evaluateAnyCommentGuard({ skipReason: null, fallbackIntent: 'QUESTION', businessActionFlags: [] }))
            .toEqual({ action: 'send' });
    });

    it('skips when preprocess flagged a skip reason', () => {
        expect(evaluateAnyCommentGuard({ skipReason: 'friend_mention', fallbackIntent: undefined, businessActionFlags: [] }))
            .toEqual({ action: 'skip', reason: 'friend_mention' });
    });

    it('skips spam/irrelevant', () => {
        expect(evaluateAnyCommentGuard({ skipReason: null, fallbackIntent: 'SPAM_OR_IRRELEVANT', businessActionFlags: [] }))
            .toEqual({ action: 'skip', reason: 'spam' });
    });

    it('flags a business-action request (refund/cancel/exchange)', () => {
        expect(evaluateAnyCommentGuard({ skipReason: null, fallbackIntent: undefined, businessActionFlags: ['refund_request'] }))
            .toEqual({ action: 'flag', flagReason: 'refund_request' });
    });

    it('flags a complaint', () => {
        expect(evaluateAnyCommentGuard({ skipReason: null, fallbackIntent: 'COMPLAINT', businessActionFlags: [] }))
            .toEqual({ action: 'flag', flagReason: 'angry_customer' });
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
});
