/**
 * Language detection and resolution helpers for AI generation (ai-worker surface).
 *
 * Pure functions only — no I/O, no class state. Originally extracted from
 * ai-worker openai.ts; consolidated VERBATIM here from
 * ai-worker/src/services/language.ts (Phase 1a of the language-agnostic plan) —
 * that file is now a re-export shim over this module.
 *
 * Behavior contract: `detectLanguageOrNull` names non-Latin scripts
 * (ja/zh/ko/my/th/hi/ru/he) and NEVER returns 'unknown' (null instead); the
 * resolution chain is history-first. This is a DIFFERENT, intentionally-unmerged
 * contract from the sibling detector.ts (backend surface) — merging the two
 * alphabets/predicates would change production behavior (see plan).
 */
import { maybeLatinOverride } from './engine';

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
 * Language detection via Unicode script properties. Returns null when no
 * recognized script is found (punctuation/emoji-only input).
 *
 * For most non-Latin scripts the mapping is 1:1 with a language:
 * Myanmar → Burmese, Thai → Thai, Hangul → Korean, etc. Han is mapped to
 * Chinese; Japanese is detected separately via Hiragana/Katakana (which
 * are checked BEFORE Han because Japanese text often mixes both with
 * Han/kanji).
 *
 * Latin disambiguation (English vs Spanish vs French …) is deliberately
 * NOT done here — the resolution chain (post + KB + history) handles that
 * downstream. Swedish gets a special case for legacy reasons (one-off
 * pilot); it precedes Latin so its specific characters are detected
 * before falling through to the generic Latin → en branch.
 *
 * Used in the language fallback chain so punctuation/emoji-only input
 * (e.g. "...") doesn't short-circuit to 'en' before KB inference runs.
 */
export function detectLanguageOrNull(text: string): string | null {
    if (/\p{Script=Arabic}/u.test(text)) return 'ar';
    if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return 'ja';
    if (/\p{Script=Han}/u.test(text)) return 'zh';
    if (/\p{Script=Hangul}/u.test(text)) return 'ko';
    if (/\p{Script=Myanmar}/u.test(text)) return 'my';
    if (/\p{Script=Thai}/u.test(text)) return 'th';
    if (/\p{Script=Devanagari}/u.test(text)) return 'hi';
    if (/\p{Script=Cyrillic}/u.test(text)) return 'ru';
    if (/\p{Script=Hebrew}/u.test(text)) return 'he';
    if (/\p{Script=Latin}/u.test(text)) {
        // Phase 1b (LANG_ENGINE=tinyld only; inert by default): consult the
        // hardened statistical override BEFORE the å/ä/ö→sv special case, so a
        // confident call (e.g. German "Ich möchte mich anmelden", which the
        // umlaut quirk mislabels 'sv') wins when available. The override's
        // non-ASCII gate means ASCII Latin text — English, Arabizi, acronyms —
        // still falls through to the legacy branches bit-identically; when the
        // override declines (short/ambiguous), the legacy quirk stands.
        const override = maybeLatinOverride(text);
        if (override) return override;
    }
    if (/[åäöÅÄÖ]/.test(text)) return 'sv';
    if (/\p{Script=Latin}/u.test(text)) return 'en';
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
 * Walk order: explicit override → current message IF script-certain → user
 * history (preferred anchor) → assistant history (fallback when only the bot has
 * spoken, e.g. dual-DM opener) → current message → post → KB → ambiguous Latin
 * token as last resort → default → 'en'.
 *
 * User history takes priority over assistant history so that bot drift (e.g.
 * an accidental English reply mid-Arabic conversation) does not lock the
 * resolved language away from the customer's expressed preference.
 *
 * Short single-word Latin input is deferred past post/KB so a customer who
 * types just "ICDL" on an Arabic post gets an Arabic reply.
 *
 * The current message outranks the history anchor ONLY when it is SCRIPT-CERTAIN
 * — no Latin characters at all, so the language came from a Unicode script
 * property and cannot be a mis-guess (added 2026-07-29). Rationale: the same
 * "expressed preference" principle applies within the customer's own turns — the
 * newest turn is their preference — and before this an Arabic question on an
 * English thread was answered in English.
 *
 * Latin-script input is deliberately EXCLUDED from that promotion, and the
 * asymmetry is load-bearing. 'en' is this module's default for any unnamed Latin
 * script, so Arabizi ("kam el se3r 😍"), acronyms and short affirmatives all look
 * like English and must keep deferring to history. Promoting *any* named Latin
 * language was tried and reverted the same day: tinyld called
 * «Oui ça va mien et la famill ??» Turkish, which would have outranked a history
 * anchor that was right. See __tests__/resolveChain.test.ts.
 */
export function resolveInputLanguage(input: ResolveLanguageInput): string {
    const history = input.conversationHistory ?? [];
    const fromRole = (role: 'user' | 'assistant') =>
        history
            // \p{L} matches any letter in any script — skips punctuation/emoji-only turns
            // while staying script-agnostic (was hardcoded to Latin + Arabic before).
            //
            // Also skip bare ambiguous Latin tokens (acronyms / product names like
            // "ICDL", "iPhone"). The current message gets this deferral below via
            // `ambiguous`; the history anchor needs it too. Without it, a customer who
            // types a course name mid-thread re-anchors the whole conversation to
            // English: detectLanguage('Icdl') → 'en', and since detectLanguage never
            // returns falsy, `.find(Boolean)` would lock onto that most-recent token.
            // Prod 2026-06-01: an Arabic thread replied 'ar' to "Icdl" but 'en' to a
            // repeated "IcDL" because the prior "Icdl" user turn had become the anchor.
            // Filtering these tokens lets the walk continue to a real-language user
            // turn, then assistant history, then post/KB.
            .filter(m => m.role === role && /\p{L}/u.test(m.content) && !isAmbiguousLatinToken(m.content))
            .reverse()
            .map(m => detectLanguage(m.content))
            .find(Boolean);

    const commentLang = detectLanguageOrNull(input.comment || '');
    const ambiguous = isAmbiguousLatinToken(input.comment || '');
    const effectiveCommentLang = ambiguous ? null : commentLang;

    // The current message's language when it is SCRIPT-CERTAIN — i.e. the text
    // carries no Latin at all, so detectLanguageOrNull named it from a Unicode
    // script property rather than by guessing among Latin languages. Only these
    // may outrank the history anchor; see the asymmetry note in the doc comment.
    const scriptCertainCommentLang =
        effectiveCommentLang && !/\p{Script=Latin}/u.test(input.comment || '')
            ? effectiveCommentLang
            : null;

    return input.language
        || scriptCertainCommentLang
        || fromRole('user')
        || fromRole('assistant')
        || effectiveCommentLang
        || detectLanguageOrNull(input.postMessage || '')
        || detectLanguageOrNull(input.kbText || '')
        || commentLang
        || input.defaultReplyLanguage
        || 'en';
}
