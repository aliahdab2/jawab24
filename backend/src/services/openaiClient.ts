/**
 * Tracked OpenAI client wrapper.
 *
 * Every direct OpenAI call from backend/ MUST go through `makeTrackedOpenAI`.
 * Raw `new OpenAI()` is banned by ESLint outside this module — that guarantees
 * every chat completion / embedding / vision call writes one row to
 * `ai_usage_log` automatically. No "remember to log" discipline.
 *
 * For calls routed through ai-worker over HTTP, this wrapper is NOT used —
 * the consumer of the ai-worker response is responsible for invoking
 * `logAiUsage()` with the `tokensIn`/`tokensOut` returned in the response
 * (existing pattern in `services/ai.ts` and `services/ecommerceToolLoop.ts`).
 */
import OpenAI, { APIError, BadRequestError, RateLimitError } from 'openai';
import { logAiUsage } from './aiUsageLog';
import type { AiPipeline } from '../types/aiPipeline';

/**
 * Explicit re-exports of OpenAI error classes so consumers can `instanceof`
 * check without importing from `'openai'` directly (which is banned by
 * ESLint outside this module). Add more classes here as needed.
 */
export { APIError, BadRequestError, RateLimitError };

export interface TrackedOpenAIContext {
    userId: string;
    pageId?: string;
    pipeline: AiPipeline;
    /** Set per-call when classification produces an intent (replies). */
    intent?: string | null;
}

export interface TrackedOpenAI {
    chat: OpenAI['chat'];
    embeddings: OpenAI['embeddings'];
    /** Escape hatch for the raw client. Callers that use this are responsible for logging. */
    raw: OpenAI;
}

/**
 * Build a tracked client bound to a (userId, pipeline) context. Every chat
 * completion or embedding call automatically writes to `ai_usage_log` using
 * the `usage` returned by OpenAI. Logging is fire-and-forget — failures
 * surface as Sentry breadcrumbs inside `logAiUsage`, not as request errors.
 *
 * **Non-streaming only.** The wrapper unwraps `usage` from the response
 * object and skips logging when the response is an `AsyncIterable` (stream).
 * Callers that need streaming MUST use `.raw` and log manually — current
 * production paths are non-streaming so this is fine.
 *
 * **`intent` is fixed at construction.** Useful for embedding/translation
 * pipelines where intent doesn't apply. Reply pipelines that classify
 * per-call need to extend this API (or call `logAiUsage` directly via
 * `.raw`) before migrating.
 */
export function makeTrackedOpenAI(apiKey: string, ctx: TrackedOpenAIContext): TrackedOpenAI {
    const client = new OpenAI({ apiKey });

    const chatCreate = client.chat.completions.create.bind(client.chat.completions);
    const trackedChatCreate = (async (...args: Parameters<typeof chatCreate>) => {
        const response = await chatCreate(...(args as Parameters<typeof chatCreate>));
        // Streaming responses return an AsyncIterable, not a usage object — skip.
        // All current callers use the non-streaming path.
        if (response && typeof response === 'object' && 'usage' in response && 'model' in response) {
            const usage = (response as { usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }).usage;
            const modelUsed = (response as { model?: string }).model || (args[0] as { model: string }).model;
            logAiUsage({
                userId: ctx.userId,
                pageId: ctx.pageId,
                model: modelUsed,
                tokensIn: usage?.prompt_tokens ?? 0,
                cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
                tokensOut: usage?.completion_tokens ?? 0,
                cached: false,
                pipeline: ctx.pipeline,
                intent: ctx.intent ?? null,
            }).catch(() => { /* logged via Sentry breadcrumb inside logAiUsage */ });
        }
        return response;
    }) as typeof chatCreate;

    const embedCreate = client.embeddings.create.bind(client.embeddings);
    const trackedEmbedCreate = (async (...args: Parameters<typeof embedCreate>) => {
        const response = await embedCreate(...(args as Parameters<typeof embedCreate>));
        const modelUsed = response.model || (args[0] as { model: string }).model;
        logAiUsage({
            userId: ctx.userId,
            pageId: ctx.pageId,
            model: modelUsed,
            tokensIn: response.usage?.prompt_tokens ?? 0,
            cachedInputTokens: 0,
            tokensOut: 0,
            cached: false,
            pipeline: ctx.pipeline,
            intent: null,
        }).catch(() => { /* logged via Sentry breadcrumb inside logAiUsage */ });
        return response;
    }) as typeof embedCreate;

    return {
        chat: {
            ...client.chat,
            completions: { ...client.chat.completions, create: trackedChatCreate },
        } as OpenAI['chat'],
        embeddings: { ...client.embeddings, create: trackedEmbedCreate } as OpenAI['embeddings'],
        raw: client,
    };
}
