/**
 * Phase 6.5 P1 diagnostic counters — shared factory.
 *
 * Both `backend/src/lib/aiMetrics.ts` and `ai-worker/src/lib/aiMetrics.ts`
 * are thin wrappers that inject their own Redis client into this factory.
 * Keeps the key shape and the fire-and-forget contract in one place.
 *
 * Key shape: `metrics:ai:{stage}:{pipeline}:{model}[:{error_class}]`
 *
 * Read with `scripts/phase6_5_breakdown.ts`. Gap analysis:
 *   attempts - returns  → worker / network / SDK silent retries
 *   returns  - logged   → backend log misses (guards, missing userId, swallowed errors)
 *
 * Hot-path safe: every emit catches its own error. Redis outage never blocks
 * an AI call.
 */

const PREFIX = 'metrics:ai';

export type FailedBeforeLogClass =
    | 'AiEmptyReplyError'
    | 'AiRefusalError'
    | 'AiTimeoutError'
    | 'OpenAIApiError'
    | 'ZeroTokens'
    | 'MissingUserId'
    | 'Other';

/**
 * Minimal Redis surface used by the counter — only `incr`. Lets callers pass
 * any client (ioredis, a test fake, a no-op) without dragging the full type.
 */
export interface AiMetricsRedis {
    incr(key: string): unknown;
}

export interface AiMetrics {
    recordAiAttempt(pipeline: string | undefined, model: string): void;
    recordAiReturn(pipeline: string | undefined, model: string): void;
    recordAiLogged(pipeline: string | undefined, model: string): void;
    recordAiFailedBeforeLog(
        pipeline: string | undefined,
        model: string,
        errorClass: FailedBeforeLogClass,
    ): void;
}

export function createAiMetrics(redis: AiMetricsRedis): AiMetrics {
    function emit(key: string): void {
        try {
            const result = redis.incr(key);
            // Some test fakes return undefined or non-promise; only attach catch when it's thenable.
            if (result && typeof (result as Promise<number>).catch === 'function') {
                (result as Promise<number>).catch(() => { /* metrics must never block the AI pipeline */ });
            }
        } catch {
            // Synchronous throw from a partial fake or unconfigured client — drop silently.
        }
    }

    return {
        recordAiAttempt(pipeline, model) {
            emit(`${PREFIX}:attempts:${pipeline ?? 'unknown'}:${model}`);
        },
        recordAiReturn(pipeline, model) {
            emit(`${PREFIX}:returns:${pipeline ?? 'unknown'}:${model}`);
        },
        recordAiLogged(pipeline, model) {
            emit(`${PREFIX}:logged:${pipeline ?? 'unknown'}:${model}`);
        },
        recordAiFailedBeforeLog(pipeline, model, errorClass) {
            emit(`${PREFIX}:failed_before_log:${pipeline ?? 'unknown'}:${model}:${errorClass}`);
        },
    };
}
