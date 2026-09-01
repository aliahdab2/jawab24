import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { ensureMetaWebhookSubscriptions } from '../../src/services/metaWebhooks';
import type { Logger } from '../../src/types';

// Mock axios
vi.mock('axios');

// Mock config
vi.mock('../../src/config', () => ({
    config: {
        facebook: {
            appId: 'test_app_id',
            appSecret: 'test_app_secret',
            graphApiVersion: 'v18.0',
            webhookVerifyToken: 'test_verify_token',
        },
    },
}));

describe('Meta Webhook Subscriptions', () => {
    const CALLBACK_URL = 'https://jawab24.com/webhook';
    const APP_TOKEN = 'test_app_id|test_app_secret';
    const logger: Logger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should subscribe to Page, Instagram, and WhatsApp webhook objects', async () => {
        vi.mocked(axios.post).mockResolvedValue({ data: { success: true } });

        const result = await ensureMetaWebhookSubscriptions(CALLBACK_URL, logger);

        expect(result).toBe(true);
        expect(axios.post).toHaveBeenCalledTimes(3);

        // Page subscription
        expect(axios.post).toHaveBeenCalledWith(
            'https://graph.facebook.com/v18.0/test_app_id/subscriptions',
            null,
            {
                params: {
                    object: 'page',
                    callback_url: CALLBACK_URL,
                    verify_token: 'test_verify_token',
                    fields: 'feed,messages',
                    access_token: APP_TOKEN,
                },
            }
        );

        // Instagram subscription
        expect(axios.post).toHaveBeenCalledWith(
            'https://graph.facebook.com/v18.0/test_app_id/subscriptions',
            null,
            {
                params: {
                    object: 'instagram',
                    callback_url: CALLBACK_URL,
                    verify_token: 'test_verify_token',
                    fields: 'messages,comments',
                    access_token: APP_TOKEN,
                },
            }
        );

        // WhatsApp subscription. The three coexistence fields are required by Meta
        // for WhatsApp-Business-app onboarding to be valid — dropping any of them
        // silently breaks that flow. `account_update` is Meta's only signal that a
        // merchant severed the WABA↔app link (PARTNER_REMOVED) — dropping it means
        // a coexistence unlink goes dark silently (Z net, 27h, 2026-08-31). All are
        // asserted explicitly rather than loosely matched.
        expect(axios.post).toHaveBeenCalledWith(
            'https://graph.facebook.com/v18.0/test_app_id/subscriptions',
            null,
            {
                params: {
                    object: 'whatsapp_business_account',
                    callback_url: CALLBACK_URL,
                    verify_token: 'test_verify_token',
                    fields: 'messages,smb_message_echoes,history,smb_app_state_sync,account_update',
                    access_token: APP_TOKEN,
                },
            }
        );
    });

    it('should return true only when all subscriptions succeed', async () => {
        vi.mocked(axios.post).mockResolvedValue({ data: { success: true } });

        const result = await ensureMetaWebhookSubscriptions(CALLBACK_URL, logger);

        expect(result).toBe(true);
    });

    it('should return false when Page subscription fails', async () => {
        const axiosError = Object.assign(new Error('Forbidden'), {
            isAxiosError: true,
            response: { data: { error: { message: 'Permission denied' } } },
        });
        vi.mocked(axios.isAxiosError).mockReturnValue(true);

        vi.mocked(axios.post)
            .mockRejectedValueOnce(axiosError)
            .mockResolvedValueOnce({ data: { success: true } })
            .mockResolvedValueOnce({ data: { success: true } });

        const result = await ensureMetaWebhookSubscriptions(CALLBACK_URL, logger);

        expect(result).toBe(false);
    });

    it('should return false when Instagram subscription fails', async () => {
        const axiosError = Object.assign(new Error('Forbidden'), {
            isAxiosError: true,
            response: { data: { error: { message: 'instagram_manage_messages not approved' } } },
        });
        vi.mocked(axios.isAxiosError).mockReturnValue(true);

        vi.mocked(axios.post)
            .mockResolvedValueOnce({ data: { success: true } })
            .mockRejectedValueOnce(axiosError)
            .mockResolvedValueOnce({ data: { success: true } });

        const result = await ensureMetaWebhookSubscriptions(CALLBACK_URL, logger);

        expect(result).toBe(false);
    });

    it('should still attempt all subscriptions even when one fails', async () => {
        const axiosError = Object.assign(new Error('Fail'), {
            isAxiosError: true,
            response: { data: { error: { message: 'Error' } } },
        });
        vi.mocked(axios.isAxiosError).mockReturnValue(true);

        vi.mocked(axios.post)
            .mockRejectedValueOnce(axiosError)
            .mockResolvedValueOnce({ data: { success: true } })
            .mockResolvedValueOnce({ data: { success: true } });

        await ensureMetaWebhookSubscriptions(CALLBACK_URL, logger);

        // All 3 calls should have been attempted
        expect(axios.post).toHaveBeenCalledTimes(3);
    });

    it('should log success for each platform', async () => {
        vi.mocked(axios.post).mockResolvedValue({ data: { success: true } });

        await ensureMetaWebhookSubscriptions(CALLBACK_URL, logger);

        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('Facebook Page'),
            expect.any(Object)
        );
        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('Instagram'),
            expect.any(Object)
        );
    });

    it('should log error with platform name on failure', async () => {
        const axiosError = Object.assign(new Error('Fail'), {
            isAxiosError: true,
            response: { data: { error: { message: 'Token invalid' } } },
        });
        vi.mocked(axios.isAxiosError).mockReturnValue(true);
        vi.mocked(axios.post).mockRejectedValue(axiosError);

        await ensureMetaWebhookSubscriptions(CALLBACK_URL, logger);

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('Facebook Page'),
            expect.objectContaining({ error: 'Token invalid' })
        );
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('Instagram'),
            expect.objectContaining({ error: 'Token invalid' })
        );
    });
});
