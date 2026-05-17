/**
 * ai-worker wrapper around `@jawab24/shared`'s `createAiMetrics` factory.
 * Same protocol and key namespace as backend — the analysis script reads
 * from one Redis namespace regardless of which service emitted the counter.
 *
 * `recordAiLogged` exists in the shared factory but the ai-worker never
 * inserts into `ai_usage_log` (the backend does), so the binding only
 * re-exports the three stages this service actually emits:
 *   - `attempts`           — before `chat.completions.create`
 *   - `returns`            — after the call resolves successfully
 *   - `failed_before_log`  — any catch/guard before the response leaves the worker
 */
import * as Sentry from '@sentry/node';
import {
    createAiMetrics,
    withAiMetrics as _withAiMetrics,
    type AiMetricsStage,
    type FailedBeforeLogClass,
} from '@jawab24/shared';
import { redis } from './redis';

/**
 * In-process dedupe for the `onMissingPipeline` Sentry message: capture once
 * per (stage, model) per process. Restart resets, which is fine for a
 * diagnostic hook — we just need each pod to surface its offending call
 * sites once.
 */
const missingPipelineSeen = new Set<string>();

const impl = createAiMetrics(redis, {
    onMissingPipeline(stage: AiMetricsStage, model: string) {
        const key = `${stage}:${model}`;
        if (missingPipelineSeen.has(key)) return;
        missingPipelineSeen.add(key);
        Sentry.captureMessage('ai_metrics_missing_pipeline', {
            level: 'warning',
            tags: { stage, model, source: 'ai-worker' },
        });
    },
});

export type { FailedBeforeLogClass };
export const recordAiAttempt = impl.recordAiAttempt;
export const recordAiReturn = impl.recordAiReturn;
export const recordAiFailedBeforeLog = impl.recordAiFailedBeforeLog;

/**
 * Bound `withAiMetrics(pipeline, model, fn, errorClassifier?)` — wraps an
 * OpenAI SDK call with the full three-stage emit protocol. Prefer this over
 * the raw `record*` helpers at every new call site; the helper makes it
 * structurally impossible to emit `attempts` without a matching terminal
 * emit (returns / failed_before_log).
 */
export function withAiMetrics<T>(
    pipeline: string | undefined,
    model: string,
    fn: () => Promise<T>,
    errorClassifier?: (err: unknown) => FailedBeforeLogClass,
): Promise<T> {
    return _withAiMetrics(impl, pipeline, model, fn, errorClassifier);
}
