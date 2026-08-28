/**
 * Reply-language context ladder — the ONE place that answers "what language do we
 * write in when the customer's own text carries no language signal?".
 *
 * Lives in `utils/` rather than in `services/reply/generator.ts` (its original home)
 * because it is a PURE function that two layers need: the generator's canned-fallback
 * paths, and `services/reply/commentPreprocess.ts`, which synthesises the
 * content-free-CTA question. `generator.ts` already imports `commentPreprocess`, so
 * leaving the ladder there and importing it back would be a circular dependency — and
 * importing `generator` (which drags in the DB pool, config and the OpenAI client) into
 * a pure text module would be a layering inversion besides.
 *
 * `generator.ts` re-exports `resolveFallbackLanguage` so its six existing call sites and
 * the suites that mock them are unaffected by the move.
 */

import { detectLanguageCode, isLowSignalLatinToken } from './language';

/**
 * Pick a language for canned fallback text (PRICE_FALLBACK, etc.) and for the
 * synthetic content-free-CTA question.
 * The customer message is often script-less ("..."/emoji) when fallback fires,
 * so fall through to post → KB → merchant default before defaulting to English.
 * Mirrors the chain in openai.ts buildDynamicSystemSuffix.
 */
export function resolveFallbackLanguage(opts: {
    text?: string;
    postMessage?: string;
    knowledgeBase?: string;
    defaultReplyLanguage?: string;
}): 'ar' | 'en' {
    const sources = [opts.text, opts.postMessage, opts.knowledgeBase];
    for (const s of sources) {
        if (!s) continue;
        // A bare Latin token ("icdl", a product name) carries no real language
        // signal — the detector floors it at English. Skip it so the conversation
        // context (post → KB → merchant default) decides the fallback language,
        // matching resolveCommentLanguage. Without this, an "icdl" reply on an
        // Arabic thread forces the English away/quota fallback template.
        if (isLowSignalLatinToken(s)) continue;
        const lang = detectLanguageCode(s);
        if (lang !== 'unknown') return lang === 'ar' ? 'ar' : 'en';
    }
    if (opts.defaultReplyLanguage) {
        return opts.defaultReplyLanguage === 'ar' ? 'ar' : 'en';
    }
    return 'en';
}

/**
 * Language for text WE author on the customer's behalf, when the customer supplied no
 * language signal at all — today: the synthetic question `rewriteContentFreeCta` puts in
 * place of a bare emoji / dot on a CTA post.
 *
 * The merchant's configured default comes FIRST here, which is the opposite of
 * `resolveFallbackLanguage`'s ordering, and the inversion is the whole point:
 *
 *   • `auto_detect_language` detects THE CUSTOMER's language. A content-free comment has
 *     none by precondition, so there is nothing for detection to act on and the merchant's
 *     configured default is exactly what a default is for.
 *   • The post's language is the MERCHANT's choice of styling for that post, not evidence
 *     about the commenter. Trusting it is a guess about a third party — and it is a guess
 *     the detector gets wrong on the shapes that dominate real traffic. Measured on
 *     Shahin Resort's 238 English content-free replies (30 days): 183 (77%) came from
 *     decorative spaced-letter captions (`P O O L`, `M L U E`), 19 (8%) from Latin
 *     transliterations of Arabic proper names (`NADER AL ATAT`), and only 36 (15%) from
 *     genuine English prose. `isLowSignalLatinToken` cannot rescue these: its ≤3-word cap
 *     lets `A R C` through but not `P O O L`, so the ladder returns 'en' at its first rung
 *     and never reaches the KB or the merchant default.
 *
 * Fleet blast radius when this shipped: 251 of 731 content-free AI comment replies over 30
 * days flip English → Arabic (238 Shahin, 11 مزة جبل 86, 2 BAMBO LIBYA). Nothing flips the
 * other way — every page in the fleet has `default_reply_language = 'ar'`.
 *
 * Returns a language CODE, not an ar/en binary. `resolveFallbackLanguage` narrows to
 * `'ar' | 'en'`, which would collapse a merchant who configured `sv` / `fr` / `tr` to
 * English — even though `detectLanguageCode` names all of those and
 * `resolveCommentLanguage` is explicitly written to reply in any language the detector
 * can name. The binary was the bottleneck, not the pipeline. Passing the merchant's code
 * through unchanged means the ONLY thing a new language needs is its authored strings
 * (see `t()` / `backend/src/i18n/<locale>.json`), which is the contract Rule 13b promises.
 *
 * INVARIANT this creates, and why i18n is the right home for the sentence: the synthetic
 * question is fed back through `resolveCommentLanguage` as the explicit language hint, so
 * the REPLY's language is the language the sentence is actually written in. A locale with
 * no authored sentence therefore degrades to English rather than to a Swedish reply with
 * an English prompt — `t()` falls back to English for an unknown locale, which is safe but
 * is a real limit. Adding `<locale>.json` is what lifts it, and `MessageKey` makes a
 * half-added locale a compile error rather than a silent English reply.
 *
 * NOTE (deliberately not bundled): `resolveFallbackLanguage`'s canned away/quota/price
 * templates are also authored-by-us text that fires on script-less input, so the same
 * inversion — and the same ar/en widening — arguably belongs there. That is a fleet-wide
 * change to a different set of messages and needs its own measurement; one change at a
 * time. Until then this function only WIDENS: for the ar/en pair the two agree exactly.
 */
export function resolveAuthoredCtaLanguage(opts: {
    postMessage?: string;
    knowledgeBase?: string;
    defaultReplyLanguage?: string;
}): string {
    // Pass the configured code through as-is — no ar/en narrowing. `t()` resolves it
    // against the authored locales and falls back to English for one it has no strings for.
    if (opts.defaultReplyLanguage) return opts.defaultReplyLanguage;
    // No merchant default configured — fall back to the context ladder rather than
    // hardcoding English, so a page that never set the field still mirrors its post/KB.
    return resolveFallbackLanguage(opts);
}
