/**
 * Language detection and resolution helpers for AI generation.
 *
 * Pure functions only — no I/O, no class state. Extracted from openai.ts so
 * the heuristics can be unit-tested directly without going through the OpenAI
 * SDK mock.
 *
 * Long-term these character-class detectors should converge with
 * backend/src/utils/language.ts via packages/shared. For now ai-worker keeps
 * its own copy because the resolution chain reads ai-worker-specific request
 * shapes (GenerateRequest).
 */

/**
 * Minimal conversation-turn shape this module needs. Kept local to avoid a
 * source-graph cycle with openai.ts (which is the consumer of this module).
 * `ConversationMessage` in openai.ts is structurally compatible.
 */
interface HistoryTurn {
    role: 'user' | 'assistant';
    content: string;
}

/**
 * Inputs needed to resolve the effective input language. Decoupled from
 * GenerateRequest so this module doesn't import the OpenAI service.
 */
export interface ResolveLanguageInput {
    comment: string;
    language?: string;
    conversationHistory?: HistoryTurn[];
    postMessage?: string | null;
    kbText?: string | null;
    defaultReplyLanguage?: string;
}

/**
 * Longest realistic single-word Latin token we treat as ambiguous. Brand names
 * and acronyms ("Salesforce", "iPhone", "ICDL", "GPS") fit within 10 chars;
 * real English words/sentences are either longer or contain whitespace.
 */
const MAX_AMBIGUOUS_LATIN_TOKEN_LENGTH = 10;

/**
 * Language detection that returns null when no script is detectable.
 * Used in the language fallback chain so punctuation/emoji-only input
 * (e.g. "...") doesn't short-circuit to 'en' before KB inference runs.
 */
export function detectLanguageOrNull(text: string): string | null {
    if (/[؀-ۿ]/.test(text)) return 'ar';
    if (/[åäöÅÄÖ]/.test(text)) return 'sv';
    if (/[a-zA-Z]/.test(text)) return 'en';
    return null;
}

/**
 * Simple language detection based on character sets.
 * Delegates to detectLanguageOrNull and falls back to 'en'.
 */
export function detectLanguage(text: string): string {
    return detectLanguageOrNull(text) ?? 'en';
}

/**
 * A bare Latin token (e.g. "ICDL", "iPhone", "GPS") with no whitespace and
 * ≤10 chars is almost always a brand / acronym / product name, not a real
 * English sentence. Callers should treat these as ambiguous so the chain
 * can fall through to post/KB language instead of locking onto 'en'.
 */
export function isAmbiguousLatinToken(text: string): boolean {
    const trimmed = text.trim();
    return (
        detectLanguageOrNull(trimmed) === 'en' &&
        !/\s/.test(trimmed) &&
        trimmed.length > 0 &&
        trimmed.length <= MAX_AMBIGUOUS_LATIN_TOKEN_LENGTH
    );
}

/**
 * Resolve the effective input language.
 *
 * Walk order: explicit override → user history (preferred anchor) → assistant
 * history (fallback when only the bot has spoken, e.g. dual-DM opener) →
 * current message (skipped if ambiguous Latin token) → post → KB → ambiguous
 * Latin token as last resort → default → 'en'.
 *
 * User history takes priority over assistant history so that bot drift (e.g.
 * an accidental English reply mid-Arabic conversation) does not lock the
 * resolved language away from the customer's expressed preference.
 *
 * Short single-word Latin input is deferred past post/KB so a customer who
 * types just "ICDL" on an Arabic post gets an Arabic reply.
 */
export function resolveInputLanguage(input: ResolveLanguageInput): string {
    const history = input.conversationHistory ?? [];
    const fromRole = (role: 'user' | 'assistant') =>
        history
            .filter(m => m.role === role && /[a-zA-Z؀-ۿ]/.test(m.content))
            .reverse()
            .map(m => detectLanguage(m.content))
            .find(Boolean);

    const commentLang = detectLanguageOrNull(input.comment || '');
    const ambiguous = isAmbiguousLatinToken(input.comment || '');
    const effectiveCommentLang = ambiguous ? null : commentLang;

    return input.language
        || fromRole('user')
        || fromRole('assistant')
        || effectiveCommentLang
        || detectLanguageOrNull(input.postMessage || '')
        || detectLanguageOrNull(input.kbText || '')
        || commentLang
        || input.defaultReplyLanguage
        || 'en';
}
