/**
 * Backend wrapper around `@jawab24/shared`'s `createAiMetrics` factory.
 * Binds the shared factory to the backend's Redis client and re-exports
 * the four counter functions so call sites can `import { recordAiAttempt }`
 * without thinking about wiring.
 *
 * The shared factory owns the key shape and the fire-and-forget contract;
 * see `packages/shared/src/aiMetrics.ts`.
 */
import * as Sentry from '@sentry/node';
import { createAiMetrics, type AiMetricsStage, type FailedBeforeLogClass } from '@jawab24/shared';
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
            tags: { stage, model, source: 'backend' },
        });
    },
});

export type { FailedBeforeLogClass };
export const recordAiAttempt = impl.recordAiAttempt;
export const recordAiReturn = impl.recordAiReturn;
export const recordAiLogged = impl.recordAiLogged;
export const recordAiFailedBeforeLog = impl.recordAiFailedBeforeLog;
