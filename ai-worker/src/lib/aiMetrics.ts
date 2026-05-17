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
import { createAiMetrics, type FailedBeforeLogClass } from '@jawab24/shared';
import { redis } from './redis';

const impl = createAiMetrics(redis);

export type { FailedBeforeLogClass };
export const recordAiAttempt = impl.recordAiAttempt;
export const recordAiReturn = impl.recordAiReturn;
export const recordAiFailedBeforeLog = impl.recordAiFailedBeforeLog;
