import { describe, it, expect, vi } from 'vitest';
import type { AxiosAdapter, AxiosError } from 'axios';
import { fbAxios, getRetryDelay } from '../../src/lib/fbAxios';

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

/**
 * The retry INTERCEPTOR, not just its classifier. A retry is free for a read
 * and ruinous for a page publish: a lost response is indistinguishable from a
 * failed call, so retrying can put a second public, permanent post on a
 * merchant's page. `_noRetry` is what non-idempotent writes set.
 */
describe('fbAxios retry interceptor — the _noRetry escape hatch', () => {
    /** Always-transient failure: 503 is retried, so any retry shows up in the count. */
    const failingAdapter = (): AxiosAdapter => vi.fn(async (config) => {
        const error = new Error('boom') as AxiosError;
        error.config = config as never;
        error.response = { status: 503, headers: {}, data: {}, statusText: '', config } as never;
        error.isAxiosError = true;
        throw error;
    });

    it('retries a transient failure by default (MAX_RETRIES = 2 → 3 attempts)', async () => {
        const adapter = failingAdapter();
        await expect(
            fbAxios.post('https://graph.facebook.com/v21.0/1/feed', {}, { adapter }),
        ).rejects.toThrow();
        expect(adapter).toHaveBeenCalledTimes(3);
    }, 15_000);

    it('makes EXACTLY ONE attempt when _noRetry is set — a publish is never re-sent', async () => {
        const adapter = failingAdapter();
        await expect(
            fbAxios.post('https://graph.facebook.com/v21.0/1/photos', {}, { adapter, _noRetry: true }),
        ).rejects.toThrow();
        expect(adapter).toHaveBeenCalledTimes(1);
    });
});
