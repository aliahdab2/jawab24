/**
 * Consolidated language detection for Jawab24 (Phase 1a of the
 * language-agnostic plan).
 *
 * Two intentionally-separate surfaces live here:
 *   - detector.ts     — backend surface (rich result + confidence; emits 'unknown')
 *   - resolveChain.ts — ai-worker surface (script-property detection + the
 *                       history-first reply-language resolution chain)
 *
 * They are NOT merged: their output alphabets, confidence semantics, and
 * low-signal-token predicates differ, and downstream gates key off those exact
 * values (backend generator deferToHistory <0.6, isLowSignalLatinToken ≤0.5,
 * ai-worker language_mismatch validation). Consumers import their own surface:
 *
 *   backend  → '@jawab24/shared/dist/language/detector'
 *   ai-worker → '@jawab24/shared/dist/language/resolveChain'
 *
 * IMPORTANT: this module is deliberately NOT re-exported from the package
 * barrel (packages/shared/src/index.ts) — keeping it (and the Phase-1b tinyld
 * dependency) out of the frontend webpack bundle by construction.
 *
 * Both `detectLanguage` exports collide by name, so this index re-exports the
 * backend surface as-is and the ai-worker surface's unique names only.
 */

export {
    detectLanguage,
    detectLanguageCode,
    detectTemplateLanguage,
    detectCommentLanguage,
    isLowSignalLatinToken,
    isRTL,
    getLanguageName,
    isCertainDetection,
    MIN_CERTAIN_CONFIDENCE,
    type SupportedLanguage,
    type LanguageDetectionResult,
} from './detector';

export {
    detectLanguageOrNull,
    isAmbiguousLatinToken,
    resolveInputLanguage,
    resolveInputLanguageWithSource,
    type ResolveLanguageInput,
    type ResolvedInputLanguage,
    type LanguageSource,
} from './resolveChain';

export {
    langEngineMode,
    tinyldLatinOverride,
    maybeLatinOverride,
    displayLanguageName,
    OVERRIDE_CONFIDENCE,
    type LangEngineMode,
} from './engine';
