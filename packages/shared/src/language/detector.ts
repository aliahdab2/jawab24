/**
 * Language Detection Utility (backend surface)
 *
 * Detects the language of text using Unicode character ranges and common patterns.
 * Supports: Arabic, English, Swedish (can be extended)
 *
 * Consolidated VERBATIM from backend/src/utils/language.ts (Phase 1a of the
 * language-agnostic plan) — backend/src/utils/language.ts is now a re-export
 * shim over this module. Behavior contract: emits `unknown` for scripts the
 * backend does not name (CJK/Cyrillic/Hebrew/…), and its numeric `confidence`
 * is load-bearing — `isLowSignalLatinToken` (≤0.5) and the DM deferToHistory
 * gate in backend generator.ts (<0.6) key off it. Do NOT change outputs here
 * without reading those gates; the sibling resolveChain.ts (ai-worker surface)
 * has a DIFFERENT, intentionally-unmerged contract.
 */
import { isConfidentAsciiEnglish, maybeLatinOverride, OVERRIDE_CONFIDENCE } from './engine';

// Unicode ranges for different scripts
const HEBREW_RANGE = /[\u0590-\u05FF]/;
const CYRILLIC_RANGE = /[\u0400-\u04FF]/;
const CJK_RANGE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
const KOREAN_RANGE = /[\uAC00-\uD7AF\u1100-\u11FF]/;
const JAPANESE_RANGE = /[\u3040-\u309F\u30A0-\u30FF]/;
const THAI_RANGE = /[\u0E00-\u0E7F]/;

// Extended Latin characters for specific languages
const SWEDISH_CHARS = /[åäöÅÄÖ]/;
const GERMAN_CHARS = /[äöüßÄÖÜ]/;
const FRENCH_CHARS = /[àâæçéèêëïîôùûüÿœÀÂÆÇÉÈÊËÏÎÔÙÛÜŸŒ]/;
const SPANISH_CHARS = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/;
const TURKISH_CHARS = /[çğıöşüÇĞİÖŞÜ]/;

// Common words for additional context.
//
// Sets, not arrays: membership is the hot path of this function — `detectLanguage` runs
// on every inbound message, every comment, and every template-language decision, and as
// arrays these were O(words x 58) string comparisons per call (~870 for a 15-word
// message). Same contents, same results; only `.includes` → `.has`.
const ENGLISH_COMMON = new Set([
    'the', 'is', 'are', 'and', 'or', 'but', 'with', 'for', 'from', 'have', 'has', 'been',
    'you', 'me', 'my', 'your', 'we', 'our', 'they', 'their', 'it', 'he', 'she',
    'can', 'could', 'will', 'would', 'should', 'do', 'does', 'did',
    'what', 'when', 'where', 'why', 'how', 'who', 'which',
    'this', 'that', 'these', 'those', 'in', 'on', 'at', 'to', 'of',
    'please', 'help', 'want', 'need', 'thanks', 'hi', 'hello', 'hey',
]);
const SWEDISH_COMMON = new Set(['och', 'det', 'att', 'som', 'på', 'är', 'av', 'för', 'med', 'har']);

/**
 * The 7 named legacy codes plus `unknown`, widened with `(string & {})` for
 * Phase 1b: under LANG_ENGINE=tinyld the fallthrough override may pass
 * through additional ISO codes (da, pt, vi, …). The widening is type-level
 * only — literal autocomplete is preserved, every consumer does equality
 * checks (`=== 'ar'`, `=== 'unknown'`) or stores the value as a string, and
 * no exhaustive switch on this union exists (verified at introduction).
 */
export type SupportedLanguage = 'ar' | 'en' | 'sv' | 'de' | 'fr' | 'es' | 'tr' | 'unknown' | (string & {});

export interface LanguageDetectionResult {
    language: SupportedLanguage;
    confidence: number; // 0-1
    script: string;
    isRTL: boolean;
    /**
     * Set when the language was named from CHARACTERS ALONE, with no word evidence —
     * a guess, not a reading. `confidence` cannot express this: for Arabic it is a
     * character RATIO (real traffic yields ar@0.545, ar@0.35, ar@0.03), so no numeric
     * threshold or sentinel can separate "unevidenced" from "mostly-Latin Arabic"
     * without making genuine Arabic uncertain. See isCertainDetection.
     */
    evidence?: 'characters-only';
}

/**
 * Below this, an 'en' result is the Latin-script DEFAULT ("recognized nothing"),
 * not a reading. The floor is 0.5 and every matched English stopword adds 0.1, so
 * 0.6 means "at least one real English word". Single source of truth for the
 * threshold — the DM deferToHistory gate and the reply-language certainty signal
 * are two decisions keyed on the same fact and must not drift apart.
 */
export const MIN_CERTAIN_CONFIDENCE = 0.6;

/**
 * Whether a detection is a POSITIVE reading of the text rather than a fallback.
 *
 * `false` = "we could not identify this text": 'unknown', the en@0.5 floor (accent-free
 * French, romanized Urdu/Tagalog, phone numbers — 68.77% of Latin-script inbound
 * traffic), or a characters-only guess. Callers must not present a `false` result to the
 * model as the customer's language; see languageDirective in ai-worker's promptBuilder.
 *
 * The confidence threshold is applied to 'en' ONLY, deliberately. Arabic's confidence is
 * a character ratio, so a blanket `confidence >= MIN_CERTAIN_CONFIDENCE` would mark 441
 * rows of a 30-day corpus uncertain — mostly genuine Arabic with some Latin mixed in
 * (`دورة ICDL` reads ar@0.545) — and soften the hard directive on the money path.
 */
export function isCertainDetection(result: LanguageDetectionResult): boolean {
    if (result.language === 'unknown') return false;
    if (result.evidence === 'characters-only') return false;
    return !(result.language === 'en' && result.confidence < MIN_CERTAIN_CONFIDENCE);
}

/**
 * Detect the language of a text string
 */
export function detectLanguage(text: string): LanguageDetectionResult {
    if (!text || text.trim().length === 0) {
        return {
            language: 'unknown',
            confidence: 0,
            script: 'unknown',
            isRTL: false,
        };
    }

    const cleanText = text.trim();
    
    // Check for Arabic script (most reliable due to unique character range)
    // Even a single Arabic character means it's likely Arabic content
    const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
    const arabicMatches = cleanText.match(arabicRegex);
    if (arabicMatches && arabicMatches.length > 0) {
        // Remove emojis, spaces, numbers, and punctuation for ratio calculation
        const textWithoutSpaces = cleanText.replace(/[\s\d\u{1F300}-\u{1F9FF}!?؟.,،;:'"()[\]{}]/gu, '');
        const arabicRatio = textWithoutSpaces.length > 0 
            ? arabicMatches.length / textWithoutSpaces.length 
            : 1;
        
        // If any Arabic content exists, detect as Arabic (Arabic users often mix with emojis/punctuation)
        if (arabicMatches.length >= 1) {
            return {
                language: 'ar',
                confidence: Math.min(arabicRatio * 1.5, 1),
                script: 'Arabic',
                isRTL: true,
            };
        }
    }

    // Check for Hebrew
    if (HEBREW_RANGE.test(cleanText)) {
        return {
            language: 'unknown', // We don't officially support Hebrew yet
            confidence: 0.8,
            script: 'Hebrew',
            isRTL: true,
        };
    }

    // Check for CJK characters
    if (CJK_RANGE.test(cleanText)) {
        return {
            language: 'unknown',
            confidence: 0.8,
            script: 'CJK',
            isRTL: false,
        };
    }

    // Check for Japanese
    if (JAPANESE_RANGE.test(cleanText)) {
        return {
            language: 'unknown',
            confidence: 0.8,
            script: 'Japanese',
            isRTL: false,
        };
    }

    // Check for Korean
    if (KOREAN_RANGE.test(cleanText)) {
        return {
            language: 'unknown',
            confidence: 0.8,
            script: 'Korean',
            isRTL: false,
        };
    }

    // Check for Cyrillic
    if (CYRILLIC_RANGE.test(cleanText)) {
        return {
            language: 'unknown',
            confidence: 0.8,
            script: 'Cyrillic',
            isRTL: false,
        };
    }

    // Check for Thai
    if (THAI_RANGE.test(cleanText)) {
        return {
            language: 'unknown',
            confidence: 0.8,
            script: 'Thai',
            isRTL: false,
        };
    }

    // For Latin script, use extended characters and common words
    const lowerText = cleanText.toLowerCase();
    const words = lowerText.split(/\s+/);

    // Turkish check (has unique chars like ş, ğ, ı that others don't have)
    if (TURKISH_CHARS.test(cleanText) && /\b(ve|bir|bu|için|ile|de|da|mi|mu|ne)\b/i.test(cleanText)) {
        return {
            language: 'tr',
            confidence: 0.85,
            script: 'Latin',
            isRTL: false,
        };
    }

    // German check - check before Swedish since they share some chars (ö, ü, ä)
    // German is detected by chars + common German words
    if (GERMAN_CHARS.test(cleanText) && /\b(und|ist|das|der|die|ein|eine|nicht|sehr|ich|bin)\b/i.test(cleanText)) {
        return {
            language: 'de',
            confidence: 0.8,
            script: 'Latin',
            isRTL: false,
        };
    }

    // Swedish check - only check special Swedish chars (å) which German doesn't have
    // or check common Swedish words if chars are ambiguous
    if (/[åÅ]/.test(cleanText)) {
        return {
            language: 'sv',
            confidence: 0.9,
            script: 'Latin',
            isRTL: false,
        };
    }

    // Check for Swedish using common words + Swedish chars without å
    if (SWEDISH_CHARS.test(cleanText)) {
        const swedishMatches = words.filter(w => SWEDISH_COMMON.has(w)).length;
        if (swedishMatches >= 1) {
            return {
                language: 'sv',
                confidence: 0.85,
                script: 'Latin',
                isRTL: false,
            };
        }
    }

    // Check common words for Swedish (without special chars)
    const swedishMatches = words.filter(w => SWEDISH_COMMON.has(w)).length;
    if (swedishMatches >= 2) {
        return {
            language: 'sv',
            confidence: 0.7 + (swedishMatches * 0.05),
            script: 'Latin',
            isRTL: false,
        };
    }

    // Turkish fallback: characters only, no word check — so it stays a GUESS. `ç` is
    // shared with French, and this branch runs before the French check, which is why
    // «Combien ça coûte ?» was asserted as Turkish and answered in Turkish (2026-07-29).
    // Turkish keeps the DEFAULT here; the soft reply directive lets the model correct it.
    // Turkish with a function word still scores 0.85 on the evidenced branch above.
    if (/[ğıİşŞçÇ]/.test(cleanText)) {
        return {
            language: 'tr',
            confidence: 0.75,
            script: 'Latin',
            isRTL: false,
            evidence: 'characters-only',
        };
    }

    // French check
    if (FRENCH_CHARS.test(cleanText) && /\b(le|la|les|et|est|que|qui|de|du|des)\b/i.test(cleanText)) {
        return {
            language: 'fr',
            confidence: 0.8,
            script: 'Latin',
            isRTL: false,
        };
    }

    // Spanish check
    if (SPANISH_CHARS.test(cleanText) && /\b(el|la|los|las|es|que|de|en|un|una)\b/i.test(cleanText)) {
        return {
            language: 'es',
            confidence: 0.8,
            script: 'Latin',
            isRTL: false,
        };
    }

    // No alphabetic Latin characters — pure emoji, numbers, or punctuation
    // Cannot determine language; return unknown so callers can fall back to context (e.g. conversation history)
    if (!/[a-zA-Z]/.test(cleanText)) {
        return {
            language: 'unknown',
            confidence: 0,
            script: 'unknown',
            isRTL: false,
        };
    }

    // English evidence for the Latin default, computed BEFORE the tinyld override
    // because the override is only allowed to overrule a NON-detection (see below).
    // Strip edge punctuation so "please?" matches "please". Callers use confidence to
    // decide whether to trust this detection (e.g. short Latin acronyms like "ICDL"
    // stay at 0.5 and let conversation history override).
    const normalizedWords = words.map(w => w.replace(/^[^a-z]+|[^a-z]+$/g, '')).filter(Boolean);
    const englishMatches = normalizedWords.filter(w => ENGLISH_COMMON.has(w)).length;
    const confidence = Math.min(0.5 + (englishMatches * 0.1), 0.9);

    // Phase 1b (LANG_ENGINE=tinyld only; inert by default): this is the exact
    // fallthrough where every legacy branch above failed to name the language —
    // the class that produced the "Hur kan man anmäla sig" → English@0.5 →
    // Arabic-reply production bug. Consult the hardened tinyld override
    // (non-ASCII + ≥2 words + allowlist + margin; see engine.ts for why the
    // naive threshold design was rejected). ASCII input (English, Arabizi,
    // acronyms) can never be overridden, so the English default below — and
    // both confidence gates keyed on it — stay bit-identical in both modes.
    //
    // `englishMatches === 0` is load-bearing, not a tuning knob: the override may
    // only overrule a NON-detection (the 0.5 floor = "Latin script, recognized
    // nothing"), never a positive English reading. A 30-day prod corpus diff
    // (11,459 Latin-script inbound messages) showed that WITHOUT this gate every
    // regression came from text legacy had already scored ≥0.6 on real English
    // stopwords, where a single stray accented character hijacked the whole
    // message: "Hello Sir. AĹLHUMDULL Usually have been best too do ing this
    // moment" (en@0.9) → Slovak, "How much po ang tuition ng business
    // administration major ỉn marketing management?" (Tagalog/English) →
    // Vietnamese, and Tunisian Arabizi "Ya Rab ya karim sotroque où afouek oua
    // ridhak" → French/Spanish — i.e. the exact Arabizi-mislabel class the
    // non-ASCII-letter gate exists to prevent, slipping in through one "é"/"où".
    // Requiring zero English evidence removes that class by construction while
    // keeping the genuine wins (Spanish, French, Romanian, Swedish, Portuguese,
    // Czech), which all arrive at the 0.5 floor.
    if (englishMatches === 0) {
        const override = maybeLatinOverride(cleanText);
        if (override) {
            return {
                language: override,
                confidence: OVERRIDE_CONFIDENCE,
                script: 'Latin',
                isRTL: false,
            };
        }

        // Same fallthrough, ASCII side. The override above can never fire for
        // pure-ASCII text (its non-ASCII-letter gate is what keeps Arabizi safe),
        // so genuine English that matched no ENGLISH_COMMON word stayed on the 0.5
        // floor — indistinguishable from the acronym "ICDL". Downstream that floor
        // means "no language signal": isLowSignalLatinToken is true, and
        // resolveCommentLanguage mirrors the POST's language, so "Very nice" on an
        // Arabic post was answered in Arabic (production, 2026-08-16).
        //
        // The promotion changes CERTAINTY only, never the language — 'en' is what
        // this branch returns either way — and it is gated to text tinyld reads as
        // English at ≥0.9 with ≥2 words and no Arabizi digit-fusion. Prod corpus
        // (2026-08-16): 3 of 21,510 answered ASCII comments change, all genuine
        // English, no transliterated name and no Arabizi in the promoted set;
        // 254 of 15,780 inbound ASCII DMs stop deferring to the thread's language,
        // including "Speak English pls" and "I don't understand arabic".
        if (isConfidentAsciiEnglish(cleanText)) {
            return {
                language: 'en',
                confidence: OVERRIDE_CONFIDENCE,
                script: 'Latin',
                isRTL: false,
            };
        }
    }

    // Default to English for Latin script.
    return {
        language: 'en',
        confidence,
        script: 'Latin',
        isRTL: false,
    };
}

/**
 * Simple language code detection (returns just the language code)
 */
export function detectLanguageCode(text: string): SupportedLanguage {
    return detectLanguage(text).language;
}

/**
 * True when `text` is a bare Latin token with no real language signal — a product
 * name / acronym like "icdl", "iPhone", "Excel", or a short "ok". The detector
 * reports these as English at its floor confidence (0.5 = zero matched function
 * words), which is indistinguishable from "no signal at all". Callers that pick a
 * customer-facing language use this to defer to conversation context or the
 * merchant's default language instead of forcing an English reply on an
 * otherwise-Arabic thread.
 *
 * Gate: English at confidence ≤ 0.5, ASCII alphanumerics only, ≤ 3 words — the
 * shape checks applied AFTER discounting emoji/punctuation, which carry no language
 * signal (see the note in the body). The confidence floor is the real signal; the
 * ASCII + word-count checks are a safety cap so a longer English sentence that
 * happens to dodge every function word can't be misread as a token. A genuine short
 * English question ("which course", "how much") matches a function word →
 * confidence > 0.5 → not low-signal.
 *
 * Kept in sync with resolveCommentLanguage (commentPreprocess.ts), which applies
 * the identical gate for the AI comment-reply path.
 */
export function isLowSignalLatinToken(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const det = detectLanguage(trimmed);
    if (det.language !== 'en' || det.confidence > 0.5) return false;

    // Discount NON-ASCII symbols (emoji, hearts, Unicode punctuation) before the
    // shape checks — they carry no language signal, exactly as engine.ts's
    // letter-gate reasons about the same codepoints. "ok" was a token but "ok 👍"
    // was not, and emoji-laden Arabizi ("kam el se3r 😍" — extremely common real
    // traffic) therefore resolved to English on an Arabic post through
    // resolveCommentLanguage, and to the English away/quota/greeting template
    // through detectTemplateLanguage. Fixed 2026-07-29.
    //
    // ASCII punctuation is deliberately KEPT. Stripping it too was measured against
    // 7,500 real prod messages and flipped 58.5% of traffic, including genuine
    // English prose — "I don't understand" and "I'm coming" became "tokens" once the
    // apostrophe was removed, which would have sent them to the merchant's default
    // language. The apostrophe/quote/bracket was doing real work as a proxy for
    // "this is prose, not a product name", so the safety cap keeps it. Narrowing to
    // non-ASCII symbols cuts the flip rate to a small, hand-checked set.
    //
    // The confidence floor above is untouched and remains the real discriminator, so
    // genuine short English questions ("how much?", "which course?" — all 0.6+) are
    // unaffected either way.
    // \x00-\x7F is an ASCII-range bound, not a control-character match — same pattern
    // and same suppression as engine.ts's letter-gate.
    // eslint-disable-next-line no-control-regex
    const signal = trimmed.replace(/[^\p{L}\p{N}\s\x00-\x7F]/gu, '').trim();
    // A token must carry at least one letter: "123", "?!" and "..." are not tokens.
    if (!/\p{L}/u.test(signal)) return false;

    return /^[a-zA-Z0-9\s]+$/.test(signal)
        && signal.split(/\s+/).length <= 3;
}

/**
 * Language code for choosing a customer-facing TEMPLATE (away / greeting / quota
 * fallback) variant. Returns 'unknown' for a low-signal Latin token so the
 * settings resolver falls back to the merchant's defaultReplyLanguage instead of
 * sending an English template on an Arabic thread (the "icdl" bug). Otherwise
 * identical to detectLanguageCode.
 */
export function detectTemplateLanguage(text: string): SupportedLanguage {
    return isLowSignalLatinToken(text) ? 'unknown' : detectLanguageCode(text);
}

/**
 * Check if text is RTL
 */
export function isRTL(text: string): boolean {
    return detectLanguage(text).isRTL;
}

/**
 * Detect comment language with fallback to post language.
 * Used when a comment is punctuation-only or script-less (e.g. ".", "...", emojis)
 * and the caller has the post/media content available as context.
 */
export function detectCommentLanguage(commentText: string, postMessage?: string | null): SupportedLanguage {
    const lang = detectLanguageCode(commentText);
    return lang !== 'unknown' ? lang : (postMessage ? detectLanguageCode(postMessage) : 'unknown');
}

/**
 * Resolve the language hint the backend sends the ai-worker for a DM.
 *
 * Low-confidence Latin detection — the en@<MIN_CERTAIN_CONFIDENCE "Latin
 * script, recognized nothing" floor (Arabizi, bare names, acronyms like
 * "ICDL") — with ANY prior thread context defers to the ai-worker's
 * history-first chain by sending no hint at all; a confident read travels
 * as-is. English-only on purpose: a NAMED-but-unevidenced language (tr@0.55
 * from a bare `ç`/`ı`) keeps its own language as the default rather than
 * inherit the thread's — the prompt's soft directive already stops it being
 * asserted as the customer's. The floor deliberately stays a BLUNT instrument
 * (it also catches accent-free French — a known, accepted limitation; the
 * isLowSignalLatinToken narrowing was tried 2026-07-29 and REVERTED; see
 * backend/test/services/deferToHistory.test.ts).
 *
 * Single source of truth for BOTH backend reply paths — generateForMessage
 * (production) and generateForPlayground (eval/test tool). The two had
 * drifted: defer-to-history landed only on the production path, so the
 * playground kept asserting the Latin floor as an explicit language and
 * answered a Latin-script bare name ("Weaam Aldoukha") in English
 * mid-Arabic-thread — a harness artifact production would not produce
 * (caught 2026-08-01). Lives here, next to its inputs, per the Phase 1a
 * consolidation rule: language logic in one shared module so surfaces cannot
 * drift apart.
 */
export function resolveDmLanguageHint(text: string, hasPriorHistory: boolean): string | undefined {
    const detected = detectLanguage(text);
    const { language: msgLang } = detected;
    const isLowConfidenceLatin = msgLang === 'en' && !isCertainDetection(detected);
    if (isLowConfidenceLatin && hasPriorHistory) return undefined;
    return msgLang !== 'unknown' ? msgLang : undefined;
}

/**
 * Map language code to full name
 */
export function getLanguageName(code: SupportedLanguage): string {
    const names: Record<SupportedLanguage, string> = {
        ar: 'Arabic',
        en: 'English',
        sv: 'Swedish',
        de: 'German',
        fr: 'French',
        es: 'Spanish',
        tr: 'Turkish',
        unknown: 'Unknown',
    };
    return names[code] || 'Unknown';
}
