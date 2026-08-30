/**
 * Run one call under a hard deadline, handing it the AbortSignal it must pass on.
 *
 * The tracked OpenAI wrapper (`services/openaiClient.ts`) does NOT impose a
 * timeout — it only CLASSIFIES a caller-supplied signal, and §13c's "every
 * timeout books as OpenAIApiError" bug shipped twice because call sites
 * hand-rolled the AbortController and forgot the signal or the clear. One helper,
 * so the pinned-model services (grounding verifier, CTA classifier, …) cannot get
 * that part wrong: the signal is always passed, the timer is always cleared, and a
 * fired deadline is booked as `AiTimeoutError`.
 *
 * Dependency-free on purpose: it is imported by modules that must stay loadable
 * without Redis or a database (see contentCtaClassifier).
 */
export async function withAbortTimeout<T>(timeoutMs: number, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await call(controller.signal);
    } finally {
        clearTimeout(timer);
    }
}
