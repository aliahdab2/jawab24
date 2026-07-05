/**
 * Language Detection Utility — re-export shim.
 *
 * The implementation was consolidated VERBATIM into
 * packages/shared/src/language/detector.ts (Phase 1a of the language-agnostic
 * plan) so backend and ai-worker can no longer drift apart. This shim keeps
 * every existing import path (`utils/language`) and signature intact — the
 * ~13 backend call sites and the regression suite in
 * backend/test/utils/language.test.ts are unchanged.
 *
 * Deep dist import (not the package barrel) is deliberate: it keeps the
 * language module — and the Phase-1b tinyld dependency — out of the frontend
 * webpack bundle by construction.
 */

export {
    detectLanguage,
    detectLanguageCode,
    detectTemplateLanguage,
    detectCommentLanguage,
    isLowSignalLatinToken,
    isRTL,
    getLanguageName,
    type SupportedLanguage,
    type LanguageDetectionResult,
} from '@jawab24/shared/dist/language/detector';
