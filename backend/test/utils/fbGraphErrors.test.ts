import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { classifyDmError, DmSendError } from '../../src/utils/fbGraphErrors';

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

    it('classifies 10/2018278 as window_expired', () => {
        const err = new DmSendError('window', { code: 10, subcode: 2018278 });
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
