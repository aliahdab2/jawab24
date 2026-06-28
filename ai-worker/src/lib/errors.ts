/**
 * Typed AI failure errors that propagate from ai-worker to backend over HTTP.
 *
 * Class identity is intentionally NOT shared across the package boundary —
 * backend reconstructs by matching on `name` against the body of a 500 response
 * (mirrors the existing `CircuitOpenError` convention in
 * backend/src/utils/fbGraphErrors.ts). This avoids cross-package coupling and
 * lets either side evolve its internal handling independently.
 *
 * If you add a class here, also add it to backend/src/utils/fbGraphErrors.ts
 * and decide its classification in isTransientAiError + needsImmediateAttention.
 */

/**
 * Thrown by openai.ts when no client is configured (OPENAI_API_KEY missing).
 * Backend maps this name to its own AiUnavailableError, classified as transient
 * so the row reaches needs_attention via flagStuckJobOnFinalFailure rather than
 * being silently swallowed into success:false.
 */
export class AiClientNotConfiguredError extends Error {
    readonly modelId?: string;
    constructor(modelId?: string, message?: string) {
        super(message ?? `AI client not configured${modelId ? ` for model ${modelId}` : ''}`);
        this.name = 'AiClientNotConfiguredError';
        this.modelId = modelId;
    }
}

/**
 * Thrown when OpenAI's request aborts on timeout (APIUserAbortError). Backend
 * classifies as transient — same input on retry usually succeeds.
 */
export class AiTimeoutError extends Error {
    readonly timeoutMs?: number;
    constructor(timeoutMs?: number, message?: string) {
        super(message ?? `AI request timed out${timeoutMs ? ` after ${timeoutMs}ms` : ''}`);
        this.name = 'AiTimeoutError';
        this.timeoutMs = timeoutMs;
    }
}

/**
 * Thrown when OpenAI's structured-output guard returns a `refusal` field
 * instead of generating content. Backend classifies as NON-transient and
 * routes to immediate needs_attention with `refusalReason` as the flag note.
 */
export class AiRefusalError extends Error {
    readonly refusalReason: string;
    constructor(refusalReason: string, message?: string) {
        super(message ?? `OpenAI refused to generate a reply: ${refusalReason}`);
        this.name = 'AiRefusalError';
        this.refusalReason = refusalReason;
    }
}

/**
 * Thrown when post-generation validation strips the reply down to <10 chars
 * (bot-words filter in openai.ts validateReply). Backend classifies as
 * NON-transient — the filter is deterministic, retry will yield the same result.
 */
export class AiEmptyReplyError extends Error {
    constructor(message = 'AI reply was empty after content filtering') {
        super(message);
        this.name = 'AiEmptyReplyError';
    }
}

/**
 * Thrown when OpenAI returns 429 `insufficient_quota` — the account is out of
 * credit or has hit its billing hard limit. This is account-level and persistent:
 * it does NOT recover within BullMQ's fast retry window (2s/4s/8s), but DOES
 * recover the moment billing is topped up. Backend treats this specially —
 * instead of burning retries and flagging the row needs_attention, it PARKS the
 * job (re-enqueue with a long delay) so the message auto-replies once credit
 * returns, and fires a throttled "top up OpenAI" alert. See backend
 * replyWorker.ts park-and-retry and ai.ts quota alert.
 */
export class AiQuotaExhaustedError extends Error {
    constructor(message = 'OpenAI quota exhausted (insufficient_quota)') {
        super(message);
        this.name = 'AiQuotaExhaustedError';
    }
}

/**
 * True when an OpenAI SDK error is a 429 `insufficient_quota` (account out of
 * credit / billing hard limit), as opposed to a plain rate-limit 429 (which is
 * genuinely transient and should keep its fast-retry behavior). The SDK surfaces
 * the code on the error itself and nested under `.error` depending on version, so
 * we check both. Exported so it can be unit-tested without a live OpenAI call.
 */
export function isInsufficientQuotaError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { status?: unknown; code?: unknown; error?: { code?: unknown; type?: unknown } };
    const status = typeof e.status === 'number' ? e.status : undefined;
    const code = typeof e.code === 'string' ? e.code : undefined;
    const nestedCode = typeof e.error?.code === 'string' ? e.error.code : undefined;
    const nestedType = typeof e.error?.type === 'string' ? e.error.type : undefined;
    const quotaMarker = code === 'insufficient_quota'
        || nestedCode === 'insufficient_quota'
        || nestedType === 'insufficient_quota';
    // insufficient_quota is always reported with HTTP 429, but some SDK wrappers
    // drop the status — accept the marker on its own to stay robust.
    return quotaMarker && (status === undefined || status === 429);
}

/**
 * Names recognized by backend's error reconstruction in ai.ts. Anything thrown
 * with a different `name` will be caught by Fastify's default 500 handler and
 * the original (non-typed) error path on the backend side.
 */
export const AI_TYPED_ERROR_NAMES: ReadonlySet<string> = new Set([
    'AiClientNotConfiguredError',
    'AiTimeoutError',
    'AiRefusalError',
    'AiEmptyReplyError',
    'AiQuotaExhaustedError',
]);

/**
 * Serialize a typed error for the HTTP response body. Returns null when the
 * error is not one of our typed AI errors (caller falls back to generic 500).
 */
export function serializeTypedAiError(err: unknown): { name: string; message: string; refusalReason?: string } | null {
    if (!(err instanceof Error)) return null;
    if (!AI_TYPED_ERROR_NAMES.has(err.name)) return null;
    return {
        name: err.name,
        message: err.message,
        ...(err instanceof AiRefusalError ? { refusalReason: err.refusalReason } : {}),
    };
}
