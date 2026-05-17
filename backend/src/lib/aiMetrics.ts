/**
 * Backend wrapper around `@jawab24/shared`'s `createAiMetrics` factory.
 * Binds the shared factory to the backend's Redis client and re-exports
 * the four counter functions so call sites can `import { recordAiAttempt }`
 * without thinking about wiring.
 *
 * The shared factory owns the key shape and the fire-and-forget contract;
 * see `packages/shared/src/aiMetrics.ts`.
 */
import { createAiMetrics, type FailedBeforeLogClass } from '@jawab24/shared';
import { redis } from './redis';

const impl = createAiMetrics(redis);

export type { FailedBeforeLogClass };
export const recordAiAttempt = impl.recordAiAttempt;
export const recordAiReturn = impl.recordAiReturn;
export const recordAiLogged = impl.recordAiLogged;
export const recordAiFailedBeforeLog = impl.recordAiFailedBeforeLog;
