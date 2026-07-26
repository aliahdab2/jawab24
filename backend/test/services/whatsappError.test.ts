import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config', () => ({
    config: { facebook: { graphApiVersion: 'v23.0', appId: 'app-1', appSecret: 'SUPER_SECRET' } },
}));

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import axios from 'axios';
import { whatsappService, WhatsAppApiError } from '../../src/services/whatsapp';

/**
 * Regression for the HIGH secret-leak finding: whatsappService must never let a
 * raw AxiosError (which carries config.params.client_secret and the
 * Authorization bearer header) escape — it throws a secret-free
 * WhatsAppApiError instead.
 */
describe('WhatsAppService error sanitization', () => {
    beforeEach(() => vi.clearAllMocks());

    // A realistic axios error: secrets live on `config`, request `headers`.
    const axiosErrorWithSecrets = {
        message: 'Request failed with status code 400',
        config: {
            params: { client_id: 'app-1', client_secret: 'SUPER_SECRET', code: 'abc' },
            headers: { Authorization: 'Bearer WABA_TOKEN_123' },
        },
        response: { data: { error: { code: 133005, message: 'PIN mismatch' } } },
    };

    it('exchangeCodeForToken throws a WhatsAppApiError with no config/headers/secret', async () => {
        vi.mocked(axios.get).mockRejectedValue(axiosErrorWithSecrets);

        const err = await whatsappService.exchangeCodeForToken('bad-code').catch(e => e);

        expect(err).toBeInstanceOf(WhatsAppApiError);
        // Secret-bearing fields must be absent
        expect(err).not.toHaveProperty('config');
        expect(err).not.toHaveProperty('response');
        expect(err.metaCode).toBe(133005);
        // Nothing recoverable from the error can contain the secret or token
        const serialized = JSON.stringify({ message: err.message, metaCode: err.metaCode, name: err.name });
        expect(serialized).not.toContain('SUPER_SECRET');
        expect(serialized).not.toContain('WABA_TOKEN_123');
    });

    it('registerPhoneNumber surfaces the Meta code for PIN-mismatch handling', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce(axiosErrorWithSecrets);
        try {
            await whatsappService.registerPhoneNumber('phone-1', 'tok');
        } catch (e) {
            expect((e as WhatsAppApiError).metaCode).toBe(133005);
            expect(e).not.toHaveProperty('config');
        }
    });

    it('sendTextMessage sanitizes send failures too (manual-reply path)', async () => {
        vi.mocked(axios.post).mockRejectedValueOnce({
            ...axiosErrorWithSecrets,
            response: { data: { error: { code: 131047, message: 'Re-engagement' } } },
        });
        try {
            await whatsappService.sendTextMessage('phone-1', '+966500000000', 'hi', 'tok');
        } catch (e) {
            expect((e as WhatsAppApiError).metaCode).toBe(131047);
            expect(e).not.toHaveProperty('config');
        }
    });

    // Regression: transient send failures must be retry-worthy so a Meta blip
    // doesn't burn the reply AND spuriously trip the page auto-pause counter.
    it.each([
        ['5xx server error', { response: { status: 503, data: {} }, message: 'boom' }, true],
        ['429 rate limit', { response: { status: 429, data: {} }, message: 'slow down' }, true],
        ['network error (no response)', { code: 'ECONNRESET', message: 'socket hang up' }, true],
        ['4xx business error (24h window)', { response: { status: 400, data: { error: { code: 131047, message: 'window' } } } }, false],
        ['401 bad token', { response: { status: 401, data: { error: { code: 190, message: 'expired' } } } }, false],
    ])('sendTextMessage marks %s transient=%s', async (_label, axiosErr, expectedTransient) => {
        vi.mocked(axios.post).mockRejectedValueOnce(axiosErr);
        const err = await whatsappService
            .sendTextMessage('phone-1', '+966500000000', 'hi', 'tok')
            .catch(e => e as WhatsAppApiError);
        expect(err).toBeInstanceOf(WhatsAppApiError);
        expect(err.transient).toBe(expectedTransient);
    });
});

/**
 * Meta FORCES a 60-day expiry on the WhatsApp Embedded Signup login variation, so
 * the expiry deadline has to be captured at exchange time — it is the only moment
 * Meta tells us. Discarding it (the original behaviour) left us unable to warn a
 * merchant before their number went silent.
 */
describe('WhatsAppService token expiry capture', () => {
    beforeEach(() => vi.clearAllMocks());

    it('exchangeCodeForToken returns expires_in alongside the token', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: { access_token: 'wa-tok', expires_in: 5_184_000 }, // 60 days
        });
        await expect(whatsappService.exchangeCodeForToken('code')).resolves.toEqual({
            token: 'wa-tok',
            expiresIn: 5_184_000,
        });
    });

    it.each([
        ['absent', undefined],
        ['zero', 0],
        ['non-numeric', 'soon'],
    ])('exchangeCodeForToken reports NO expiry when expires_in is %s', async (_label, expiresIn) => {
        // A missing/zero expires_in must become undefined so the caller stores NULL
        // rather than inventing a deadline — a fabricated date would disconnect a
        // perfectly healthy never-expiring token.
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { access_token: 'wa-tok', expires_in: expiresIn } });
        const result = await whatsappService.exchangeCodeForToken('code');
        expect(result.token).toBe('wa-tok');
        expect(result.expiresIn).toBeUndefined();
    });
});

describe('WhatsAppService.debugToken', () => {
    beforeEach(() => vi.clearAllMocks());

    it('authenticates with the APP access token, never the token under test', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { data: { is_valid: true } } });
        await whatsappService.debugToken('token-under-test');

        const params = vi.mocked(axios.get).mock.calls[0][1]?.params as Record<string, string>;
        expect(params.input_token).toBe('token-under-test');
        // An app access token cannot itself expire, so the health checker can never
        // go stale — and it still reports is_valid:false for an already-dead token.
        expect(params.access_token).toBe('app-1|SUPER_SECRET');
    });

    it('maps expires_at = 0 to NO expiry rather than 1970', async () => {
        // Meta's documented sentinel for a non-expiring token. new Date(0) would read
        // as "expired 56 years ago" and make the sweep disconnect every healthy token.
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: { data: { is_valid: true, expires_at: 0, data_access_expires_at: 0 } },
        });
        const info = await whatsappService.debugToken('tok');
        expect(info.isValid).toBe(true);
        expect(info.expiresAt).toBeUndefined();
        expect(info.dataAccessExpiresAt).toBeUndefined();
    });

    it('converts unix seconds to Date and extracts the covered WABA ids', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: {
                data: {
                    is_valid: true,
                    expires_at: 1_790_000_000,
                    data_access_expires_at: 1_795_000_000,
                    scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
                    granular_scopes: [
                        { scope: 'whatsapp_business_management', target_ids: ['waba-1', 'waba-2'] },
                        { scope: 'whatsapp_business_messaging', target_ids: ['waba-1'] },
                    ],
                },
            },
        });
        const info = await whatsappService.debugToken('tok');
        expect(info.expiresAt?.getTime()).toBe(1_790_000_000 * 1000);
        expect(info.dataAccessExpiresAt?.getTime()).toBe(1_795_000_000 * 1000);
        // A shrinking list is how a PARTIAL revocation shows up — is_valid alone misses it.
        expect(info.wabaIds).toEqual(['waba-1', 'waba-2']);
        expect(info.scopes).toContain('whatsapp_business_messaging');
    });

    it('reports an invalid token with Meta\'s reason', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: { data: { is_valid: false, error: { message: 'Session has expired' } } },
        });
        const info = await whatsappService.debugToken('tok');
        expect(info.isValid).toBe(false);
        expect(info.errorMessage).toBe('Session has expired');
    });

    it('sanitizes failures — the app secret must not escape via the error', async () => {
        vi.mocked(axios.get).mockRejectedValueOnce(axiosErrorWithSecretsForDebug);
        const err = await whatsappService.debugToken('tok').catch(e => e);
        expect(err).toBeInstanceOf(WhatsAppApiError);
        expect(err).not.toHaveProperty('config');
        expect(JSON.stringify({ m: err.message, c: err.metaCode })).not.toContain('SUPER_SECRET');
    });
});

const axiosErrorWithSecretsForDebug = {
    message: 'Request failed with status code 400',
    config: { params: { access_token: 'app-1|SUPER_SECRET', input_token: 'tok' } },
    response: { status: 400, data: { error: { code: 190, message: 'expired' } } },
};
