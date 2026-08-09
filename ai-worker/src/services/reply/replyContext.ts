/**
 * Request-derived helpers shared by the prompt builder and the reply validator.
 *
 * These are pure functions of a GenerateRequest — no API calls, no state. They
 * centralize three pieces of logic that were previously duplicated across
 * buildDynamicSystemSuffix, buildUserPrompt, and validateReply.
 */
import { resolveInputLanguageWithSource, type LanguageSource } from '../language';
import type { GenerateRequest } from './types';

/**
 * Resolve the channel for this request.
 *
 * Explicit `context.channel` wins; otherwise presence of conversation history
 * implies a DM thread, and its absence implies a public comment. This same
 * inference appears wherever channel branching is needed, so it lives here once.
 */
export function resolveChannel(request: GenerateRequest): 'comment' | 'dm' {
    return request.context?.channel
        || (request.context?.conversationHistory && request.context.conversationHistory.length > 0 ? 'dm' : 'comment');
}

/**
 * Extract the effective KB text from the request context.
 * Returns combined chunk content if RAG, otherwise static KB, or null.
 *
 * Includes postMessage when present — the prompt injects the post as
 * `[current_post]` inside <business_knowledge>, so prices the AI quotes
 * from the post are legitimate (the business's own published content).
 * Excluding it here would misflag those prices as hallucinated and
 * trigger PRICE_FALLBACK.
 *
 * `includeProductCatalog` is an explicit opt-in (used by the price guard):
 * the <product_catalog> block is prompt-injected merchant content, so its
 * prices are legitimate grounding. It is NOT included by default because
 * resolveLanguage also consumes getKBText — folding the catalog in
 * unconditionally would perturb language inference for existing pages.
 *
 * `includeFactCollections` is the same opt-in for the <business_lists> block,
 * for the same reason and with the same caveat. Fact rows can carry a price
 * (متجر إجدابيا's per-city delivery table is the measured case), so without it
 * the price guard would flag a correctly-quoted delivery fee as invented — and
 * `price_not_in_kb` triggers a destructive reply swap in the backend.
 * NOTE: `backend/src/services/groundingVerifier.ts:buildGroundingSource` mirrors
 * this composition — a change here must be made there too.
 */
export function getKBText(request: GenerateRequest, opts?: { includeProductCatalog?: boolean; includeFactCollections?: boolean }): string | null {
    const parts: string[] = [];
    const chunks = request.context?.retrievedChunks;
    if (chunks && chunks.length > 0) {
        parts.push(chunks.map(c => `${c.title || ''} ${c.content}`).join(' '));
    } else if (request.context?.knowledgeBase) {
        parts.push(request.context.knowledgeBase);
    }
    if (request.context?.postMessage) {
        parts.push(request.context.postMessage);
    }
    if (request.context?.storePolicies) {
        parts.push(request.context.storePolicies);
    }
    if (opts?.includeProductCatalog && request.context?.productCatalog) {
        parts.push(request.context.productCatalog);
    }
    if (opts?.includeFactCollections && request.context?.factCollectionsBlock) {
        parts.push(request.context.factCollectionsBlock);
    }
    return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Resolve the reply language from all available signals.
 * Bridges the OpenAI-service-specific request shape to the pure language module.
 *
 * When the message has no detectable language (e.g. "..." or emoji-only), the
 * chain infers from conversation history → post content → KB language →
 * merchant's configured default before falling back to English.
 */
export function resolveLanguage(request: GenerateRequest): string {
    return resolveLanguageWithCertainty(request).language;
}

/**
 * Resolve the reply language AND whether it is a positive reading of this message.
 *
 * `certain: false` means "this is the thread's / the merchant's language, not
 * something we read off the customer's current words" — the prompt then keeps it as
 * the default but lets the model mirror the customer instead of asserting a lie.
 *
 * Certainty is derived inside the shared chain from `request.comment`, NOT taken as
 * a flag on the request: every hop between the backend and here rebuilds the payload
 * field-by-field, so a dedicated boolean gets dropped in transit while unit tests
 * that inject it stay green. `comment` is the one field that provably survives.
 */
export function resolveLanguageWithCertainty(request: GenerateRequest): { language: string; certain: boolean; source: LanguageSource } {
    const resolved = resolveInputLanguageWithSource({
        comment: request.comment,
        language: request.language,
        conversationHistory: request.context?.conversationHistory,
        postMessage: request.context?.postMessage,
        kbText: getKBText(request),
        defaultReplyLanguage: request.context?.defaultReplyLanguage,
    });

    // `source` names which link of the chain won. The prompt layer needs it because
    // ONE uncertain link — user-history — supports a truthful provenance sentence
    // ("the customer's own previous messages are in X"), which earns a stronger
    // directive than the other uncertain links (see languageDirective).
    return { language: resolved.language, certain: resolved.fromCurrentMessage, source: resolved.source };
}
