/**
 * Opener-message detection — Messenger "Get Started" button payloads.
 *
 * Tight regex, matches only the canonical button titles Facebook delivers:
 *   - "Get Started" (en locale)
 *   - "بدء الاستخدام" (ar locale)
 *
 * Anchored whole-string match (after trim, ignoring trailing punctuation/emoji)
 * so it cannot match inside longer phrases like "I started having a problem".
 *
 * Used by messageProcessor step 9b to decide whether to send the seeded
 * default greeting on a first message. Merchants who manually configured a
 * greeting (sourceLang !== 'default') always get the configured greeting
 * regardless of opener-match — this preserves their existing UX.
 */
const OPENER_PATTERN = /^(get\s?started|بدء\s?الاستخدام)[\s!.؟?]*$/i;

export function isOpenerMessage(text: string): boolean {
    if (!text) return false;
    return OPENER_PATTERN.test(text.trim());
}
