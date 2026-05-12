/**
 * Acknowledgment detector — short-circuits the AI pipeline for messages that
 * are pure "thanks" / "ok" responses. The caller can send a Messenger reaction
 * (👍 or ❤️) instead of generating a full text reply, saving an OpenAI call.
 *
 * Designed to be high-precision and language-agnostic enough to cover the
 * Arabic + English acknowledgments we see in production. Anything longer than
 * 30 characters falls through to the AI path even when it starts with "thanks"
 * — those messages typically carry a real follow-up question.
 */

const MAX_ACK_LENGTH = 30;

// Trailing decorations allowed after an ack token: punctuation, whitespace, and
// the most common thanks-adjacent emojis. Emojis go in an alternation (not a
// character class) because some — like ❤️ — are multi-codepoint sequences that
// ESLint's no-misleading-character-class rejects inside `[...]`.
const THANKS_TRAIL = '(?:[!.\\s]|❤️|🙏|👍|✨|💖)*';
const OK_TRAIL = '(?:[!.\\s]|👍|👌|✅)*';

const THANKS_TOKENS =
    '(?:thank\\s*you|thanks|thank|thx|ty|شكر(?:ا?ً?)|مشكور|تسلم|يعطيك\\s+العافية|الله\\s+يعطيك\\s+العافية|❤️|🙏|💖|✨)';
const OK_TOKENS =
    '(?:okey|okay|ok|تمام|طيّب|طيب|حسنا|حسناً|اوكي|أوكي|ماشي|تم|تمت|👍|👌|✅)';

// Anchor both ends; allow the same token to repeat (e.g. "ok ok").
const THANKS_RE = new RegExp(`^(?:\\s*${THANKS_TOKENS}${THANKS_TRAIL})+$`, 'iu');
const OK_RE = new RegExp(`^(?:\\s*${OK_TOKENS}${OK_TRAIL})+$`, 'iu');

export type AckKind = 'thanks' | 'ok';

export interface AckResult {
    kind: AckKind;
}

/**
 * Returns `{ kind }` when the message is a pure thanks/ok acknowledgment that
 * should be answered with a reaction instead of an AI reply. Returns null
 * otherwise (caller falls through to the AI generator).
 *
 * Thanks check runs before ok so "ok thanks" — which contains both — is
 * classified as thanks. ("ok thanks" itself won't match the strict thanks
 * regex because "ok" isn't in the thanks token set, but composite messages
 * like "thanks ok" would be rejected by the structure anyway.)
 */
export function detectAck(input: string): AckResult | null {
    const text = input.trim();
    if (!text || text.length > MAX_ACK_LENGTH) return null;

    if (THANKS_RE.test(text)) return { kind: 'thanks' };
    if (OK_RE.test(text)) return { kind: 'ok' };
    return null;
}
