/**
 * Phase 6.5 P1 diagnostic counters — ai-worker side.
 * Mirrors backend/src/lib/aiMetrics.ts. Same key namespace, same semantics,
 * so the analysis script reads from one Redis namespace regardless of which
 * service emitted the counter.
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

export function recordAiFailedBeforeLog(
    pipeline: string | undefined,
    model: string,
    errorClass: FailedBeforeLogClass,
): void {
    emit(`${PREFIX}:failed_before_log:${pipeline ?? 'unknown'}:${model}:${errorClass}`);
}
