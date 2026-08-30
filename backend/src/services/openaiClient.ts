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
import { recordAiAttempt, recordAiReturn, recordAiFailedBeforeLog, type FailedBeforeLogClass } from '../lib/aiMetrics';
import { isTimeoutAbort } from '@jawab24/shared';
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
    /**
     * Deliberately `generate`-only: `images.edit` / `createVariation` would run
     * untracked through a spread copy, silently bypassing ai_usage_log. Widen
     * this (with tracking) if an edit path ever ships.
     */
    images: Pick<OpenAI['images'], 'generate'>;
    /** Escape hatch for the raw client. Callers that use this are responsible for logging. */
    raw: OpenAI;
}

/**
 * Classify a thrown OpenAI error for the `failed_before_log` counter.
 *
 * When the call site passed its OWN AbortSignal and that signal is aborted, our
 * timeout fired. That is the only way to tell: the SDK's abort error carries no
 * distinguishing `name` (see `isTimeoutAbort` for the full story) — the same trap
 * that shipped JAWAB24-BACKEND-1J. Call sites without a signal have no timeout of
 * ours to attribute, so they keep reporting `OpenAIApiError`.
 *
 * Lives here because this wrapper is the single canonical `failed_before_log` emit
 * site for every pipeline routed through it (AI_INSTRUCTIONS §13c) — classifying
 * at the call sites instead would either duplicate the predicate or double-count.
 */
function classifyFailure(opts: { signal?: AbortSignal | null } | undefined): FailedBeforeLogClass {
    return opts?.signal && isTimeoutAbort(opts.signal) ? 'AiTimeoutError' : 'OpenAIApiError';
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
        const requestedModel = (args[0] as { model: string }).model;
        recordAiAttempt(ctx.pipeline, requestedModel);
        let response;
        try {
            response = await chatCreate(...(args as Parameters<typeof chatCreate>));
        } catch (err) {
            recordAiFailedBeforeLog(ctx.pipeline, requestedModel, classifyFailure(args[1]));
            throw err;
        }
        recordAiReturn(ctx.pipeline, requestedModel);
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
        const requestedModel = (args[0] as { model: string }).model;
        recordAiAttempt(ctx.pipeline, requestedModel);
        let response;
        try {
            response = await embedCreate(...(args as Parameters<typeof embedCreate>));
        } catch (err) {
            recordAiFailedBeforeLog(ctx.pipeline, requestedModel, classifyFailure(args[1]));
            throw err;
        }
        recordAiReturn(ctx.pipeline, requestedModel);
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

    const imagesGenerate = client.images.generate.bind(client.images);
    const trackedImagesGenerate = (async (...args: Parameters<typeof imagesGenerate>) => {
        const requestedModel = String((args[0] as { model?: string }).model ?? 'unknown');
        recordAiAttempt(ctx.pipeline, requestedModel);
        let response;
        try {
            response = await imagesGenerate(...(args as Parameters<typeof imagesGenerate>));
        } catch (err) {
            recordAiFailedBeforeLog(ctx.pipeline, requestedModel, classifyFailure(args[1]));
            throw err;
        }
        recordAiReturn(ctx.pipeline, requestedModel);
        // gpt-image models report token usage (input_tokens = prompt text,
        // output_tokens = image tokens). ImagesResponse carries no `model`
        // field, so the requested model is what gets logged.
        if (response && typeof response === 'object' && 'usage' in response) {
            const usage = (response as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
            logAiUsage({
                userId: ctx.userId,
                pageId: ctx.pageId,
                model: requestedModel,
                tokensIn: usage?.input_tokens ?? 0,
                cachedInputTokens: 0,
                tokensOut: usage?.output_tokens ?? 0,
                cached: false,
                pipeline: ctx.pipeline,
                intent: ctx.intent ?? null,
            }).catch(() => { /* logged via Sentry breadcrumb inside logAiUsage */ });
        } else {
            // Unlike chat, images have NO streaming path — a resolved response
            // without `usage` is always an anomaly: the call was billed but no
            // ai_usage_log row will follow. Book it (§13c: every logAiUsage
            // bypass emits failed_before_log) so the gap analysis can name the
            // miss instead of showing an unexplained R−L gap on the most
            // expensive call in the codebase.
            recordAiFailedBeforeLog(ctx.pipeline, requestedModel, 'ZeroTokens');
        }
        return response;
    }) as typeof imagesGenerate;

    return {
        chat: {
            ...client.chat,
            completions: { ...client.chat.completions, create: trackedChatCreate },
        } as OpenAI['chat'],
        embeddings: { ...client.embeddings, create: trackedEmbedCreate } as OpenAI['embeddings'],
        images: { generate: trackedImagesGenerate },
        raw: client,
    };
}

/** The deadline helper every pinned-model call site should use with this wrapper —
 *  see `lib/abortTimeout.ts` for why it exists and why it lives outside this module. */
export { withAbortTimeout } from '../lib/abortTimeout';
