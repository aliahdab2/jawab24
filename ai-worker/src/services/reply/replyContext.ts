/**
 * Request-derived helpers shared by the prompt builder and the reply validator.
 *
 * These are pure functions of a GenerateRequest — no API calls, no state. They
 * centralize three pieces of logic that were previously duplicated across
 * buildDynamicSystemSuffix, buildUserPrompt, and validateReply.
 */
import { resolveInputLanguage } from '../language';
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
 */
export function getKBText(request: GenerateRequest): string | null {
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
    return resolveInputLanguage({
        comment: request.comment,
        language: request.language,
        conversationHistory: request.context?.conversationHistory,
        postMessage: request.context?.postMessage,
        kbText: getKBText(request),
        defaultReplyLanguage: request.context?.defaultReplyLanguage,
    });
}
