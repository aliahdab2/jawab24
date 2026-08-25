import { describe, it, expect, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import {
    classifyDmError,
    isTransientFbError,
    DmSendError,
    isTransientAiError,
    AiUnavailableError,
    AiToolLoopExhaustedError,
    AiTimeoutError,
    AiRefusalError,
    AiEmptyReplyError,
    AiQuotaExhaustedError,
    needsImmediateAttention,
} from '../../src/utils/fbGraphErrors';

function makeAxiosError(status: number, data: unknown, message = 'axios error'): AxiosError {
    const err = new AxiosError(message, String(status));
    err.response = {
        status,
        statusText: 'Error',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data,
    };
    return err;
}

describe('classifyDmError — DmSendError (structured)', () => {
    it('classifies 10/2534014 as customer_refused on Facebook', () => {
        const err = new DmSendError('blocked', { code: 10, subcode: 2534014 });
        expect(classifyDmError(err, 'facebook').bucket).toBe('customer_refused');
    });

    it('classifies 10/2534014 as customer_refused on Instagram', () => {
        const err = new DmSendError('blocked', { code: 10, subcode: 2534014 });
        expect(classifyDmError(err, 'instagram').bucket).toBe('customer_refused');
    });

    it('classifies 551 as customer_refused on Facebook (no subcode)', () => {
        const err = new DmSendError('not available', { code: 551 });
        expect(classifyDmError(err, 'facebook').bucket).toBe('customer_refused');
    });

    it('classifies 100/2018001 as customer_refused', () => {
        const err = new DmSendError('no user', { code: 100, subcode: 2018001 });
        expect(classifyDmError(err, 'facebook').bucket).toBe('customer_refused');
    });

    it('classifies 100/1893060 as customer_refused on Facebook', () => {
        const err = new DmSendError('no matching user', { code: 100, subcode: 1893060 });
        expect(classifyDmError(err, 'facebook').bucket).toBe('customer_refused');
    });

    it('classifies 100/1893060 as customer_refused on Instagram', () => {
        const err = new DmSendError('no matching user', { code: 100, subcode: 1893060 });
        expect(classifyDmError(err, 'instagram').bucket).toBe('customer_refused');
    });

    it('classifies 10/2018278 as window_expired', () => {
        const err = new DmSendError('window', { code: 10, subcode: 2018278 });
        expect(classifyDmError(err, 'facebook').bucket).toBe('window_expired');
    });

    // Regression: Sentry JAWAB24-BACKEND-1A — IG manual reply outside the 24h window
    // returns 10/2534022 (not 2018278), which fell through to 'unknown' → 502 → Sentry.
    it('classifies 10/2534022 as window_expired on Instagram', () => {
        const err = new DmSendError('(#10) This message is sent outside of allowed window', { code: 10, subcode: 2534022 });
        expect(classifyDmError(err, 'instagram').bucket).toBe('window_expired');
    });

    it('classifies 10/2534022 as window_expired on Facebook', () => {
        const err = new DmSendError('(#10) This message is sent outside of allowed window', { code: 10, subcode: 2534022 });
        expect(classifyDmError(err, 'facebook').bucket).toBe('window_expired');
    });

    it('classifies 613 as transient (rate limit)', () => {
        const err = new DmSendError('rate', { code: 613 });
        expect(classifyDmError(err, 'facebook').bucket).toBe('transient');
    });

    it('classifies 190 as our_fault (token invalid)', () => {
        const err = new DmSendError('bad token', { code: 190 });
        expect(classifyDmError(err, 'facebook').bucket).toBe('our_fault');
    });

    it('classifies 200 as our_fault (permission)', () => {
        const err = new DmSendError('permission', { code: 200 });
        expect(classifyDmError(err, 'facebook').bucket).toBe('our_fault');
    });

    it('classifies 2500 as our_fault (active access token must be used)', () => {
        const err = new DmSendError('An active access token must be used', { code: 2500 });
        expect(classifyDmError(err, 'facebook').bucket).toBe('our_fault');
    });

    it('uses code-only fallback when subcode is absent and exact key misses', () => {
        // 190 has no subcode-specific entry, only code-only. Supply a random subcode.
        const err = new DmSendError('bad token', { code: 190, subcode: 99999 });
        expect(classifyDmError(err, 'facebook').bucket).toBe('our_fault');
    });

    it('returns unknown for unmatched code', () => {
        const err = new DmSendError('huh', { code: 99999 });
        expect(classifyDmError(err, 'facebook').bucket).toBe('unknown');
    });

    it('returns unknown when code is missing', () => {
        const err = new DmSendError('unparseable');
        expect(classifyDmError(err, 'facebook').bucket).toBe('unknown');
    });

    it('marks isTransport=true as transient regardless of code', () => {
        const err = new DmSendError('ECONNRESET', { code: 190, isTransport: true });
        expect(classifyDmError(err, 'facebook').bucket).toBe('transient');
    });

    it('preserves code, subcode, fbMessage in the DmFailure', () => {
        const err = new DmSendError('blocked', { code: 10, subcode: 2534014 });
        const result = classifyDmError(err, 'facebook');
        expect(result).toMatchObject({
            bucket: 'customer_refused',
            code: 10,
            subcode: 2534014,
            fbMessage: 'blocked',
            rawMessage: 'blocked',
        });
    });
});

describe('classifyDmError — AxiosError', () => {
    it('extracts Graph error from response.data.error', () => {
        const err = makeAxiosError(400, {
            error: { code: 10, error_subcode: 2534014, message: 'User restricted' },
        });
        const result = classifyDmError(err, 'facebook');
        expect(result.bucket).toBe('customer_refused');
        expect(result.code).toBe(10);
        expect(result.subcode).toBe(2534014);
        expect(result.fbMessage).toBe('User restricted');
    });

    it('classifies network error (no response) as transient', () => {
        const err = new AxiosError('ECONNRESET', 'ECONNRESET');
        expect(classifyDmError(err, 'facebook').bucket).toBe('transient');
    });

    it('classifies 5xx without Graph payload as transient', () => {
        const err = makeAxiosError(503, undefined);
        expect(classifyDmError(err, 'facebook').bucket).toBe('transient');
    });

    it('classifies 4xx without Graph payload as unknown', () => {
        const err = makeAxiosError(404, undefined);
        expect(classifyDmError(err, 'facebook').bucket).toBe('unknown');
    });

    it('falls back to unknown when Graph error code is missing', () => {
        const err = makeAxiosError(400, { error: { message: 'bad' } });
        expect(classifyDmError(err, 'facebook').bucket).toBe('unknown');
    });

    it('handles non-numeric code gracefully', () => {
        const err = makeAxiosError(400, {
            error: { code: 'not-a-number', message: 'weird' },
        });
        expect(classifyDmError(err, 'facebook').bucket).toBe('unknown');
    });
});

describe('classifyDmError — unknown shapes', () => {
    it('returns unknown for plain Error', () => {
        expect(classifyDmError(new Error('boom'), 'facebook').bucket).toBe('unknown');
    });

    it('returns unknown for string', () => {
        expect(classifyDmError('string error', 'facebook').bucket).toBe('unknown');
    });

    it('returns unknown for null', () => {
        expect(classifyDmError(null, 'facebook').bucket).toBe('unknown');
    });

    it('returns unknown for undefined', () => {
        expect(classifyDmError(undefined, 'facebook').bucket).toBe('unknown');
    });

    it('preserves the raw message from plain Error', () => {
        const result = classifyDmError(new Error('boom'), 'facebook');
        expect(result.rawMessage).toBe('boom');
    });
});

describe('classifyDmError — self-declared transient flag (WhatsAppApiError et al.)', () => {
    // The reply pipeline's transient check is channel-agnostic: a custom error can
    // carry `transient: true` to opt into a BullMQ retry without the FB-centric
    // classifier knowing its type (D-016 — no per-channel branch in the core).
    class CustomError extends Error {
        constructor(msg: string, readonly transient: boolean) { super(msg); }
    }

    it('classifies a transient custom error as transient (would retry)', () => {
        const result = classifyDmError(new CustomError('WhatsApp 503', true), 'facebook');
        expect(result.bucket).toBe('transient');
        expect(result.rawMessage).toBe('WhatsApp 503');
        expect(isTransientFbError(new CustomError('WhatsApp 503', true), 'whatsapp')).toBe(true);
    });

    it('classifies a non-transient custom error as unknown (permanent — no retry)', () => {
        const result = classifyDmError(new CustomError('bad recipient', false), 'facebook');
        expect(result.bucket).toBe('unknown');
        expect(isTransientFbError(new CustomError('bad recipient', false), 'whatsapp')).toBe(false);
    });

    it('does NOT treat a plain Error (no flag) as transient — FB/IG behavior unchanged', () => {
        expect(classifyDmError(new Error('boom'), 'facebook').bucket).toBe('unknown');
        expect(isTransientFbError(new Error('boom'), 'facebook')).toBe(false);
    });
});

describe('DmSendError.fromAxios', () => {
    it('extracts Graph error fields and prefixes the message', () => {
        const axiosErr = makeAxiosError(400, {
            error: { message: 'user blocked', code: 10, error_subcode: 2534014, type: 'OAuthException' },
        });
        const dm = DmSendError.fromAxios(axiosErr, 'Facebook API error');
        expect(dm).toBeInstanceOf(DmSendError);
        expect(dm.message).toBe('Facebook API error: user blocked');
        expect(dm.code).toBe(10);
        expect(dm.subcode).toBe(2534014);
        expect(dm.type).toBe('OAuthException');
        expect(dm.isTransport).toBe(false);
    });

    it('flags 5xx responses as transport (transient)', () => {
        const axiosErr = makeAxiosError(503, { error: { message: 'upstream down', code: 2 } });
        const dm = DmSendError.fromAxios(axiosErr, 'Facebook API error');
        expect(dm.isTransport).toBe(true);
    });

    it('flags network errors (no response) as transport', () => {
        const axiosErr = new AxiosError('ECONNRESET', 'ECONNRESET');
        const dm = DmSendError.fromAxios(axiosErr, 'Facebook API error');
        expect(dm.isTransport).toBe(true);
        expect(dm.message).toBe('Facebook API error: ECONNRESET');
    });

    it('appends verbose detail when requested', () => {
        const axiosErr = makeAxiosError(400, {
            error: { message: 'expired', code: 190, error_subcode: 463, type: 'OAuthException' },
        });
        const dm = DmSendError.fromAxios(axiosErr, 'Facebook API error', { verboseDetail: true });
        expect(dm.message).toBe('Facebook API error: expired (code=190, subcode=463, type=OAuthException)');
    });

    it('falls back to axios message when Graph payload is missing', () => {
        const axiosErr = makeAxiosError(400, { unexpected: true }, 'Request failed');
        const dm = DmSendError.fromAxios(axiosErr, 'Instagram API error');
        expect(dm.message).toBe('Instagram API error: Request failed');
        expect(dm.code).toBeUndefined();
    });

    it('ignores non-numeric Graph code/subcode values', () => {
        const axiosErr = makeAxiosError(400, {
            error: { message: 'weird', code: 'not-a-number', error_subcode: 'also-not' },
        });
        const dm = DmSendError.fromAxios(axiosErr, 'Facebook API error');
        expect(dm.code).toBeUndefined();
        expect(dm.subcode).toBeUndefined();
    });
});

describe('isTransientAiError — retry-worthy classifier for AI-side failures', () => {
    // The deploy-outage bug fix: ai.ts catch + ecommerceToolLoop exhaustion now
    // throw instead of returning a templated reply. The reply pipeline calls this
    // classifier to decide whether to rethrow for BullMQ retry or fall through
    // to success:false. Everything that should retry must classify as true here.

    it('returns true for AiToolLoopExhaustedError (one bad inference run — retry may succeed)', () => {
        expect(isTransientAiError(new AiToolLoopExhaustedError(2))).toBe(true);
    });

    it('returns true for AiUnavailableError so the row reaches needs_attention via retry exhaustion', () => {
        // AI_ENABLED=false is a permanent config decision, but we still classify
        // it as transient so flagStuckJobOnFinalFailure can surface the row.
        // Returning false here would leave messages stuck as success:false with
        // no flag — invisible to the merchant.
        expect(isTransientAiError(new AiUnavailableError())).toBe(true);
    });

    it('returns true for CircuitOpenError (checked by name to avoid circular import)', () => {
        const err = new Error('Circuit breaker is open');
        err.name = 'CircuitOpenError';
        expect(isTransientAiError(err)).toBe(true);
    });

    it('returns true for axios network errors (no response)', () => {
        const err = new AxiosError('connect ECONNREFUSED', 'ECONNREFUSED');
        expect(isTransientAiError(err)).toBe(true);
    });

    it('returns true for axios 5xx responses', () => {
        const err = makeAxiosError(503, { message: 'unavailable' });
        expect(isTransientAiError(err)).toBe(true);
    });

    it('returns false for axios 4xx responses (validation / permanent)', () => {
        const err = makeAxiosError(400, { message: 'bad request' });
        expect(isTransientAiError(err)).toBe(false);
    });

    it.each(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EPIPE'])(
        'returns true for Node socket-level errors (%s)',
        (code) => {
            const err = Object.assign(new Error(`fail ${code}`), { code });
            expect(isTransientAiError(err)).toBe(true);
        },
    );

    it('returns true for AbortError (timed-out fetch)', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        expect(isTransientAiError(err)).toBe(true);
    });

    it('returns FALSE for plain Error messages without structured signals (avoids over-classifying non-AI errors)', () => {
        // Previously a regex matched /timeout|aborted|socket hang up|network/i on
        // err.message — but that caused non-AI errors (e.g. pagesService throwing
        // a plain `new Error('timeout')`) to be misclassified as AI transients
        // and rethrown, breaking unrelated error paths. The classifier now
        // requires a structured signal: code, name, or known error class.
        expect(isTransientAiError(new Error('Request timeout after 30s'))).toBe(false);
        expect(isTransientAiError(new Error('socket hang up'))).toBe(false);
        expect(isTransientAiError(new Error('network connection refused'))).toBe(false);
    });

    it('returns false for plain validation / parse errors (permanent, no retry benefit)', () => {
        expect(isTransientAiError(new SyntaxError('Unexpected token in JSON'))).toBe(false);
        expect(isTransientAiError(new TypeError('invalid argument'))).toBe(false);
        expect(isTransientAiError(new Error('Schema validation failed'))).toBe(false);
    });

    it('returns false for non-Error values (string, undefined, null)', () => {
        expect(isTransientAiError('something broke')).toBe(false);
        expect(isTransientAiError(undefined)).toBe(false);
        expect(isTransientAiError(null)).toBe(false);
        expect(isTransientAiError(42)).toBe(false);
    });

    // PR B additions — typed errors propagated from ai-worker over HTTP.
    // Backend's ai.ts reconstructs these from `error.response.data.error.name`.

    it('returns true for AiTimeoutError (network blip — retry usually succeeds)', () => {
        expect(isTransientAiError(new AiTimeoutError(30000))).toBe(true);
    });

    it('returns false for AiRefusalError (deterministic — same input → same refusal, no retry)', () => {
        expect(isTransientAiError(new AiRefusalError('policy violation: hate speech'))).toBe(false);
    });

    it('returns false for AiEmptyReplyError (bot-words filter is deterministic — same input → same empty)', () => {
        expect(isTransientAiError(new AiEmptyReplyError())).toBe(false);
    });

    it('returns true for AiQuotaExhaustedError (must propagate to the worker to be parked)', () => {
        // Quota is permanent-until-topped-up, but classified transient here so the
        // processor rethrows it up to the worker's catch where park-and-retry lives.
        expect(isTransientAiError(new AiQuotaExhaustedError())).toBe(true);
    });
});

describe('needsImmediateAttention — bypass retry, flag merchant directly', () => {
    // Refusal + empty-after-filter won't fix themselves on retry. Surface to the
    // merchant immediately so they can review KB / brand voice / policy.

    it('returns true for AiRefusalError', () => {
        expect(needsImmediateAttention(new AiRefusalError('policy: violence'))).toBe(true);
    });

    it('returns true for AiEmptyReplyError', () => {
        expect(needsImmediateAttention(new AiEmptyReplyError())).toBe(true);
    });

    it('returns false for AiTimeoutError (retryable, not "needs attention now")', () => {
        expect(needsImmediateAttention(new AiTimeoutError(30000))).toBe(false);
    });

    it('returns false for AiUnavailableError (lets retry exhaustion + flag path handle it)', () => {
        expect(needsImmediateAttention(new AiUnavailableError())).toBe(false);
    });

    it('returns false for AiToolLoopExhaustedError (retryable)', () => {
        expect(needsImmediateAttention(new AiToolLoopExhaustedError(2))).toBe(false);
    });

    it('returns false for plain Error', () => {
        expect(needsImmediateAttention(new Error('something else'))).toBe(false);
    });

    it('returns false for non-Error values', () => {
        expect(needsImmediateAttention(undefined)).toBe(false);
        expect(needsImmediateAttention(null)).toBe(false);
        expect(needsImmediateAttention('refusal')).toBe(false);
    });
});

