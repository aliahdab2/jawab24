import { describe, it, expect } from 'vitest';
import type { AxiosError } from 'axios';
import { getRetryDelay } from '../../src/lib/fbAxios';

/**
 * Retry classification for the Graph API axios instance. The instance carries a
 * finite request timeout; a timed-out socket surfaces as ECONNABORTED and must
 * be treated as a transient network error (one short retry), not propagated
 * immediately like a 4xx.
 */
describe('fbAxios getRetryDelay', () => {
    const err = (partial: Partial<AxiosError>): AxiosError => partial as AxiosError;

    it('retries a request timeout (ECONNABORTED)', () => {
        expect(getRetryDelay(err({ code: 'ECONNABORTED' }))).toBeGreaterThan(0);
    });

    it('retries other transient network errors', () => {
        for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND']) {
            expect(getRetryDelay(err({ code }))).toBeGreaterThan(0);
        }
    });

    it('retries 429 and 5xx responses', () => {
        expect(getRetryDelay(err({ response: { status: 429, headers: {}, data: {} } as never }))).toBeGreaterThan(0);
        expect(getRetryDelay(err({ response: { status: 503, headers: {}, data: {} } as never }))).toBeGreaterThan(0);
    });

    it('does not retry a 4xx client error', () => {
        expect(getRetryDelay(err({ response: { status: 400, headers: {}, data: {} } as never }))).toBe(0);
    });
});
