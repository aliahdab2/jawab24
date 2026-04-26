/**
 * Centralised regex patterns for comment/message spam detection. Shared between
 * `commentPreprocess.ts` (pre-AI silent-skip rules) and `fallbackClassifier.ts`
 * (zero-cost fallback when the AI worker is unavailable). Keep all regex-based
 * spam signals here so they can't drift between the two pipelines.
 */

/** Hosts/paths that are virtually always self-promotion when pasted in a public comment:
 *  group invites, telegram/discord channels, direct-message handles. Page or post URLs
 *  on facebook.com (without `/groups/`) are intentionally NOT matched — a customer might
 *  legitimately link the page's own post when asking a question. */
export const EXTERNAL_PROMO_URL = /(?:facebook\.com\/groups\/|fb\.com\/groups\/|t\.me\/|chat\.whatsapp\.com\/|api\.whatsapp\.com\/|wa\.me\/|discord\.gg\/)/i;

export const EMOJI_ONLY = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u;
export const MENTION_PATTERN = /@\w+/;
export const PUNCTUATION_ONLY = /^[.…?!؟\s]+$/;

/** English spam uses \b word boundaries. */
export const SPAM_KEYWORDS_EN = /\b(follow\s+me|follow\s+@|check\s+(my|out)\s+(profile|page|bio)|check\s+this\s+out|subscribe|giveaway|link\s+in\s+bio)\b/i;
/** Arabic spam — apply against `normalizeArabic(text)` output (no \b for Arabic). */
export const SPAM_KEYWORDS_AR = /(منشن|تاق|فولو|فولومي)/i;
/** Franco-Arabic transliteration spam. */
export const SPAM_FRANCO = /\b(folo|folomi|ta2ni|ta3ni)\b/i;

/** True when the comment contains an external group/channel/DM invite URL. */
export function hasExternalPromoUrl(text: string): boolean {
    return EXTERNAL_PROMO_URL.test(text);
}

/** True when the comment matches any standalone spam keyword (EN, AR, or franco).
 *  Caller passes the Arabic-normalised form for the AR check; both lower-cased
 *  raw text and normalised text are tested against their respective patterns. */
export function hasSpamKeyword(lowerText: string, normalizedArabic: string): boolean {
    return SPAM_KEYWORDS_EN.test(lowerText)
        || SPAM_KEYWORDS_AR.test(normalizedArabic)
        || SPAM_FRANCO.test(lowerText);
}
