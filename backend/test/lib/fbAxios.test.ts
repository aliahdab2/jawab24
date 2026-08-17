/**
 * Retry classification and replay safety for the Graph API axios instance.
 *
 * The instance carries a finite request timeout; a timed-out socket surfaces as
 * ECONNABORTED and is a transient failure worth retrying — but only on a request where a
 * replay is SAFE.
 *
 * The regression this file grew for: on 2026-08-17 a merchant's Facebook post carried two
 * byte-identical "We sent you a private message 💬" replies under one customer comment.
 * The interceptor had replayed `POST /{comment-id}/comments` after an ambiguous failure —
 * a write Meta applies no duplicate protection to. The safety property now under test is
 * RFC 9110 §9.2.2: replay automatically only when the failure PROVES the request never
 * took effect, or when the method is idempotent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import {
    fbAxios,
    classifyRetry,
    replayIsSafe,
    setGraphRetryObserver,
    type GraphRetryEvent,
} from '../../src/lib/fbAxios';

const URL = 'https://graph.facebook.com/v23.0/123_456/comments';

/**
 * The failure shape a test wants to simulate. `response` is loosened to `unknown` so a
 * fixture only carries the fields the classifier reads (status / headers / data), not a
 * fully-typed AxiosResponse with its own nested request config.
 */
type FailureShape = Omit<Partial<AxiosError>, 'response'> & { response?: unknown };

/** Build the AxiosError shape the response interceptor actually receives. */
function axiosErrorFor(config: InternalAxiosRequestConfig, props: FailureShape): AxiosError {
    const err = new Error('graph failure') as AxiosError;
    err.isAxiosError = true;
    err.config = config;
    Object.assign(err, props);
    return err;
}

function responseWith(status: number, headers: Record<string, string> = {}, data: unknown = {}): FailureShape {
    return { response: { status, headers, data, statusText: '', config: {} } };
}

describe('classifyRetry', () => {
    const cfg = { method: 'post', url: URL } as InternalAxiosRequestConfig;

    afterEach(() => vi.useRealTimers());

    it('treats a 429 as proven-unsent and honours Retry-After delta-seconds', () => {
        const d = classifyRetry(axiosErrorFor(cfg, responseWith(429, { 'retry-after': '5' })));
        expect(d).toEqual({ waitMs: 5_000, proven: true, reason: 'http_429' });
    });

    it('parses an HTTP-date Retry-After (RFC 9110 §10.2.3), not just delta-seconds', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-17T10:00:00Z'));
        const d = classifyRetry(axiosErrorFor(cfg, responseWith(429, { 'retry-after': 'Mon, 17 Aug 2026 10:00:30 GMT' })));
        expect(d?.waitMs).toBe(30_000);
        expect(d?.proven).toBe(true);
    });

    it('clamps an oversized Retry-After so a worker slot cannot be pinned for an hour', () => {
        const d = classifyRetry(axiosErrorFor(cfg, responseWith(429, { 'retry-after': '3600' })));
        expect(d?.waitMs).toBe(60_000);
    });

    it('falls back to the default for a malformed numeric Retry-After ("5.5") — never a past-date parse', () => {
        // Without the letter guard, V8's Date.parse reads '5.5' as the DATE 2001-05-05 —
        // a past instant — turning garbage into "retry immediately" instead of the default.
        const d = classifyRetry(axiosErrorFor(cfg, responseWith(429, { 'retry-after': '5.5' })));
        expect(d?.waitMs).toBe(60_000);
    });

    it('returns a ZERO wait — not a null decision — for Retry-After: 0', () => {
        // "retry immediately" and "never retry" are different answers; conflating them
        // would silently drop the retry Meta explicitly asked for.
        const d = classifyRetry(axiosErrorFor(cfg, responseWith(429, { 'retry-after': '0' })));
        expect(d).not.toBeNull();
        expect(d?.waitMs).toBe(0);
    });

    it.each([
        [4, 'fb_app_rate_limit'],
        [32, 'fb_page_rate_limit'],
    ])('treats Facebook rate-limit code %i as proven-unsent', (code, reason) => {
        const d = classifyRetry(axiosErrorFor(cfg, responseWith(400, {}, { error: { code } })));
        expect(d).toMatchObject({ proven: true, reason });
    });

    it.each(['ENOTFOUND', 'ECONNREFUSED'])('treats %s as proven-unsent — the request never reached a handler', (code) => {
        const d = classifyRetry(axiosErrorFor(cfg, { code }));
        expect(d?.proven).toBe(true);
        expect(d?.waitMs).toBeGreaterThan(0);
    });

    it.each(['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'])('treats %s as AMBIGUOUS — the write may have landed', (code) => {
        const d = classifyRetry(axiosErrorFor(cfg, { code }));
        expect(d?.proven).toBe(false);
        // Still retryable — for an idempotent method. See the interceptor suite below.
        expect(d?.waitMs).toBeGreaterThan(0);
    });

    it('treats a 5xx as AMBIGUOUS — an edge can 502 after the origin applied the write', () => {
        const d = classifyRetry(axiosErrorFor(cfg, responseWith(503)));
        expect(d).toMatchObject({ proven: false, reason: 'http_5xx' });
        expect(d?.waitMs).toBeGreaterThan(0);
    });

    it('returns null for an ordinary 4xx client error — nothing to retry', () => {
        expect(classifyRetry(axiosErrorFor(cfg, responseWith(400, {}, { error: { code: 100 } })))).toBeNull();
    });

    it('returns null for a bare Error with no code or response (the unit-test network guard)', () => {
        expect(classifyRetry(axiosErrorFor(cfg, {}))).toBeNull();
    });
});

describe('replayIsSafe — the idempotency gate, pinned directly', () => {
    // The fail-closed branch is unreachable through axios's public API (a missing
    // method defaults to 'get' before the interceptor ever runs), so the property
    // is asserted on the exported function rather than through the instance.
    it('fails CLOSED for a missing or unknown method', () => {
        expect(replayIsSafe(undefined)).toBe(false);
        expect(replayIsSafe('')).toBe(false);
        expect(replayIsSafe('connect')).toBe(false);
    });

    it('treats every RFC 9110 §9.2.2 idempotent method as replay-safe, case-insensitively', () => {
        for (const method of ['get', 'head', 'put', 'delete', 'options', 'trace', 'GET', 'PUT']) {
            expect(replayIsSafe(method)).toBe(true);
        }
    });

    it('treats POST and PATCH as unsafe without the escape hatch', () => {
        expect(replayIsSafe('post')).toBe(false);
        expect(replayIsSafe('patch')).toBe(false);
    });

    it('honours the semanticallyIdempotent declaration only when it is literally true', () => {
        expect(replayIsSafe('post', true)).toBe(true);
        expect(replayIsSafe('post', false)).toBe(false);
        expect(replayIsSafe('post', undefined)).toBe(false);
    });
});

describe('fbAxios interceptor — RFC 9110 §9.2.2 replay safety', () => {
    const originalAdapter = fbAxios.defaults.adapter;
    let events: GraphRetryEvent[] = [];

    /**
     * Replace the instance adapter so no request leaves the process, and count attempts.
     * The response interceptor still runs — which is the thing under test.
     */
    function installFailingAdapter(props: FailureShape): { attempts: () => number } {
        let attempts = 0;
        fbAxios.defaults.adapter = (config) => {
            attempts += 1;
            return Promise.reject(axiosErrorFor(config as InternalAxiosRequestConfig, props));
        };
        return { attempts: () => attempts };
    }

    /** Drive the retry backoff without waiting on real time. */
    async function settle<T>(p: Promise<T>): Promise<unknown> {
        const caught = p.catch((e) => e);
        await vi.advanceTimersByTimeAsync(200_000);
        return caught;
    }

    const AMBIGUOUS_TIMEOUT: FailureShape = { code: 'ECONNABORTED' };
    const PROVEN_RATE_LIMIT = responseWith(429, { 'retry-after': '0' });

    beforeEach(() => {
        events = [];
        setGraphRetryObserver((e) => { events.push(e); });
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        fbAxios.defaults.adapter = originalAdapter;
        setGraphRetryObserver(() => { /* reset */ });
    });

    it('does NOT replay a POST after an ambiguous failure — this is the duplicate-comment bug', async () => {
        const adapter = installFailingAdapter(AMBIGUOUS_TIMEOUT);

        await settle(fbAxios.post(URL, { message: 'We sent you a private message 💬' }));

        expect(adapter.attempts()).toBe(1);
        expect(events).toEqual([
            expect.objectContaining({ outcome: 'retry_suppressed', method: 'post', reason: 'econnaborted', proven: false }),
        ]);
    });

    it('does NOT replay a PATCH after an ambiguous failure either', async () => {
        const adapter = installFailingAdapter({ code: 'ECONNRESET' });

        await settle(fbAxios.patch(URL, {}));

        expect(adapter.attempts()).toBe(1);
    });

    it('does NOT replay a POST after an ambiguous 5xx', async () => {
        const adapter = installFailingAdapter(responseWith(502));

        await settle(fbAxios.post(URL, {}));

        expect(adapter.attempts()).toBe(1);
        expect(events[0]).toMatchObject({ outcome: 'retry_suppressed', reason: 'http_5xx', status: 502 });
    });

    it('DOES replay a GET after an ambiguous failure — idempotent, so a replay is harmless', async () => {
        const adapter = installFailingAdapter(AMBIGUOUS_TIMEOUT);

        await settle(fbAxios.get(URL));

        expect(adapter.attempts()).toBe(3); // original + MAX_RETRIES
    });

    it('DOES replay a DELETE after an ambiguous failure — idempotent per RFC 9110', async () => {
        const adapter = installFailingAdapter({ code: 'ECONNRESET' });

        await settle(fbAxios.delete(URL));

        expect(adapter.attempts()).toBe(3);
    });

    it('DOES replay a PUT after an ambiguous failure — idempotent per RFC 9110', async () => {
        const adapter = installFailingAdapter(AMBIGUOUS_TIMEOUT);

        await settle(fbAxios.put(URL, {}));

        expect(adapter.attempts()).toBe(3);
    });

    it('DOES replay a POST declared semanticallyIdempotent — the RFC escape hatch (subscribed_apps shape)', async () => {
        const adapter = installFailingAdapter(AMBIGUOUS_TIMEOUT);

        await settle(fbAxios.post(URL, null, { semanticallyIdempotent: true }));

        expect(adapter.attempts()).toBe(3);
        expect(events.map(e => e.outcome)).toEqual(['retried', 'retried', 'exhausted']);
    });

    it('DOES replay a POST when the failure PROVES it was never applied (429 rate limit)', async () => {
        const adapter = installFailingAdapter(PROVEN_RATE_LIMIT);

        await settle(fbAxios.post(URL, {}));

        expect(adapter.attempts()).toBe(3);
        expect(events.map(e => e.outcome)).toEqual(['retried', 'retried', 'exhausted']);
    });

    it('DOES replay a POST on a DNS failure — the request never left', async () => {
        const adapter = installFailingAdapter({ code: 'ENOTFOUND' });

        await settle(fbAxios.post(URL, {}));

        expect(adapter.attempts()).toBe(3);
    });

    it('surfaces the original error to the caller when a POST replay is suppressed', async () => {
        installFailingAdapter(AMBIGUOUS_TIMEOUT);

        const err = await settle(fbAxios.post(URL, {})) as AxiosError;

        // The caller must still see the real Graph failure — job-level retry and the
        // send-failure classifiers read `code`/`response` off it.
        expect(err.code).toBe('ECONNABORTED');
    });

    it('does not let a throwing observer change the request outcome', async () => {
        setGraphRetryObserver(() => { throw new Error('observer exploded'); });
        const adapter = installFailingAdapter(AMBIGUOUS_TIMEOUT);

        const err = await settle(fbAxios.post(URL, {})) as AxiosError;

        expect(adapter.attempts()).toBe(1);
        expect(err.code).toBe('ECONNABORTED');
    });
});
