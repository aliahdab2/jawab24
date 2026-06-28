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
    | 'AiQuotaError'          // OpenAI 429 insufficient_quota — account out of credit (parked + alerted)
    | 'OpenAIApiError'
    | 'AiWorkerUnreachable'   // backend → ai-worker hop failed (axios error, circuit open)
    | 'ZeroTokens'
    | 'MissingUserId'
    | 'Other';

export type AiMetricsStage = 'attempts' | 'returns' | 'logged' | 'failed_before_log';

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
 * Optional diagnostic hooks for `createAiMetrics`. Both backend and ai-worker
 * pass an `onMissingPipeline` callback so the host can surface the offending
 * call site (e.g. via Sentry) without coupling this shared module to any
 * specific observability SDK.
 */
export interface CreateAiMetricsOptions {
    /**
     * Fires the first time an emit lands with `pipeline === undefined`.
     * Used to identify call sites that should be tagged. Implementations
     * should rate-limit themselves — this is invoked per emit, but for
     * diagnostic purposes one capture per (stage, model) per process is
     * usually enough.
     */
    onMissingPipeline?: (stage: AiMetricsStage, model: string) => void;
}

/**
 * Strip a dated model snapshot suffix (e.g. `-2025-04-14`) so the counter
 * key shape uses the rolling alias regardless of which side of an OpenAI
 * call resolved the model name.
 *
 * Same logical call must produce the same key — `attempts` and `logged`
 * are emitted from different sites (the SDK call site uses the alias passed
 * in, but the response's `completion.model` returns the dated snapshot).
 * Normalizing at emit time makes the invariant structural.
 *
 * Models without a dated suffix pass through unchanged.
 */
export function normalizeModelTag(model: string): string {
    return model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
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

export function createAiMetrics(
    redis: AiMetricsRedis,
    options: CreateAiMetricsOptions = {},
): AiMetrics {
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

    function notifyMissingPipeline(stage: AiMetricsStage, model: string): void {
        const cb = options.onMissingPipeline;
        if (!cb) return;
        try {
            cb(stage, model);
        } catch {
            // Diagnostic hook must never block emit.
        }
    }

    function tagPipeline(pipeline: string | undefined, stage: AiMetricsStage, model: string): string {
        if (pipeline === undefined) {
            notifyMissingPipeline(stage, model);
            return 'unknown';
        }
        return pipeline;
    }

    return {
        recordAiAttempt(pipeline, model) {
            const m = normalizeModelTag(model);
            const p = tagPipeline(pipeline, 'attempts', m);
            emit(`${PREFIX}:attempts:${p}:${m}`);
        },
        recordAiReturn(pipeline, model) {
            const m = normalizeModelTag(model);
            const p = tagPipeline(pipeline, 'returns', m);
            emit(`${PREFIX}:returns:${p}:${m}`);
        },
        recordAiLogged(pipeline, model) {
            const m = normalizeModelTag(model);
            const p = tagPipeline(pipeline, 'logged', m);
            emit(`${PREFIX}:logged:${p}:${m}`);
        },
        recordAiFailedBeforeLog(pipeline, model, errorClass) {
            const m = normalizeModelTag(model);
            const p = tagPipeline(pipeline, 'failed_before_log', m);
            emit(`${PREFIX}:failed_before_log:${p}:${m}:${errorClass}`);
        },
    };
}
