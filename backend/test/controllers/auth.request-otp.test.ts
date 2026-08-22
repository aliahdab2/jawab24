import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PhoneOtpRequest } from '../../src/types';

vi.mock('../../src/db', () => ({ db: {} }));
vi.mock('../../src/db/schema', () => ({ users: {}, ecommerceStores: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }));

vi.mock('../../src/services/sms', () => ({
    smsService: { send: vi.fn() },
    SmsCountryUnsupportedError: class SmsCountryUnsupportedError extends Error {
        constructor(phone: string) {
            super(`SMS delivery not supported for ${phone}`);
            this.name = 'SmsCountryUnsupportedError';
        }
    },
}));

vi.mock('../../src/services/otp', () => ({
    otpService: {
        generateCode: vi.fn().mockReturnValue('123456'),
        storeOtp: vi.fn(),
        sendOtp: vi.fn(),
    },
    OtpRateLimitError: class OtpRateLimitError extends Error {
        constructor() { super('rate limit'); this.name = 'OtpRateLimitError'; }
    },
}));

vi.mock('../../src/config', () => ({
    config: { phoneAuthEnabled: true, vonage: { apiKey: '', apiSecret: '', senderId: '' } },
}));

vi.mock('../../src/services/auth', () => ({ authService: {}, ACCESS_TOKEN_EXPIRY: 900 }));
vi.mock('../../src/services/cookies', () => ({ cookiesService: {} }));
// The controller's replay trigger pulls in services/activation → lib/redis; stub it like the rest.
vi.mock('../../src/services/activation', () => ({ replayPendingActivationEventsToGa4: vi.fn() }));
vi.mock('../../src/services/refreshToken', () => ({ refreshTokenService: {} }));
vi.mock('../../src/services/facebook', () => ({ facebookService: {} }));
vi.mock('../../src/services/pages', () => ({ pagesService: {} }));
vi.mock('../../src/services/settings', () => ({ settingsService: {} }));
vi.mock('../../src/integrations', () => ({ integrationRegistry: {} }));
vi.mock('../../src/services/auditLog', () => ({ auditLog: { log: vi.fn() } }));
vi.mock('../../src/services/workspace', () => ({ workspaceService: {} }));

import { AuthController } from '../../src/controllers/auth';
import { otpService } from '../../src/services/otp';
import { SmsCountryUnsupportedError } from '../../src/services/sms';

describe('AuthController - requestOtp', () => {
    let authController: AuthController;
    let mockReply: Partial<FastifyReply>;

    const makeRequest = (phone: string): FastifyRequest<{ Body: PhoneOtpRequest }> =>
        ({
            body: { phone, locale: 'en' },
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
        } as unknown as FastifyRequest<{ Body: PhoneOtpRequest }>);

    beforeEach(() => {
        vi.clearAllMocks();
        authController = new AuthController();
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
    });

    it('returns 400 country_blocked when smsService throws SmsCountryUnsupportedError', async () => {
        // Backend safety net for the Syria block — even if the frontend gate is bypassed,
        // the controller must surface a structured error code so the client can show the
        // translated "use Facebook login" notice.
        (otpService.sendOtp as ReturnType<typeof vi.fn>).mockRejectedValue(
            new SmsCountryUnsupportedError('+963937549674'),
        );

        await authController.requestOtp(makeRequest('+963937549674'), mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'country_blocked' }),
        );
    });

    it('returns 200 sent when smsService succeeds for a supported country', async () => {
        (otpService.sendOtp as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        await authController.requestOtp(makeRequest('+966500000000'), mockReply as FastifyReply);

        expect(mockReply.send).toHaveBeenCalledWith({ message: 'sent' });
        expect(mockReply.status).not.toHaveBeenCalled();
    });

    it('returns 400 invalid_phone for malformed input without invoking SMS', async () => {
        await authController.requestOtp(makeRequest('not-a-phone'), mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'invalid_phone' }),
        );
        expect(otpService.sendOtp).not.toHaveBeenCalled();
    });
});
