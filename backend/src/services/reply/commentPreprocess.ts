import {
    stripCommentNoise,
    hasMention,
    isPunctuationOnly,
    isContentFree,
    hasUserTag,
    hasOwnPageTag,
    stripTagsByOffsets,
    type FacebookMessageTag,
} from '../../utils/commentText';
import { detectCommentLanguage, detectLanguageCode, isLowSignalLatinToken } from '../../utils/language';
import { resolveAuthoredCtaLanguage } from '../../utils/replyLanguage';
import { t } from '../../utils/i18n';
import { hasExternalPromoUrl } from './spamPatterns';

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
    | 'punctuation_no_context'
    /** Comment links to an external group/channel/messenger invite — self-promotion spam. */
    | 'external_promo_url';

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
 * 4. Raw text contains an external group/channel/DM invite URL → `external_promo_url`.
 *    Catches "join my group" / "follow my channel" spam before the AI call.
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

    if (hasExternalPromoUrl(text)) {
        return { commentForAI: '', skipReason: 'external_promo_url', hadMention: false };
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
    // CTA tests in category 34). `rewriteContentFreeCta` then synthesises a
    // question on any channel so the AI answers with actual details.
    if (!hasPostContext && (!commentForAI || isPunctuationOnly(commentForAI))) {
        return { commentForAI, skipReason: 'punctuation_no_context', hadMention: false };
    }

    return { commentForAI, skipReason: null, hadMention };
}

/**
 * Resolve the reply language for a comment.
 *
 * A bare Latin token ("ICDL", "Excel", "iPhone" — product names and acronyms)
 * carries no real language signal: an Arabic / French / Turkish speaker typing a
 * product name on their own post shouldn't flip the reply to English. For those,
 * mirror the customer's actual language from the surrounding context — whatever it
 * is, NOT a hardcoded Arabic. All other comments defer to `detectCommentLanguage`,
 * which already falls back to post language when the comment is script-less.
 *
 * A comment written in a script this backend cannot NAME (Bengali, Thai, CJK,
 * Cyrillic, Hebrew …) is handled first and separately: it resolves to 'unknown'
 * so the ai-worker names it, never to the post's language. See the body.
 *
 * "No language signal" is decided by the detector's CONFIDENCE, not word count: a
 * Latin comment that matched zero English function words sits at the 0.5 floor
 * (acronyms, lone product names like "course"/"iPhone"), whereas a genuine English
 * phrase matches words like the/what/how/which and scores ≥0.6. Keying off
 * confidence keeps real short questions ("which course", "how much") in English
 * while still catching bare tokens — the old word-count+ASCII gate flipped
 * "which course" to Arabic yet kept "what course?" English purely because of the
 * trailing "?", which was accidental. The ASCII + ≤3-word checks remain only as a
 * safety cap so a long English sentence that happens to dodge function words can't
 * be misread as a token.
 *
 * Context priority is POST first, then KB. The post is the strongest signal (the
 * customer literally commented on it) and — unlike the KB — is ALWAYS present
 * regardless of RAG mode. `kbText` is `effectiveKB`, which the generator sets to
 * `undefined` whenever RAG retrieval returns chunks (the chunks carry the KB
 * content instead). Keying the override on the KB alone silently no-ops on any
 * RAG-active page: the KB-language signal goes blank ('unknown'), the override
 * never fires, and a bare token like "Icdl" on an Arabic post wrongly resolves to
 * English. Reading the post first makes the rule RAG-independent.
 */
export function resolveCommentLanguage(
    commentForAI: string,
    postMessage: string | undefined,
    kbText: string | undefined,
): string {
    // A script the BACKEND cannot name is still a positive signal — the customer
    // wrote in a real language, we simply have no name for it here. Defer: return
    // 'unknown' so the generator omits the explicit override and the ai-worker's
    // Unicode resolver names it (Thai, Cyrillic, CJK, Hebrew, Bengali, …).
    //
    // Without this, detectCommentLanguage's post fallback fires for ANY 'unknown'
    // and the post's language travels as an EXPLICIT hint — which outranks every
    // link of the worker's chain, including its own script detection. That made
    // the worker's Unicode resolver dead code on this path: a Bengali comment on
    // an Arabic post was answered in Arabic in production (2026-08-16,
    // «অনেক সুন্দর» → «شكراً على كلامك الجميل! 🌟»), and so were Thai, Hindi,
    // Cyrillic and Chinese comments, all of which the worker can name.
    //
    // Deliberately keyed on the COMMENT's own script, not on `effectiveLang`:
    // emoji-only and punctuation-only comments carry no letters at all, so they
    // keep falling through to the post language (their documented purpose, and
    // what the engagement-post CTA cases depend on).
    if (detectLanguageCode(commentForAI) === 'unknown' && hasNonLatinScript(commentForAI)) {
        return 'unknown';
    }

    const effectiveLang = detectCommentLanguage(commentForAI, postMessage);
    if (!isLowSignalLatinToken(commentForAI)) return effectiveLang;

    // Mirror the context language, post first (always present, RAG-independent),
    // KB second. General across ALL languages:
    //   • a language the detector can name (ar, fr, tr, sv, …) → reply in it
    //   • a script the backend detector doesn't name (Thai, Cyrillic, CJK, …) →
    //     return 'unknown' so the generator omits the explicit override and the
    //     ai-worker's Unicode-based resolveInputLanguage names the post language
    //   • English / no detectable context → keep the token's English
    for (const ctx of [postMessage, kbText]) {
        if (!ctx) continue;
        const lang = detectLanguageCode(ctx);
        if (lang !== 'unknown' && lang !== 'en') return lang;
        if (lang === 'unknown' && hasNonLatinScript(ctx)) return 'unknown';
    }
    return effectiveLang;
}

/**
 * True when the text contains a letter outside the Latin script (Arabic, Thai,
 * Cyrillic, CJK, …). Used to tell "no language signal" (Latin/punctuation/empty)
 * apart from a real foreign script the backend's named-language detector can't
 * classify, so the latter can defer to the ai-worker's full Unicode resolver.
 */
function hasNonLatinScript(text: string): boolean {
    return /\p{L}/u.test(text.replace(/\p{Script=Latin}/gu, ''));
}

/**
 * When a post's CTA is "comment a dot / zero / heart to get details" and the
 * customer did exactly that, the reply must answer with actual details rather
 * than letting the bare token reach the AI as an unanswerable input. Replace
 * the synthetic input with a post-language request sentence so the downstream
 * AI + RAG chain has something to work with.
 *
 * Channel-agnostic ON PURPOSE (was DM-only until 2026-07): with the old
 * `effectiveChannel !== 'dm'` gate, a merchant in PUBLIC reply mode got no
 * rewrite — the model saw the raw token and its spam verdict silently killed
 * the reply. Deterministic for "." / "000", but "٠٠٠" (Arabic-Indic digits)
 * was classified SPAM_OR_IRRELEVANT and the solicited commenter got silence
 * (eval #324, the لامار الشام regression resurfacing on the public channel).
 * A content-free comment on a post with context is solicited engagement in
 * every reply mode — public replies answer directly (eval category 31), so
 * the rewrite applies unconditionally.
 *
 * Content-free detection covers any script: punctuation ("."), emoji ("❤️"),
 * ASCII digits ("000"), Arabic-Indic digits ("٠٠٠"), or any combination. The
 * \p{L} test naturally extends to future languages — no code change needed
 * to support Chinese, Thai, Devanagari, etc.
 *
 * Returns the (possibly rewritten) comment text. When no rewrite applies,
 * returns the input unchanged.
 */
export function rewriteContentFreeCta(opts: {
    commentForAI: string;
    rawText: string;
    postMessage: string | undefined;
    /** Static KB text, used only as a language signal when no merchant default is set. */
    knowledgeBase?: string;
    /** The merchant's configured reply language — the authority for this sentence. */
    defaultReplyLanguage?: string;
}): string {
    const { commentForAI, rawText, postMessage } = opts;
    if (!postMessage) return commentForAI;
    const probe = commentForAI || rawText;
    if (!isContentFree(probe.trim())) return commentForAI;
    // The merchant's configured language decides, NOT the post's detected language —
    // see resolveAuthoredCtaLanguage for why the post is the wrong authority here and
    // for the measured breakdown. This used to be
    // `detectLanguageCode(postMessage) === 'ar' ? … : …`, which sent an English
    // brochure to every emoji comment on a page whose captions are styled Latin
    // (`P O O L`, `M L U E`) — 238 replies on one page in 30 days.
    const lang = resolveAuthoredCtaLanguage({
        postMessage,
        knowledgeBase: opts.knowledgeBase,
        defaultReplyLanguage: opts.defaultReplyLanguage,
    });
    // Via `t()`, not a hardcoded ar/en pair: this sentence's language BECOMES the reply's
    // language (it is fed back as the explicit hint), so a merchant configured for sv/fr/tr
    // needs a real sentence in that language, not English. Adding `i18n/<locale>.json` is
    // then the only step — and `MessageKey` makes a half-added locale a compile error.
    return t('contentFreeCtaQuestion', lang);
}

/** A comment with this many word-characters or fewer carries too little semantic
 *  signal to retrieve on its own — enrich it with the post it was made on. */
const VAGUE_COMMENT_WORD_CAP = 6;
/** Cap how much of the post we prepend, so a long post can't dominate the query. */
const POST_ENRICH_CHARS = 200;

/**
 * Build the RAG retrieval query for a comment. A short/vague comment ("شو السعر؟",
 * an emoji, "......") matches poorly on its own, so prepend the post it was made on —
 * mirroring how the DM pipeline enriches vague follow-ups with conversation history.
 * A comment like "شو السعر؟" on a hairstyling post should search for
 * "hairstyling course + شو السعر؟", not "شو السعر؟" alone. Long comments search as-is.
 *
 * `commentText` is the cleaned comment; `rawText` is the original, used as the body
 * when cleaning stripped the comment to empty (symbol-only). Single source of truth
 * for both the production comment path and the playground/test tool, so the two can't
 * drift on what gets retrieved.
 */
export function buildCommentRagQuery(
    commentText: string | undefined,
    rawText: string,
    postMessage: string | undefined,
): string {
    const body = commentText || rawText;
    const wordCount = (commentText || '').trim().split(/\s+/).filter(w => /\p{L}/u.test(w)).length;
    const isVague = wordCount <= VAGUE_COMMENT_WORD_CAP;
    return (isVague && postMessage)
        ? `${postMessage.slice(0, POST_ENRICH_CHARS)} ${body}`.trim()
        : body;
}
