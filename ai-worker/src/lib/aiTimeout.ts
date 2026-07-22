/**
 * Timeout detection for OpenAI SDK calls — one place, one reason.
 *
 * WHY THIS EXISTS (JAWAB24-AI-WORKER-6/9, 2026-07-22): every call site used to
 * decide "was this our timeout?" by sniffing the error's identity:
 *
 *     if (e instanceof Error && e.name === 'APIUserAbortError') …
 *
 * The OpenAI SDK never assigns `name` on its error classes — openai@6.27.0
 * `core/error.js` defines APIUserAbortError → APIError → OpenAIError → Error
 * with no `this.name` anywhere — so `name` inherits "Error" and the branch was
 * DEAD. Every timeout was misreported as `OpenAIApiError`, no `AiTimeoutError`
 * was thrown, and the raw error escaped to Sentry as `Error: Request was
 * aborted.` (that string is the literal Sentry issue title).
 *
 * The fix is to stop reading the error at all. Each call site owns its
 * AbortController and nothing else aborts it, so the signal IS the answer:
 * authoritative, independent of SDK version details, and impossible to silently
 * break on an SDK upgrade.
 *
 * Keep this the ONLY definition. It is used by the default reply path
 * (openai.ts), the provider abstraction (openai-adapter.ts) and both
 * e-commerce tool-loop calls (ecommerceToolHandler.ts); duplicating the
 * predicate is what let the original bug hide in plain sight across files.
 */
import type { FailedBeforeLogClass } from './aiMetrics';

/**
 * True when OUR timeout fired for this call. Pass the signal belonging to the
 * AbortController the call site created — never a signal owned by someone else,
 * or an unrelated cancellation would be reported as a timeout.
 *
 * Known, accepted limitation: if the SDK rejects for an unrelated reason in the
 * same instant the timer fires, the error is labelled a timeout. The window is a
 * single microtask (the timer can only be cleared once the catch runs), both
 * classes are treated as transient downstream, and the previous behaviour got
 * this wrong 100% of the time — so the trade is strictly favourable.
 */
export function isTimeoutAbort(signal: AbortSignal): boolean {
    return signal.aborted;
}

/**
 * Build the `errorClassifier` for `withAiMetrics` so Phase 6.5's
 * `failed_before_log` counter separates timeouts from genuine API errors.
 *
 * Without a classifier `withAiMetrics` defaults to `OpenAIApiError`, which is
 * how the tool-loop call sites reproduced the same blind spot by omission
 * rather than by a broken check.
 *
 * @param signal    the call site's own AbortSignal
 * @param otherwise optional classifier for non-timeout errors (e.g. quota
 *                  detection); defaults to `OpenAIApiError`.
 */
export function classifyTimeoutAbort(
    signal: AbortSignal,
    otherwise?: (err: unknown) => FailedBeforeLogClass,
): (err: unknown) => FailedBeforeLogClass {
    return (err: unknown) => (
        isTimeoutAbort(signal)
            ? 'AiTimeoutError'
            : (otherwise ? otherwise(err) : 'OpenAIApiError')
    );
}
