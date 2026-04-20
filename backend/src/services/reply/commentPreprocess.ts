import {
    stripCommentNoise,
    hasMention,
    isPunctuationOnly,
    hasUserTag,
    hasOwnPageTag,
    stripTagsByOffsets,
    type FacebookMessageTag,
} from '../../utils/commentText';
import { detectCommentLanguage, detectLanguageCode } from '../../utils/language';

/** Threshold below which a @mention comment is treated as friend-tagging
 *  (peer-to-peer chatter), not a real question. Pre-existing value from the
 *  2026-04-10 @mention fix; kept in one place so changes don't drift between
 *  the regex fallback path and any downstream consumer. */
const FRIEND_MENTION_WORD_LIMIT = 3;

/** Reason the comment pipeline should skip silently (no AI call, no reply). */
export type CommentSkipReason =
    /** Facebook user-tag without a matching page-tag — peer-to-peer, not for us. */
    | 'user_tag'
    /** Regex @mention with empty or ≤3-word trailing text — friend-tagging. */
    | 'friend_mention'
    /** Comment is punctuation/emoji only and there's no post context to anchor a reply. */
    | 'punctuation_no_context';

export interface CommentPreprocessResult {
    /** Trimmed, noise-free text to feed downstream (AI, RAG). Empty when fully stripped. */
    commentForAI: string;
    /** When set, pipeline MUST skip silently and emit intent `SPAM_OR_IRRELEVANT`.
     *  `null` means "continue to language resolution and AI call". */
    skipReason: CommentSkipReason | null;
    /** True when the raw text contained a regex-detectable @mention. Kept for callers
     *  that need to know whether a mention was present before stripping. */
    hadMention: boolean;
}

/**
 * Comment preprocessing shared by the production pipeline (generateForComment) and the
 * admin playground (generateForPlayground). Centralises the skip rules so they cannot
 * drift between the two flows.
 *
 * Skip rules applied, in order:
 * 1. Facebook `message_tags` contains a `user`-type tag AND no `page`-tag matching our
 *    page id → `user_tag`. The commenter is addressing the tagged friend, not the page.
 * 2. Regex @mention present AND either stripped-empty or ≤3 words of trailing chatter
 *    → `friend_mention`. Legacy fallback for payloads without structured tag data.
 * 3. Stripped text is empty OR punctuation-only AND there's no post context available
 *    → `punctuation_no_context`. Nothing meaningful to answer.
 */
export function preprocessCommentText(opts: {
    text: string;
    messageTags?: FacebookMessageTag[] | null;
    ourFacebookPageId?: string | null;
    hasPostContext: boolean;
}): CommentPreprocessResult {
    const { text, messageTags, ourFacebookPageId, hasPostContext } = opts;

    if (hasUserTag(messageTags) && !hasOwnPageTag(messageTags, ourFacebookPageId)) {
        return { commentForAI: '', skipReason: 'user_tag', hadMention: false };
    }

    const textAfterTags = stripTagsByOffsets(text, messageTags);
    const hadMention = hasMention(textAfterTags);
    const commentForAI = stripCommentNoise(textAfterTags);

    if (hadMention) {
        const wordCount = commentForAI ? commentForAI.split(/\s+/).filter(w => w.length > 0).length : 0;
        if (wordCount <= FRIEND_MENTION_WORD_LIMIT) {
            return { commentForAI: '', skipReason: 'friend_mention', hadMention: true };
        }
    }

    // Nothing meaningful to anchor a reply to — skip when the post context is
    // also absent. With post context we pass through to the AI, which can judge
    // whether a dot/emoji is a valid engagement response (see engagement-post
    // CTA tests in category 34). `rewritePunctuationForDualDm` then synthesises
    // a question in DM channel when the merchant has dual-reply enabled.
    if (!hasPostContext && (!commentForAI || isPunctuationOnly(commentForAI))) {
        return { commentForAI, skipReason: 'punctuation_no_context', hadMention: false };
    }

    return { commentForAI, skipReason: null, hadMention };
}

/**
 * Resolve the reply language for a comment. Ambiguous short Latin-only inputs
 * ("ICDL", "Excel", product names typed by Arabic speakers) against an Arabic KB
 * are treated as Arabic so the reply doesn't drift to English. All other cases
 * defer to `detectCommentLanguage`, which already falls back to post language
 * when the comment has no language signal.
 */
export function resolveCommentLanguage(
    commentForAI: string,
    postMessage: string | undefined,
    kbText: string | undefined,
): string {
    const effectiveLang = detectCommentLanguage(commentForAI, postMessage);
    const kbLang = detectLanguageCode(kbText || '');
    const trimmed = commentForAI.trim();
    const isAmbiguousLatin = effectiveLang === 'en'
        && trimmed.split(/\s+/).length <= 3
        && /^[a-zA-Z0-9\s]+$/.test(trimmed)
        && kbLang === 'ar';
    return isAmbiguousLatin ? 'ar' : effectiveLang;
}

/**
 * When a post's CTA is "comment a dot to get details" and the customer did exactly
 * that, a dual-reply DM must answer with actual details rather than classifying the
 * bare punctuation as spam. Replace the synthetic input with a post-language request
 * sentence so the downstream AI + RAG chain has something to work with.
 *
 * Returns the (possibly rewritten) comment text. When no rewrite applies, returns
 * the input unchanged.
 */
export function rewritePunctuationForDualDm(opts: {
    commentForAI: string;
    rawText: string;
    postMessage: string | undefined;
    effectiveChannel: 'comment' | 'dm';
}): string {
    const { commentForAI, rawText, postMessage, effectiveChannel } = opts;
    if (effectiveChannel !== 'dm') return commentForAI;
    if (!postMessage) return commentForAI;
    const probe = commentForAI || rawText;
    if (!isPunctuationOnly(probe.trim())) return commentForAI;
    // Use the shared language detector (same one driving everything else in the
    // pipeline) so the Arabic-vs-English decision stays consistent. `unknown` falls
    // through to English, which matches the old inline-regex behavior.
    const postLang = detectLanguageCode(postMessage);
    return postLang === 'ar' ? 'أريد التفاصيل' : 'I want the details';
}
