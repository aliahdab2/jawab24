import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PhoneOtpRequest } from '../../src/types';

vi.mock('../../src/db', () => ({ db: {} }));
vi.mock('../../src/db/schema', () => ({ users: {}, ecommerceStores: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }));

vi.mock('../../src/services/otp', () => ({
    otpService: {
        // Production returns false today (D-123). The default here is TRUE so the
        // happy-path and rate-limit cases still reach `sendOtp`; the no-transport
        // case flips it, which is the only honest way to test both halves of a
        // gate whose real answer is a constant.
        hasTransport: vi.fn().mockReturnValue(true),
        generateCode: vi.fn().mockReturnValue('123456'),
        storeOtp: vi.fn(),
        sendOtp: vi.fn(),
    },
    OtpRateLimitError: class OtpRateLimitError extends Error {
        constructor() { super('rate limit'); this.name = 'OtpRateLimitError'; }
    },
    OtpTransportUnavailableError: class OtpTransportUnavailableError extends Error {
        constructor(phone: string) {
            super(`No verification transport is configured (cannot deliver a code to ${phone})`);
            this.name = 'OtpTransportUnavailableError';
        }
    },
}));

vi.mock('../../src/config', () => ({
    config: { phoneAuthEnabled: true },
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
import { otpService, OtpTransportUnavailableError } from '../../src/services/otp';

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

    // Backend safety net for the sanctions block (Syria, D-045) — even if the
    // frontend gate is bypassed, the controller must surface a structured code so
    // the client can show the translated "use Facebook login" notice. The check
    // now lives in the controller: it used to surface from inside the SMS
    // provider, which no longer exists (D-123).
    it('returns 400 country_blocked for a sanctioned destination, minting no code', async () => {
        await authController.requestOtp(makeRequest('+963937549674'), mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'country_blocked' }),
        );
        // Refused before anything is generated or stored — a blocked number must
        // not consume the per-phone rate-limit slot either.
        expect(otpService.generateCode).not.toHaveBeenCalled();
        expect(otpService.storeOtp).not.toHaveBeenCalled();
    });

    // The whole point of retiring the rail rather than leaving it inert: a
    // request that cannot be delivered must NOT answer «sent».
    it('returns 503 otp_unavailable when no transport can carry the code, minting nothing', async () => {
        // The production value of `hasTransport()`. Scoped with `Once` on purpose:
        // the suite's beforeEach clears calls but not implementations, so a
        // sticky `false` would silently 503 every later case in this file.
        (otpService.hasTransport as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

        await authController.requestOtp(makeRequest('+966500000000'), mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(503);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'otp_unavailable' }),
        );
        expect(mockReply.send).not.toHaveBeenCalledWith({ message: 'sent' });
        // The gate refuses BEFORE minting: an undeliverable request must not
        // write an `otp_codes` row, and must not burn the rate-limit slot that
        // `storeOtp` consumes.
        expect(otpService.generateCode).not.toHaveBeenCalled();
        expect(otpService.storeOtp).not.toHaveBeenCalled();
    });

    // Belt-and-braces for the same fault: if a transport ever reports itself
    // available and then cannot deliver, the answer is still 503 — never «sent»,
    // and never a 500 that reads as our bug.
    it('returns 503 otp_unavailable when sendOtp throws despite an available transport', async () => {
        (otpService.sendOtp as ReturnType<typeof vi.fn>).mockRejectedValue(
            new OtpTransportUnavailableError('+966500000000'),
        );

        await authController.requestOtp(makeRequest('+966500000000'), mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(503);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'otp_unavailable' }),
        );
    });

    it('returns 200 sent when a transport does deliver', async () => {
        (otpService.sendOtp as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        await authController.requestOtp(makeRequest('+966500000000'), mockReply as FastifyReply);

        expect(mockReply.send).toHaveBeenCalledWith({ message: 'sent' });
        expect(mockReply.status).not.toHaveBeenCalled();
    });

    it('returns 400 invalid_phone for malformed input without minting a code', async () => {
        await authController.requestOtp(makeRequest('not-a-phone'), mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'invalid_phone' }),
        );
        expect(otpService.sendOtp).not.toHaveBeenCalled();
    });
});
