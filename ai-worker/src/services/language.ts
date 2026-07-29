/**
 * Language detection and resolution helpers — re-export shim.
 *
 * The implementation was consolidated VERBATIM into
 * packages/shared/src/language/resolveChain.ts (Phase 1a of the
 * language-agnostic plan), completing the convergence this file's header had
 * flagged since the module was extracted. This shim keeps every existing
 * import path (`services/language`) and signature intact — replyContext.ts,
 * openai.ts, replyValidator.ts, and the regression suite in
 * ai-worker/test/language.test.ts are unchanged.
 *
 * Deep dist import (not the package barrel) is deliberate: it keeps the
 * language module — and the Phase-1b tinyld dependency — out of the frontend
 * webpack bundle by construction.
 */

export {
    detectLanguageOrNull,
    detectLanguage,
    isAmbiguousLatinToken,
    resolveInputLanguage,
    resolveInputLanguageWithSource,
    type ResolveLanguageInput,
    type ResolvedInputLanguage,
    type LanguageSource,
} from '@jawab24/shared/dist/language/resolveChain';
