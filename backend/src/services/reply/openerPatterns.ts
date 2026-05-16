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
 * Used by messageProcessor step 9b: opener taps trigger the configured greeting
 * when `greetingMessageEnabled=true` (Facebook designed the button to kick off
 * the conversation, so the greeting is the natural response). Otherwise they're
 * silently suppressed so the system phrase never reaches the AI.
 */
const OPENER_PATTERN = /^(get\s?started|بدء\s?الاستخدام)[\s!.؟?]*$/i;

export function isOpenerMessage(text: string): boolean {
    if (!text) return false;
    return OPENER_PATTERN.test(text.trim());
}
