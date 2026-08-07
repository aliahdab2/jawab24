import {
    matchesKeyword,
    normalizeArabic,
    parseKeywords,
    isValidHttpUrl,
    POST_REPLY_MAX_KEYWORDS,
    POST_REPLY_MAX_KEYWORD_LEN,
    POST_REPLY_MAX_REPLY_LEN,
    POST_REPLY_BUTTON_LABEL_MAX,
} from '@jawab24/shared';
import type { CommentSkipReason } from './commentPreprocess';

/**
 * Post Reply rule resolution + matching + the any-comment guardrail.
 *
 * Post Reply fires a merchant-authored template on incoming comments, configured
 * per post. A rule triggers on either specific keywords ('keyword') or any comment
 * ('all'); if the post has no rule the comment falls through to the AI pipeline.
 *
 * Keyword mode is opt-in narrow and keeps its long-standing behavior. Any-comment
 * mode fires on everything, so before sending it MUST run the same skip rules the AI
 * path uses plus a no-AI complaint guard — see evaluateAnyCommentGuard.
 *
 * Kept in its own module (no DB / adapter deps) so the resolution + matching logic is
 * unit-testable in isolation and can't drift between the pipeline and its tests.
 */

export type PostReplyTriggerType = 'keyword' | 'all';

/** A content row's own per-post trigger fields (posts / instagramMedia). */
export interface ContentTriggerFields {
    triggerKeyword: string | null;
    triggerReply: string | null;
    /** 'keyword' | 'all'. Legacy rows / nulls are treated as 'keyword'. */
    triggerType: string | null;
    /** Comma-separated veto keywords: a comment containing any of them never fires the
     *  rule (both trigger modes) and falls through to the AI pipeline. Null/absent = none. */
    triggerExcludeKeyword?: string | null;
    /** Public URL of the attached image (DM-modes only), or null/absent when none. */
    triggerImageUrl?: string | null;
    /** Like the customer's comment after a successful send. Facebook-only column —
     *  instagramMedia rows never carry it. */
    likeComment?: boolean;
    /** Mention (@-tag) the commenter in the public comment we post. Facebook-only column —
     *  instagramMedia rows never carry it. */
    tagCommenter?: boolean;
    /** CTA link button (DM-modes only, Facebook-only): label + URL, stored together. */
    triggerButtonLabel?: string | null;
    triggerButtonUrl?: string | null;
}

export interface EffectivePostReplyRule {
    triggerType: PostReplyTriggerType;
    triggerKeyword: string | null;
    triggerReply: string;
    /** Veto keywords (comma-separated, or null): matching any of them blocks the rule. */
    triggerExcludeKeyword: string | null;
    /** Attached image URL, delivered only on the DM channel (private/dual). */
    triggerImageUrl: string | null;
    /** Page likes the customer's comment after the reply is sent (Facebook only). */
    likeComment: boolean;
    /** Public comment mentions (@-tags) the commenter (Facebook only). */
    tagCommenter: boolean;
    /** CTA link button (DM channel, Facebook only): { label, url } when both are set, else null. */
    cta: { label: string; url: string } | null;
}

/**
 * Resolve the effective Post Reply rule for a piece of content, or null if none.
 *
 * A rule "exists" iff the content carries a `triggerReply` — keyword mode stores
 * keyword+reply, any-comment mode stores reply only (the controller enforces this
 * consistency). A keyword-mode rule missing its keyword is treated as no rule
 * (defensive against inconsistent legacy rows).
 */
export function resolvePostReplyRule(content: ContentTriggerFields): EffectivePostReplyRule | null {
    if (!content.triggerReply) return null;
    const type: PostReplyTriggerType = content.triggerType === 'all' ? 'all' : 'keyword';
    if (type === 'keyword' && !content.triggerKeyword) return null;
    return {
        triggerType: type,
        triggerKeyword: content.triggerKeyword,
        triggerReply: content.triggerReply,
        triggerExcludeKeyword: content.triggerExcludeKeyword ?? null,
        triggerImageUrl: content.triggerImageUrl ?? null,
        likeComment: content.likeComment ?? false,
        tagCommenter: content.tagCommenter ?? false,
        // Button is delivered only when BOTH label and URL are present (they're stored together).
        cta: content.triggerButtonLabel && content.triggerButtonUrl
            ? { label: content.triggerButtonLabel, url: content.triggerButtonUrl }
            : null,
    };
}

export type PostReplyMatch =
    | { matched: true; keyword: string | null }
    | { matched: false };

/**
 * Does a comment satisfy the rule's trigger?
 *   Exclude keywords veto FIRST (both modes): a comment containing any excluded keyword
 *   never matches — it falls through to the AI pipeline like a non-matching comment.
 *   'all'     → any (non-vetoed) comment matches (keyword: null). The caller then applies the guard.
 *   'keyword' → returns the first matching keyword, else no match.
 * Matching mirrors the long-standing per-post logic (Arabic-normalized, shared
 * matchesKeyword) so behavior is identical to before for keyword rules.
 */
export function matchPostReplyRule(rule: EffectivePostReplyRule, commentMessage: string): PostReplyMatch {
    const normalizedComment = normalizeArabic(commentMessage.toLowerCase());
    if (rule.triggerExcludeKeyword) {
        const excluded = parseKeywords(rule.triggerExcludeKeyword).some(kw =>
            matchesKeyword(normalizedComment, normalizeArabic(kw.toLowerCase())),
        );
        if (excluded) return { matched: false };
    }
    if (rule.triggerType === 'all') {
        return { matched: true, keyword: null };
    }
    if (!rule.triggerKeyword) return { matched: false };
    const keywords = parseKeywords(rule.triggerKeyword);
    const matchedKeyword = keywords.find(kw =>
        matchesKeyword(normalizedComment, normalizeArabic(kw.toLowerCase())),
    );
    return matchedKeyword ? { matched: true, keyword: matchedKeyword } : { matched: false };
}

export interface PostReplyRuleInput {
    triggerType: string;            // expected 'keyword' | 'all'
    triggerKeyword: string | null;  // already trimmed by the caller, or null
    triggerReply: string | null;    // already trimmed by the caller, or null
    /** Veto keywords, already trimmed, or null/absent when none. Valid in both modes. */
    triggerExcludeKeyword?: string | null;
    /** CTA button label + URL — both required together, or both null/absent. */
    triggerButtonLabel?: string | null;
    triggerButtonUrl?: string | null;
}


/**
 * Validate a Post Reply rule payload. Returns an error message when invalid, or null
 * when valid. Callers handle "clear the rule" (no reply) separately — this validates
 * the SET case only. The reply cap is a flat 1000 chars whether or not an image is
 * attached (an image is sent as its own message, so it never eats into the text budget).
 *   - keyword mode: reply required (≤1000), 1–10 keywords, ≤100 chars each.
 *   - any-comment mode: reply required (≤1000); keyword must be absent.
 *   - both modes: optional exclude keywords, same 10 × 100-char limits.
 */
export function validatePostReplyRuleInput(input: PostReplyRuleInput): string | null {
    const { triggerType, triggerKeyword, triggerReply, triggerExcludeKeyword, triggerButtonLabel, triggerButtonUrl } = input;
    if (triggerType !== 'keyword' && triggerType !== 'all') {
        return 'triggerType must be "keyword" or "all"';
    }
    if (!triggerReply) return 'triggerReply is required';
    if (triggerReply.length > POST_REPLY_MAX_REPLY_LEN) {
        return `triggerReply must be ${POST_REPLY_MAX_REPLY_LEN} characters or fewer`;
    }
    if (triggerExcludeKeyword) {
        const excludes = parseKeywords(triggerExcludeKeyword);
        if (excludes.length > POST_REPLY_MAX_KEYWORDS) {
            return `triggerExcludeKeyword must not exceed ${POST_REPLY_MAX_KEYWORDS} keywords`;
        }
        if (excludes.some(k => k.length > POST_REPLY_MAX_KEYWORD_LEN)) {
            return `Each excluded keyword must be ${POST_REPLY_MAX_KEYWORD_LEN} characters or fewer`;
        }
    }
    // CTA button: label + URL are all-or-nothing. Validate label length, URL scheme, and —
    // when there's no image — the button-template text cap (Meta's 640, tighter than 1000).
    if (triggerButtonLabel || triggerButtonUrl) {
        if (!triggerButtonLabel || !triggerButtonUrl) {
            return 'triggerButtonLabel and triggerButtonUrl must both be set or both empty';
        }
        if (triggerButtonLabel.length > POST_REPLY_BUTTON_LABEL_MAX) {
            return `triggerButtonLabel must be ${POST_REPLY_BUTTON_LABEL_MAX} characters or fewer`;
        }
        if (!isValidHttpUrl(triggerButtonUrl)) {
            return 'triggerButtonUrl must be a valid http(s) URL';
        }
        // The button-template text cap (640, tighter than 1000) applies only when the button
        // is delivered WITHOUT an image — enforced in postsService.updateTrigger, which knows
        // the final image state (stored + this request's intent).
    }
    if (triggerType === 'all') {
        if (triggerKeyword) return 'triggerKeyword must be empty when triggerType is "all"';
        return null;
    }
    if (!triggerKeyword) return 'triggerKeyword is required when triggerType is "keyword"';
    const parts = parseKeywords(triggerKeyword);
    if (parts.length === 0) return 'triggerKeyword must contain at least one keyword';
    if (parts.length > POST_REPLY_MAX_KEYWORDS) {
        return `triggerKeyword must not exceed ${POST_REPLY_MAX_KEYWORDS} keywords`;
    }
    if (parts.some(k => k.length > POST_REPLY_MAX_KEYWORD_LEN)) {
        return `Each keyword must be ${POST_REPLY_MAX_KEYWORD_LEN} characters or fewer`;
    }
    return null;
}

export type AnyCommentGuardVerdict =
    | { action: 'send' }
    | { action: 'skip'; reason: string }       // silent spam skip (resolve, no notification)
    | { action: 'flag'; flagReason: string };   // route to needs_attention (notify merchant)

/**
 * Guardrail for any-comment (triggerType 'all') template sends. Keyword mode is
 * opt-in narrow and keeps its existing behavior; any-comment fires on EVERY comment,
 * so it must not template-reply to spam or complaints:
 *   - friend_mention / user_tag / external_promo_url preprocess skipReason          → skip
 *   - content-free comment ("." / "٠٠٠" / emoji-only)                               → send
 *   - any other preprocess skipReason (e.g. bare URL stripped to empty)             → skip
 *   - SPAM_OR_IRRELEVANT fallback intent (spam keywords)                            → skip
 *   - a business-action flag (refund / cancellation / exchange)                     → flag
 *   - COMPLAINT fallback intent (angry customer)                                    → flag
 *   - otherwise                                                                     → send
 *
 * Content-free comments SEND on purpose (D-021, reverses the PR #389 skip): "علق
 * بنقطة" (comment a dot) is the canonical campaign this mode exists for, and the
 * fixed template needs no comprehension — the AI path's "nothing to answer"
 * rationale doesn't apply. No post-context requirement either: on Instagram the
 * CTA often lives inside the image with an empty caption. Content-free wins over
 * `punctuation_no_context` but NOT over the tag/spam skips — friend-tag chatter
 * must never get a template (owner directive), and a tagged name always carries
 * letters so a tag comment can't read as content-free anyway; the ordering is
 * belt-and-braces.
 *
 * Pure function over already-computed signals so it's unit-testable; the caller
 * supplies the preprocess skipReason, the content-free signal, the fallback
 * intent, and the business flags.
 */
export function evaluateAnyCommentGuard(opts: {
    skipReason: CommentSkipReason | null;
    /** `isContentFree(commentForAI || rawText)` — no letters in any script. */
    isContentFree: boolean;
    fallbackIntent: string | undefined;
    businessActionFlags: string[];
}): AnyCommentGuardVerdict {
    if (opts.skipReason && opts.skipReason !== 'punctuation_no_context') {
        return { action: 'skip', reason: opts.skipReason };
    }
    if (opts.isContentFree) return { action: 'send' };
    if (opts.skipReason) return { action: 'skip', reason: opts.skipReason };
    if (opts.fallbackIntent === 'SPAM_OR_IRRELEVANT') return { action: 'skip', reason: 'spam' };
    if (opts.businessActionFlags.length > 0) return { action: 'flag', flagReason: opts.businessActionFlags.join(',') };
    if (opts.fallbackIntent === 'COMPLAINT') return { action: 'flag', flagReason: 'angry_customer' };
    return { action: 'send' };
}
