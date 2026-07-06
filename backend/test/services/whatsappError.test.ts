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
});
