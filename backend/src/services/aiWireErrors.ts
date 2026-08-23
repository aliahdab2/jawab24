/**
 * Reconstruct the ai-worker's typed AI errors from an axios failure.
 *
 * The ai-worker serialises its contract-defined failures (refusal, timeout,
 * empty reply, unconfigured client, quota) as a 500 whose body is
 * `{ error: { name, message, refusalReason? } }`. The backend needs the same
 * class back so the reply pipeline branches correctly — refusal / empty →
 * immediate needs_attention, timeout / unavailable → BullMQ retry, quota →
 * park. Reconstruction is by `error.name` (the CircuitOpenError convention) so
 * nothing couples to the ai-worker's class identity.
 *
 * Pure: no Sentry tags, no alerts — callers decide what to do with the result
 * (`ai.ts` tags it and fires the quota alert; the e-commerce tool loop only
 * propagates the classes that must not be hidden behind a regeneration).
 * Returns null for anything that is not a recognised typed error, so a caller
 * never invents a class it does not know.
 */
import {
    AiUnavailableError, AiTimeoutError, AiRefusalError, AiEmptyReplyError, AiQuotaExhaustedError,
} from '../utils/fbGraphErrors';

export interface WireAiError {
    /** The ai-worker's error name, exactly as sent. */
    name: string;
    /** The backend-side class for it. */
    error: Error;
}

/**
 * The body an axios HTTP-error carries. Duck-typed on purpose rather than
 * `axios.isAxiosError`: the shape is the contract, and the 60-odd hand-rolled
 * axios mocks in the test suites rarely stub the namespace helper (a catch
 * that calls it then throws inside the catch — see `drizzle-mock-explicit-exports`).
 */
function wireErrorBody(error: unknown): { name?: unknown; message?: unknown; refusalReason?: unknown } | null {
    if (typeof error !== 'object' || error === null) return null;
    const response = (error as { response?: { data?: { error?: unknown } } }).response;
    const body = response?.data?.error;
    return typeof body === 'object' && body !== null ? body as { name?: unknown; message?: unknown; refusalReason?: unknown } : null;
}

export function typedAiErrorFromWire(error: unknown): WireAiError | null {
    const wire = wireErrorBody(error);
    if (!wire) return null;
    const name = typeof wire.name === 'string' ? wire.name : undefined;
    if (!name) return null;
    const message = typeof wire.message === 'string' ? wire.message : undefined;
    const refusalReason = typeof wire.refusalReason === 'string' ? wire.refusalReason : undefined;

    switch (name) {
        case 'AiRefusalError':
            return { name, error: new AiRefusalError(refusalReason ?? 'unknown', message) };
        case 'AiTimeoutError':
            return { name, error: new AiTimeoutError(undefined, message) };
        case 'AiEmptyReplyError':
            return { name, error: new AiEmptyReplyError(message) };
        case 'AiClientNotConfiguredError':
            // ai-worker's "no client" maps to backend's AiUnavailableError
            // (same semantics: permanent-but-flag-via-retry-exhaustion).
            return { name, error: new AiUnavailableError(message) };
        case 'AiQuotaExhaustedError':
            return { name, error: new AiQuotaExhaustedError(message) };
        default:
            return null;
    }
}
