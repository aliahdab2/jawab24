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

/**
 * Heart code points — the ONE list behind every "is this a heart" test: the
 * classic ❤ / ❣ / ♥, every coloured heart, the 2023 additions (🩷🩵🩶), and the
 * decorated hearts (💕💖💗💘💝💞💟💓💔). Shared by the D-111 comment-shape test
 * (`commentCta.classifyCommentShape`) and the AI-outage fallback's compliment
 * detector (`fallbackClassifier`), so a ❤️ cannot be a compliment to one and an
 * uninvited symbol to the other. Variation selectors / joiners are stripped by
 * the callers before testing (`stripEmojiModifiers`).
 */
export const HEART_CODEPOINTS: readonly string[] = [
    '❤', '❣', '♥',
    '\u{1F499}', '\u{1F49A}', '\u{1F49B}', '\u{1F49C}', '\u{1F9E1}', '\u{1F90D}', '\u{1F90E}', '\u{1F5A4}',
    '\u{1FA75}', '\u{1FA76}', '\u{1FA77}',
    '\u{1F495}', '\u{1F496}', '\u{1F497}', '\u{1F498}', '\u{1F49D}', '\u{1F49E}', '\u{1F49F}', '\u{1F493}', '\u{1F494}',
];

/** Whole-string test: only hearts and whitespace. Apply to `stripEmojiModifiers` output. */
export const HEART_ONLY = new RegExp(`^(?:[${HEART_CODEPOINTS.join('')}]|\\s)+$`, 'u');

/** Remove the code points that decorate an emoji without changing what it is:
 *  U+FE0F/U+FE0E variation selectors, U+200D zero-width joiner, U+20E3 keycap
 *  (so «1️⃣» reads as «1»). */
export function stripEmojiModifiers(text: string): string {
    // Real escapes, not literal combining marks: written literally they are invisible
    // in an editor and trip eslint's no-misleading-character-class.
    return text.replace(/\uFE0E|\uFE0F|\u200D|\u20E3/gu, '');
}

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
