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
 * Returns true when text consists entirely of punctuation, symbols, or emojis
 * (no letters, no numbers in any script). Empty string returns false.
 */
export function isPunctuationOnly(text: string): boolean {
    return text.length > 0 && /^[^\p{L}\p{N}]+$/u.test(text);
}
