import { normalizeArabic, normalizeAiIntent } from '@jawab24/shared';
import { detectIntent } from '../kb/intent-detector';
import {
    EMOJI_ONLY,
    MENTION_PATTERN,
    PUNCTUATION_ONLY,
    HEART_CODEPOINTS,
    stripEmojiModifiers,
    hasExternalPromoUrl,
    hasSpamKeyword,
} from './spamPatterns';

/**
 * Lightweight, zero-cost keyword-based classifier for fallback responses.
 * Used when the AI worker is unavailable to provide basic metadata
 * (intent, confidence, flags) instead of returning completely empty data.
 */

// Spam patterns (EMOJI_ONLY, MENTION_PATTERN, PUNCTUATION_ONLY, SPAM_KEYWORDS_*) live in
// `./spamPatterns.ts` so the comment preprocess pipeline and this fallback classifier
// share a single source of truth.

// ── Compliment patterns ─────────────────────────────────────────────────────

const COMPLIMENT_ARABIC = /(ممتاز|رائع|ماشاء\s?الله|تبارك|يعطيك\s?العافية|ما\s?قصرت|الله\s?يوفق|حلو|جميل|احسنت|مبدع)/i;
const COMPLIMENT_ENGLISH = /\b(great|amazing|excellent|awesome|wonderful|fantastic|love\s+it|well\s+done|good\s+job|thank|thanks)\b/i;
// Hearts come from the shared list (spamPatterns.HEART_CODEPOINTS) so this
// detector and the D-111 comment-shape test agree on what a heart is; the
// non-heart compliment emoji stay local. Variation selectors are stripped
// before the test, not listed as members.
const COMPLIMENT_EMOJI_SET = new Set([
    ...HEART_CODEPOINTS,
    '\u{1F44D}', '\u{1F44F}', '\u{1F4AF}', '\u{1F60D}', '\u{1F970}', '\u2728', '\u2B50', ' ',
]);
function isComplimentEmoji(text: string): boolean {
    const bare = stripEmojiModifiers(text);
    return bare.trim().length > 0 && [...bare].every(ch => COMPLIMENT_EMOJI_SET.has(ch));
}

// ── Purchase intent patterns ────────────────────────────────────────────────

const PURCHASE_ARABIC = /(ابي\s?اشتري|ابغى\s?اشتري|بدي\s?اشتري|عايز\s?اشتري|نبي\s?نشتري|ابي\s?اطلب|ابغى\s?اطلب)/i;
const PURCHASE_ENGLISH = /\b(want\s+to\s+buy|i('d|\s+would)\s+like\s+to\s+(buy|order|purchase)|add\s+to\s+cart|place\s+an?\s+order)\b/i;

// ── Business inquiry patterns ───────────────────────────────────────────────

const BUSINESS_ARABIC = /(نبي\s?نتعاون|تعاون|شراكة|وكيل|موزع|توزيع|مؤثر)/i;
// Note: "influencer" is intentionally excluded — standalone mention is often spam self-promotion
// (e.g. "follow @influencer"). Legitimate influencer outreach uses "collaborate", "partnership", etc.
const BUSINESS_ENGLISH = /\b(partnership|collaborate|collaboration|distributor|wholesale|B2B|sponsor)\b/i;

// ── Angry customer patterns ─────────────────────────────────────────────────

const ANGRY_ARABIC = /(ارجع\s?(فلوسي|حقي)|اسوأ\s?خدمة|بشتكي|ما\s?(يرد|ترد)\s?احد|زهقت|طفشت|وين\s?الرد|كذابين|محد\s?يرد|ما\s?رديتوا|ليش\s?ما\s?ترد)/i;
const ANGRY_ENGLISH = /\b(worst\s+service|want\s+my\s+money\s+back|been\s+waiting|no\s+response|filing\s+complaint|report\s+you|sue\s+you|refund\s+now|never\s+again|disgusted)\b/i;

/**
 * Detect intent using extended keyword patterns.
 * Covers categories not handled by the existing detectIntent():
 * SPAM_OR_IRRELEVANT, COMPLIMENT, PURCHASE_INTENT, BUSINESS_INQUIRY.
 *
 * Falls back to detectIntent() from intent-detector.ts for standard categories
 * (GREETING, PRICE→QUESTION, HOURS→QUESTION, LOCATION→QUESTION, etc.)
 */
export function classifyFallbackIntent(text: string): string | undefined {
    const normalized = normalizeArabic(text).toLowerCase();
    const lower = text.toLowerCase().trim();

    // Punctuation-only (always spam)
    if (PUNCTUATION_ONLY.test(lower)) return 'SPAM_OR_IRRELEVANT';

    // Compliment emoji (check BEFORE general emoji-only spam to prioritize 👍, ❤️, etc.)
    if (isComplimentEmoji(lower)) return 'COMPLIMENT';

    // General emoji-only (non-compliment emojis like 😂😂😂)
    if (EMOJI_ONLY.test(lower)) return 'SPAM_OR_IRRELEVANT';

    // External group/channel/DM invite URL (parity with commentPreprocess silent-skip)
    if (hasExternalPromoUrl(lower)) return 'SPAM_OR_IRRELEVANT';

    // @mention + any spam signal
    if (MENTION_PATTERN.test(lower) && hasSpamKeyword(lower, normalized)) return 'SPAM_OR_IRRELEVANT';

    // Standalone spam keywords
    if (hasSpamKeyword(lower, normalized)) return 'SPAM_OR_IRRELEVANT';

    // Compliment text
    if (COMPLIMENT_ARABIC.test(normalized) || COMPLIMENT_ENGLISH.test(lower)) return 'COMPLIMENT';

    // Purchase intent
    if (PURCHASE_ARABIC.test(normalized) || PURCHASE_ENGLISH.test(lower)) return 'PURCHASE_INTENT';

    // Business inquiry
    if (BUSINESS_ARABIC.test(normalized) || BUSINESS_ENGLISH.test(lower)) return 'BUSINESS_INQUIRY';

    // Angry customer → COMPLAINT (reuses anger patterns that are broader than intent-detector's COMPLAINT)
    if (ANGRY_ARABIC.test(normalized) || ANGRY_ENGLISH.test(lower)) return 'COMPLAINT';

    // Fall back to existing detectIntent() for standard categories
    // (GREETING, PRICE, HOURS, LOCATION, BOOKING, POLICY, COMPLAINT, OFFERING_INFO)
    const preGptIntent = detectIntent(text);
    if (preGptIntent !== 'OTHER') {
        // Map pre-GPT intents to standard taxonomy (PRICE→QUESTION, BOOKING→PURCHASE_INTENT, etc.)
        return normalizeAiIntent(preGptIntent) || undefined;
    }

    return undefined;
}

/**
 * Detect angry/frustrated customer tone via keywords.
 * Returns true if message contains anger indicators.
 */
export function detectAngryCustomer(text: string): boolean {
    const normalized = normalizeArabic(text).toLowerCase();
    const lower = text.toLowerCase();
    return ANGRY_ARABIC.test(normalized) || ANGRY_ENGLISH.test(lower);
}

/**
 * Full fallback classification — called when AI worker is unavailable.
 * Returns lightweight metadata to enrich the fallback response.
 */
export function classifyFallback(text: string): {
    intent: string | undefined;
    confidence: 'low';
    flags: string[];
} {
    const intent = classifyFallbackIntent(text);
    const flags: string[] = [];

    if (detectAngryCustomer(text)) {
        flags.push('angry_customer');
    }

    return {
        intent,
        confidence: 'low',
        flags,
    };
}
