/**
 * Unit tests for the shared timeout-detection helper.
 *
 * These pin the CONTRACT that the original bug violated: detection must depend
 * only on our own AbortSignal, never on the error's name/class. A regression
 * here would silently re-book every OpenAI timeout as OpenAIApiError.
 */
import { describe, it, expect } from 'vitest';
import { isTimeoutAbort, classifyTimeoutAbort } from '../src/lib/aiTimeout';

describe('isTimeoutAbort', () => {
    it('is false while the request is in flight', () => {
        expect(isTimeoutAbort(new AbortController().signal)).toBe(false);
    });

    it('is true once our controller aborts', () => {
        const c = new AbortController();
        c.abort();
        expect(isTimeoutAbort(c.signal)).toBe(true);
    });
});

describe('classifyTimeoutAbort', () => {
    it('classifies an aborted call as AiTimeoutError regardless of the error shape', () => {
        const c = new AbortController();
        c.abort();
        const classify = classifyTimeoutAbort(c.signal);
        // The SDK's real shape: a plain Error whose name is "Error", NOT
        // "APIUserAbortError". The old name-sniffing check missed exactly this.
        expect(classify(new Error('Request was aborted.'))).toBe('AiTimeoutError');
        // Shape genuinely does not matter — only the signal does.
        expect(classify('not even an error')).toBe('AiTimeoutError');
    });

    it('does NOT claim a timeout when the signal never aborted', () => {
        const classify = classifyTimeoutAbort(new AbortController().signal);
        expect(classify(new Error('500 Internal Server Error'))).toBe('OpenAIApiError');
        // Even an error that *looks* like an abort must not be relabelled —
        // only our own signal decides.
        expect(classify(Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' })))
            .toBe('OpenAIApiError');
    });

    it('delegates non-timeout errors to the caller-supplied classifier', () => {
        const classify = classifyTimeoutAbort(
            new AbortController().signal,
            (e) => ((e as Error).message.includes('quota') ? 'AiQuotaError' : 'OpenAIApiError'),
        );
        expect(classify(new Error('insufficient quota'))).toBe('AiQuotaError');
        expect(classify(new Error('boom'))).toBe('OpenAIApiError');
    });

    it('timeout wins over the fallback classifier once aborted', () => {
        const c = new AbortController();
        c.abort();
        const classify = classifyTimeoutAbort(c.signal, () => 'AiQuotaError');
        expect(classify(new Error('insufficient quota'))).toBe('AiTimeoutError');
    });
});
