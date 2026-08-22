/**
 * AuthController.setAnalyticsClientId — the replay trigger.
 *
 * The first-touch write of `users.ga_client_id` is the ONE moment a user's
 * pre-id milestones (`sign_up` above all) can still be attributed, so the
 * controller must fire the replay exactly when that write happened — and never
 * on the repeat POSTs every later session makes, never when the write failed,
 * and never in a way that turns an analytics failure into a non-204.
 *
 * Covers:
 *   - wrote=true  → replay fired once, for this user, 204
 *   - wrote=false → no replay, still 204
 *   - the replay rejecting → still 204 (it is fire-and-forget)
 *   - the first-touch write throwing → no replay, still 204
 *   - the shape gate (a non-client-id) → 400, no write, no replay
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from '../../src/middleware/auth';

vi.mock('../../src/db', () => ({ db: { update: vi.fn(), select: vi.fn() } }));
vi.mock('../../src/db/schema', () => ({ users: {}, ecommerceStores: {}, subscriptions: {} }));
vi.mock('drizzle-orm', () => ({
    eq: vi.fn(),
    and: vi.fn(),
    sql: vi.fn(),
}));
vi.mock('../../src/config', () => ({
    config: { phoneAuthEnabled: true, vonage: { apiKey: '', apiSecret: '', senderId: '' } },
}));

const { storeGaClientIdFirstTouchMock, replayMock, captureErrorMock } = vi.hoisted(() => ({
    storeGaClientIdFirstTouchMock: vi.fn(),
    replayMock: vi.fn(),
    captureErrorMock: vi.fn(),
}));
vi.mock('../../src/services/ga4', () => ({ storeGaClientIdFirstTouch: storeGaClientIdFirstTouchMock }));
vi.mock('../../src/services/activation', () => ({ replayPendingActivationEventsToGa4: replayMock }));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: captureErrorMock }));

// Stub all other heavy deps so AuthController imports cleanly.
vi.mock('../../src/services/otp', () => ({
    otpService: {},
    OtpRateLimitError: class OtpRateLimitError extends Error {},
}));
vi.mock('../../src/services/auth', () => ({ authService: {}, ACCESS_TOKEN_EXPIRY: 900 }));
vi.mock('../../src/services/cookies', () => ({ cookiesService: {} }));
vi.mock('../../src/services/refreshToken', () => ({ refreshTokenService: {} }));
vi.mock('../../src/services/facebook', () => ({ facebookService: {} }));
vi.mock('../../src/services/pages', () => ({ pagesService: {} }));
vi.mock('../../src/services/settings', () => ({ settingsService: {} }));
vi.mock('../../src/integrations', () => ({ integrationRegistry: {} }));
vi.mock('../../src/services/auditLog', () => ({ auditLog: { log: vi.fn() } }));
vi.mock('../../src/services/workspace', () => ({ workspaceService: {} }));
vi.mock('../../src/services/sms', () => ({ smsService: { send: vi.fn() } }));

import { AuthController } from '../../src/controllers/auth';

const CLIENT_ID = '1234567890.1700000000';

describe('AuthController - setAnalyticsClientId', () => {
    let authController: AuthController;
    let mockReply: FastifyReply;

    const makeRequest = (overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest =>
        ({
            user: { userId: 'user-abc', isAdmin: false },
            body: { clientId: CLIENT_ID },
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
            ...overrides,
        } as unknown as AuthenticatedRequest);

    beforeEach(() => {
        vi.clearAllMocks();
        authController = new AuthController();
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        } as unknown as FastifyReply;
        replayMock.mockResolvedValue(undefined);
    });

    it('fires the replay once, for this user, when the first-touch write happened', async () => {
        storeGaClientIdFirstTouchMock.mockResolvedValue(true);

        await authController.setAnalyticsClientId(makeRequest(), mockReply);

        expect(storeGaClientIdFirstTouchMock).toHaveBeenCalledWith('user-abc', CLIENT_ID);
        expect(replayMock).toHaveBeenCalledTimes(1);
        expect(replayMock).toHaveBeenCalledWith('user-abc');
        expect(mockReply.status).toHaveBeenCalledWith(204);
    });

    it('does not replay when the guard held — every later session posts the id again', async () => {
        storeGaClientIdFirstTouchMock.mockResolvedValue(false);

        await authController.setAnalyticsClientId(makeRequest(), mockReply);

        expect(replayMock).not.toHaveBeenCalled();
        expect(mockReply.status).toHaveBeenCalledWith(204);
    });

    it('still answers 204 when the replay rejects — it is fire-and-forget', async () => {
        storeGaClientIdFirstTouchMock.mockResolvedValue(true);
        replayMock.mockRejectedValue(new Error('GA4 exploded'));
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);

        try {
            await authController.setAnalyticsClientId(makeRequest(), mockReply);
            await new Promise(resolve => setImmediate(resolve));

            expect(mockReply.status).toHaveBeenCalledWith(204);
            // The replay contains its own failures in production; the controller
            // may not be the thing standing between a rejection and the process.
            // This pins that the controller does not await-and-throw it.
            expect(mockReply.status).not.toHaveBeenCalledWith(500);
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    it('does not replay when the first-touch write threw, and still answers 204', async () => {
        storeGaClientIdFirstTouchMock.mockRejectedValue(new Error('db down'));

        await authController.setAnalyticsClientId(makeRequest(), mockReply);

        expect(replayMock).not.toHaveBeenCalled();
        expect(captureErrorMock).toHaveBeenCalledTimes(1);
        expect(mockReply.status).toHaveBeenCalledWith(204);
    });

    it('rejects a value that is not a client id before touching anything', async () => {
        await authController.setAnalyticsClientId(
            makeRequest({ body: { clientId: 'GA1.1.1234567890.1700000000' } } as Partial<AuthenticatedRequest>),
            mockReply,
        );

        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(storeGaClientIdFirstTouchMock).not.toHaveBeenCalled();
        expect(replayMock).not.toHaveBeenCalled();
    });
});
