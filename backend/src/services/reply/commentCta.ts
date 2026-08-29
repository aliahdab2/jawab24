/**
 * Content-free comment gate — the pure half of D-111.
 *
 * A comment with no letters (a dot, «٠٠٠», a heart) is a request for details ONLY
 * when the merchant's post explicitly invited that symbol. Everything else is
 * engagement — a bookmark-dot on an event video, praise under a photo — and the
 * page must not answer it with a Business-Info brochure that the customer never
 * asked for and the merchant is billed for.
 *
 * The rule has two halves, and this module owns the deterministic one:
 *   1. WHAT the post asked for is decided once per post by a model
 *      (`contentCtaClassifier.ts`) and stored — `ContentCtaClassification`.
 *   2. WHETHER this comment is that symbol is decided here, locally, in
 *      microseconds, on every content-free comment. No model, no I/O, no list of
 *      phrases.
 *
 * The gate applies to CONTENT-FREE comments only. A comment carrying letters
 * («تم», «كم السعر؟», «السعر؟ ❤️») always takes the normal AI path, unchanged —
 * text is never skipped and never triggers a classification. A `word` verdict
 * («اكتب تم») therefore matters only in the negative: it means a dot or a heart
 * on that post was NOT invited and is skipped.
 *
 * Matching is by CONCEPT, not by literal count («....» is a dot; «٠٠٠» is «000»),
 * and deliberately strict across classes: a ❤️ on a «علّق بنقطة» post is not the
 * dot the merchant asked for (8 such comments a month fleet-wide, and no
 * heart-campaign exists in production). One asymmetry is intentional and
 * measured — dots and digits are ONE class in customers' hands: on posts that say
 * «نقطة», people type «٠٠٠» just as often as «.», which is the regression eval #324
 * pins (لامار الشام). The owner ruled (2026-08-29) that `word` is strict too: a
 * merchant who wants every dot answered on an «اكتب تم» post configures a Post
 * Reply — the AI does not fill the gap.
 *
 * Kept free of DB / adapter deps so the production comment path and the
 * playground/eval path call the SAME decision (AI_INSTRUCTIONS Rule 19).
 */
import { isContentFree } from '../../utils/commentText';
import { HEART_ONLY, stripEmojiModifiers } from './spamPatterns';

/** What the post's text asks readers to comment with. `uncertain` behaves as `none`. */
export type CtaSymbol = 'none' | 'dot' | 'digits' | 'word' | 'heart' | 'any' | 'uncertain';

const CTA_SYMBOLS: readonly CtaSymbol[] = ['none', 'dot', 'digits', 'word', 'heart', 'any', 'uncertain'];

export function isCtaSymbol(value: unknown): value is CtaSymbol {
    return typeof value === 'string' && (CTA_SYMBOLS as readonly string[]).includes(value);
}

/** The persisted verdict for one post (see contentCtaClassifier / content_cta_classifications). */
export interface ContentCtaClassification {
    symbol: CtaSymbol;
    /** The literal token when `symbol === 'word'` («تم», «اسم الدورة»), else null. Stored
     *  for the audit trail and the future nudge copy; the gate itself never matches on it. */
    word: string | null;
    /** Model confidence 0–1. Below the configured threshold the caller treats the row as `uncertain`. */
    confidence: number;
}

/**
 * The shape of a content-free comment, for matching against the CTA class.
 *   dot     — only dots / Arabic commas / ellipses: «.», «....», «…», «،»
 *   digits  — only digits, ASCII or Arabic-Indic, optionally with dots: «000», «٠٠٠», «1», «1️⃣»
 *   heart   — only heart emoji (any colour, any decoration)
 *   emoji   — content-free but neither of the above: «🔥», «👍», «😡», «?!»
 *   text    — carries at least one letter in any script — outside this gate entirely
 * Variation selectors, joiners and the keycap mark are stripped first, so «1️⃣» is
 * a digit and «❤️» is a heart.
 */
export type CommentShape = 'dot' | 'digits' | 'heart' | 'emoji' | 'text';

const DOT_RUN = /^[.…،٫٬,\s]+$/u;
const DIGIT_RUN = /^[0-9٠-٩.\s]+$/u;

export function classifyCommentShape(text: string): CommentShape {
    const t = stripEmojiModifiers(text).trim();
    if (t.length === 0 || !isContentFree(t)) return 'text';
    if (DOT_RUN.test(t)) return 'dot';
    if (DIGIT_RUN.test(t) && /[0-9٠-٩]/.test(t)) return 'digits';
    if (HEART_ONLY.test(t)) return 'heart';
    return 'emoji';
}

/**
 * Does a comment of this shape satisfy what the post asked for?
 *
 *   dot / digits → a dot run OR a digit run (one class — see the header)
 *   heart        → a heart run only
 *   any          → any content-free shape (dot, digits, heart, other emoji)
 *   word         → never (the invited token carries letters and never reaches this gate)
 *   none / uncertain → never
 */
export function matchesInvitedSymbol(shape: CommentShape, symbol: CtaSymbol): boolean {
    if (shape === 'text') return false;
    switch (symbol) {
        case 'dot':
        case 'digits':
            return shape === 'dot' || shape === 'digits';
        case 'heart':
            return shape === 'heart';
        case 'any':
            return true;
        case 'word':
        case 'none':
        case 'uncertain':
        default:
            return false;
    }
}

/** Reason recorded when the gate skips a comment. Its own value — not `spam` — so
 *  the skip is countable apart from spam (pipeline outcome + per-post counter). */
export const UNINVITED_SYMBOL_SKIP = 'uninvited_symbol';
export type UninvitedSymbolSkip = typeof UNINVITED_SYMBOL_SKIP;

export type CtaGateMode = 'shadow' | 'enforce';

export type CtaGateDecision =
    /** Not content-free — the gate has nothing to say; the normal path continues. */
    | { action: 'pass' }
    /** The post invited exactly this symbol: run the «أريد التفاصيل» rewrite and reply. */
    | { action: 'proceed'; symbol: CtaSymbol; shape: CommentShape }
    /** Not invited. `enforce` → skip before any model call. `shadow` → the caller
     *  proceeds exactly as before this change and only records that it WOULD have
     *  skipped (the one-week shadow run that sets the confidence threshold). */
    | { action: 'skip' | 'shadow_skip'; symbol: CtaSymbol; shape: CommentShape };

/**
 * The gate, applied AFTER the preprocess skips (friend tags, spam URLs) and the
 * Post Reply rule, and BEFORE the model. `classification` is null when the post
 * has no text or the classifier is unavailable; both read as `uncertain`, i.e. skip
 * — an uninvited symbol during an OpenAI outage is still uninvited, and the reply
 * call would fail anyway. Nothing is persisted for a failure, so the next comment
 * retries the classification. The threshold is validated by config; a
 * non-finite value here is treated as "no verdict passes" rather than "all pass".
 */
export function decideContentFreeGate(opts: {
    commentText: string;
    classification: ContentCtaClassification | null;
    confidenceThreshold: number;
    mode: CtaGateMode;
}): CtaGateDecision {
    const shape = classifyCommentShape(opts.commentText);
    if (shape === 'text') return { action: 'pass' };

    const cls = opts.classification;
    const threshold = Number.isFinite(opts.confidenceThreshold) ? opts.confidenceThreshold : Number.POSITIVE_INFINITY;
    const symbol: CtaSymbol = !cls || !(cls.confidence >= threshold) ? 'uncertain' : cls.symbol;

    if (matchesInvitedSymbol(shape, symbol)) {
        return { action: 'proceed', symbol, shape };
    }
    return { action: opts.mode === 'enforce' ? 'skip' : 'shadow_skip', symbol, shape };
}
