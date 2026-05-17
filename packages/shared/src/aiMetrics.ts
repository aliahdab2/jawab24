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
    | 'AiWorkerUnreachable'   // backend → ai-worker hop failed (axios error, circuit open)
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

/**
 * Wrap an OpenAI SDK call (or any awaitable) with the three-stage emit
 * protocol: attempts → returns / failed_before_log. Replaces the hand-rolled
 * `recordAiAttempt → try { ... } catch { recordAiFailedBeforeLog; throw } → recordAiReturn`
 * boilerplate that previously lived at six ai-worker sites + the backend
 * direct-call sites.
 *
 * The helper enforces the contract by construction — you cannot forget
 * `recordAiReturn` because the helper always emits it on success, and you
 * cannot emit `attempts` without also emitting one of `returns` /
 * `failed_before_log` because both terminal branches are wired here.
 *
 * @param errorClassifier  Optional. Maps a thrown error to a FailedBeforeLogClass.
 *                         Defaults to 'OpenAIApiError'. Call sites with richer
 *                         error vocabulary (timeouts, refusals) pass their own.
 */
export async function withAiMetrics<T>(
    metrics: AiMetrics,
    pipeline: string | undefined,
    model: string,
    fn: () => Promise<T>,
    errorClassifier?: (err: unknown) => FailedBeforeLogClass,
): Promise<T> {
    metrics.recordAiAttempt(pipeline, model);
    let result: T;
    try {
        result = await fn();
    } catch (err) {
        const cls = errorClassifier ? errorClassifier(err) : 'OpenAIApiError';
        metrics.recordAiFailedBeforeLog(pipeline, model, cls);
        throw err;
    }
    metrics.recordAiReturn(pipeline, model);
    return result;
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
