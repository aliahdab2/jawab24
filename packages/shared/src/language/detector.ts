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
import { maybeLatinOverride, OVERRIDE_CONFIDENCE } from './engine';

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

// Common words for additional context
const ENGLISH_COMMON = [
    'the', 'is', 'are', 'and', 'or', 'but', 'with', 'for', 'from', 'have', 'has', 'been',
    'you', 'me', 'my', 'your', 'we', 'our', 'they', 'their', 'it', 'he', 'she',
    'can', 'could', 'will', 'would', 'should', 'do', 'does', 'did',
    'what', 'when', 'where', 'why', 'how', 'who', 'which',
    'this', 'that', 'these', 'those', 'in', 'on', 'at', 'to', 'of',
    'please', 'help', 'want', 'need', 'thanks', 'hi', 'hello', 'hey',
];
const SWEDISH_COMMON = ['och', 'det', 'att', 'som', 'på', 'är', 'av', 'för', 'med', 'har'];

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
        const swedishMatches = words.filter(w => SWEDISH_COMMON.includes(w)).length;
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
    const swedishMatches = words.filter(w => SWEDISH_COMMON.includes(w)).length;
    if (swedishMatches >= 2) {
        return {
            language: 'sv',
            confidence: 0.7 + (swedishMatches * 0.05),
            script: 'Latin',
            isRTL: false,
        };
    }

    // Turkish check (fallback without word check, just unique chars)
    if (/[ğıİşŞçÇ]/.test(cleanText)) {
        return {
            language: 'tr',
            confidence: 0.75,
            script: 'Latin',
            isRTL: false,
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

    // Phase 1b (LANG_ENGINE=tinyld only; inert by default): this is the exact
    // fallthrough where every legacy branch above failed to name the language —
    // the class that produced the "Hur kan man anmäla sig" → English@0.5 →
    // Arabic-reply production bug. Consult the hardened tinyld override
    // (non-ASCII + ≥2 words + allowlist + margin; see engine.ts for why the
    // naive threshold design was rejected). ASCII input (English, Arabizi,
    // acronyms) can never be overridden, so the English default below — and
    // both confidence gates keyed on it — stay bit-identical in both modes.
    const override = maybeLatinOverride(cleanText);
    if (override) {
        return {
            language: override,
            confidence: OVERRIDE_CONFIDENCE,
            script: 'Latin',
            isRTL: false,
        };
    }

    // Default to English for Latin script.
    // Strip edge punctuation so "please?" matches "please". Callers use confidence to
    // decide whether to trust this detection (e.g. short Latin acronyms like "ICDL"
    // stay at 0.5 and let conversation history override).
    const normalizedWords = words.map(w => w.replace(/^[^a-z]+|[^a-z]+$/g, '')).filter(Boolean);
    const englishMatches = normalizedWords.filter(w => ENGLISH_COMMON.includes(w)).length;
    const confidence = Math.min(0.5 + (englishMatches * 0.1), 0.9);

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
