/**
 * Phase 6.5 P1 diagnostic counters — measure where ai_usage_log coverage leaks.
 *
 * Four stages per AI call lifecycle, fire-and-forget INCR into Redis:
 *
 *   metrics:ai:attempts:{pipeline}:{model}              — before the API call
 *   metrics:ai:returns:{pipeline}:{model}               — after the call returned successfully
 *   metrics:ai:logged:{pipeline}:{model}                — after ai_usage_log insert succeeded
 *   metrics:ai:failed_before_log:{pipeline}:{model}:{error_class}
 *                                                       — call entered an error/guard path
 *                                                         that bypasses ai_usage_log
 *
 * Read with scripts/phase6_5_breakdown.ts. Gap analysis:
 *   attempts - returns  → ai-worker / SDK / network failures
 *   returns  - logged   → backend log misses (guards, swallowed errors, missing userId)
 *
 * Hot-path safe: every emit catches its own error. Redis outage never blocks
 * an AI call.
 */
import { redis } from './redis';

const PREFIX = 'metrics:ai';

export type FailedBeforeLogClass =
    | 'AiEmptyReplyError'
    | 'AiRefusalError'
    | 'AiTimeoutError'
    | 'OpenAIApiError'
    | 'ZeroTokens'
    | 'MissingUserId'
    | 'Other';

function emit(key: string): void {
    try {
        const result = redis.incr(key);
        // Some test mocks return undefined / non-promise; only attach catch when it's a thenable.
        if (result && typeof (result as Promise<number>).catch === 'function') {
            (result as Promise<number>).catch(() => { /* metrics must never block the AI pipeline */ });
        }
    } catch {
        // Synchronous throw from a partial mock or unconfigured client — drop silently.
    }
}

export function recordAiAttempt(pipeline: string | undefined, model: string): void {
    emit(`${PREFIX}:attempts:${pipeline ?? 'unknown'}:${model}`);
}

export function recordAiReturn(pipeline: string | undefined, model: string): void {
    emit(`${PREFIX}:returns:${pipeline ?? 'unknown'}:${model}`);
}

export function recordAiLogged(pipeline: string | undefined, model: string): void {
    emit(`${PREFIX}:logged:${pipeline ?? 'unknown'}:${model}`);
}

export function recordAiFailedBeforeLog(
    pipeline: string | undefined,
    model: string,
    errorClass: FailedBeforeLogClass,
): void {
    emit(`${PREFIX}:failed_before_log:${pipeline ?? 'unknown'}:${model}:${errorClass}`);
}
