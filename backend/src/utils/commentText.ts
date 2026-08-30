/**
 * Facebook Graph API `message_tags` entry — the structured record of a user
 * or page tag inside a comment message. Given as offset/length into the raw
 * `message` string so we can strip tagged spans precisely, even when the tag
 * renders without a leading `@` character.
 */
export interface FacebookMessageTag {
    id: string;
    name: string;
    type: 'user' | 'page';
    offset: number;
    length: number;
}

/**
 * Returns true when the comment contains at least one user-type tag — the
 * commenter is addressing a tagged friend (peer-to-peer), so the page has no
 * standing to jump in. Friend tags must skip even when trailing text is present.
 */
export function hasUserTag(tags: FacebookMessageTag[] | null | undefined): boolean {
    if (!tags || tags.length === 0) return false;
    return tags.some(t => t.type === 'user');
}

/**
 * Returns true when one of the tags points at our own Facebook page — in that
 * case the commenter IS addressing us and the comment should be answered even
 * if other (user) tags are also present.
 */
export function hasOwnPageTag(
    tags: FacebookMessageTag[] | null | undefined,
    ourFacebookPageId: string | null | undefined,
): boolean {
    if (!tags || tags.length === 0 || !ourFacebookPageId) return false;
    return tags.some(t => t.type === 'page' && t.id === ourFacebookPageId);
}

/**
 * Strip tagged spans from a comment by offset/length. Facebook delivers tags
 * as plain text with no `@` prefix, so regex stripping misses them — the only
 * reliable signal is the structured offsets.
 *
 * Tags are removed in descending-offset order so earlier offsets remain valid
 * while slicing. Malformed tags (non-integer, negative, zero-length,
 * out-of-range, or overlapping a tag we already accepted) are skipped rather
 * than throwing — webhook payloads are untrusted input.
 *
 * Note on units: Facebook's `offset`/`length` are UTF-16 code units, which
 * matches JavaScript's `string.slice`. Arabic / Latin BMP characters are one
 * unit each; emoji and surrogate-pair characters are two. The Graph API
 * guarantees non-overlapping tags for a single message, but we filter
 * overlaps defensively anyway.
 */
export function stripTagsByOffsets(
    text: string,
    tags: FacebookMessageTag[] | null | undefined,
): string {
    if (!tags || tags.length === 0) return text;
    const sorted = [...tags]
        .filter(t => Number.isInteger(t.offset) && Number.isInteger(t.length)
            && t.offset >= 0 && t.length > 0 && t.offset + t.length <= text.length)
        .sort((a, b) => b.offset - a.offset);
    let out = text;
    let minAcceptedOffset = text.length;
    for (const t of sorted) {
        // Overlap guard: since we slice right-to-left, reject any tag whose span
        // overlaps a tag we've already sliced out (its end passes `minAcceptedOffset`).
        if (t.offset + t.length > minAcceptedOffset) continue;
        out = out.slice(0, t.offset) + out.slice(t.offset + t.length);
        minAcceptedOffset = t.offset;
    }
    return out.replace(/\s+/g, ' ').trim();
}

/**
 * Strips @mentions and URLs from a comment — platform noise that pollutes
 * language detection and carries no message content for the AI.
 *
 * Two mention formats handled:
 * - Facebook structured: @[userid:Display Name]
 *   Brackets bound the full name exactly — safe to strip regardless of length
 *   or language.
 * - Plain @mention: @word + optionally one capitalized trailing word (2 words
 *   max). Capped at 2 because we cannot tell where a name ends and a real
 *   question begins (e.g. "@Ahmad Ali كيف أسجل؟" — "Ali" is the surname,
 *   "كيف أسجل؟" is the question). Names longer than 2 words arrive in the
 *   structured format in real Facebook webhooks.
 */
export function stripCommentNoise(text: string): string {
    return text
        .replace(/@\[\d+:[^\]]*\]/g, '')
        .replace(/@[\w\u0600-\u06FF]+(\s+[A-Z][\w]*)*/g, '')
        .replace(/https?:\/\/\S+|www\.\S+/gi, '')
        .trim();
}

/**
 * Returns true if text contains any @mention — both Facebook's structured
 * form (@[id:Name]) and plain @name. Used to distinguish friend-tagging from
 * real questions when deciding whether to skip a comment silently.
 */
export function hasMention(text: string): boolean {
    return /@(?:\[\d+:|[\w\u0600-\u06FF])/.test(text);
}

/**
 * Number of whitespace-separated tokens that carry at least one letter in any
 * script. The "does this comment say anything" measure shared by the RAG
 * vagueness rule (`buildCommentRagQuery`) and any future short-text gate — one
 * definition so the two cannot drift on what counts as a word (Rule 10.8).
 * Digits-only and symbol-only tokens do not count.
 */
export function countLetterWords(text: string): number {
    return text.trim().split(/\s+/).filter(w => /\p{L}/u.test(w)).length;
}

/**
 * Returns true when text consists entirely of punctuation, symbols, or emojis
 * (no letters, no numbers in any script). Empty string returns false.
 */
export function isPunctuationOnly(text: string): boolean {
    return text.length > 0 && /^[^\p{L}\p{N}]+$/u.test(text);
}

/**
 * Returns true when text has no letters in ANY script — covers punctuation,
 * symbols, emojis, AND digits (ASCII "000", Arabic-Indic "٠٠٠", etc.). Used
 * to detect content-free CTA tokens that act as engagement signals on posts
 * like "علق بنقطة" — a customer typing "٠٠٠" or "000" is conceptually the
 * same as typing "." and must be routed through the same enrichment path.
 *
 * Language-agnostic by construction: \p{L} covers every script Unicode knows
 * (Arabic, Latin, Chinese, Thai, Devanagari, …), so this works for any future
 * language without code changes.
 */
export function isContentFree(text: string): boolean {
    return text.length > 0 && !/\p{L}/u.test(text);
}

/**
 * Returns true when we have strong reasons to believe the comment is NOT a
 * bare structured user-tag (and therefore no need to reach out to the Graph
 * API to verify). Inverted framing on purpose — if we're not confident the
 * text is a question / has content / carries price or URL signals, we return
 * false and let the caller enrich via Graph API. Bias: fail toward fetching
 * rather than toward replying, because a false "is a tag" (skip reply) is
 * recoverable, while a false "not a tag" (reply) is visible to the customer.
 *
 * Signals that prove NOT-a-tag — all SEMANTIC. Every one of them is a statement
 * about what the customer is doing, never about how much they typed:
 *   - Question marks (?, ؟) — questions are the opposite of bare name tags. This
 *     one is load-bearing in the other direction too: "Ruba شوفي، قديش السعر؟"
 *     tags a friend AND asks US, and must still reach the AI.
 *   - Digits — prices, phones, dates are not tags
 *   - Currency tokens (ريال, ر.س, $, SAR, SR, €, £, د.إ, ج.م) — price queries
 *   - URLs — shared links are not tags
 *   - Punctuation-only content — covered separately (no letters at all)
 *
 * ⛔ There is deliberately NO LENGTH RULE. A `length > 50` cap used to live here on
 * the reasoning that "structured tags render as plain names, usually short". That
 * reasoning holds for a BARE tag and breaks for the common real shape — a tag plus
 * a sentence addressed to the tagged friends — and it broke worst where it mattered
 * most, because two tagged names are already 28 characters and three are 53, so the
 * cap fired on precisely the multi-tag comments most likely to be friend-tagging.
 *
 * It shipped a visible leak: Shahin Resort comment
 * `a2d0d3fb-bed5-43f2-a77a-35ae85c5cebd` (2026-08-24) tagged two friends and said
 * «راحت علينا حفلة نادر الاتات» — 60 chars, no digit/?/URL/currency. Facebook sent the
 * webhook with `message_tags` NULL, the cap suppressed the Graph repair fetch that
 * exists for exactly that case, `hasUserTag` stayed blind (and `hasMention` cannot
 * help — a Facebook tag carries no "@" in the body), and the page publicly answered a
 * private exchange between three customers.
 *
 * Measured over 30 days of production before removing it: the cap suppressed the
 * fetch for 553 comments — 244 of which received an AI reply — while saving only
 * **3.9%** of fetch volume (14,271 fetched today vs 14,824 without it). It bought
 * almost nothing and cost correctness. Do not reintroduce a length heuristic here;
 * if fetch volume ever needs bounding, bound it on something that correlates with
 * "is this a tag", or cache per comment id.
 *
 * Called ONLY for Facebook comments with no webhook-provided message_tags.
 * Instagram never carries tags, so callers gate this by platform first.
 */
export function isConfidentlyNotATag(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0) return true;
    if (/[?؟]/.test(trimmed)) return true;
    if (/\d/.test(trimmed)) return true;
    if (/https?:\/\/|www\./i.test(trimmed)) return true;
    // Currency tokens commonly used in MENA + EU — covers the overwhelming
    // majority of price questions merchants see. Keep conservative; false
    // negatives here cost us an API call, not correctness.
    if (/(ريال|ر\.س|درهم|د\.إ|جنيه|ج\.م|\$|€|£|\bSAR\b|\bSR\b|\bAED\b|\bEGP\b|\bUSD\b|\bEUR\b)/i.test(trimmed)) return true;
    return false;
}
