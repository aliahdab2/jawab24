import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from '../../src/middleware/auth';

vi.mock('../../src/db', () => ({
    db: {
        update: vi.fn(),
        select: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    users: { id: 'id', phone: 'phone', phoneVerified: 'phone_verified', updatedAt: 'updated_at' },
    ecommerceStores: {},
    subscriptions: {},
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...args) => ({ args, op: 'and' })),
    sql: vi.fn(),
}));

vi.mock('../../src/services/otp', () => ({
    otpService: {
        verifyOtp: vi.fn(),
        generateCode: vi.fn(),
        storeOtp: vi.fn(),
        sendOtp: vi.fn(),
    },
    OtpRateLimitError: class OtpRateLimitError extends Error {
        constructor() {
            super('OTP rate limit');
            this.name = 'OtpRateLimitError';
        }
    },
}));

vi.mock('../../src/config', () => ({
    config: { phoneAuthEnabled: true },
}));

// Stub all other heavy deps so AuthController imports cleanly.
// getUserById feeds the demo-session guard — return a real (non-demo) user so
// existing linkPhone tests exercise the post-guard flow.
vi.mock('../../src/services/auth', () => ({
    authService: {
        getUserById: vi.fn().mockResolvedValue({ id: 'user-1', facebookId: '1234567890' }),
    },
    ACCESS_TOKEN_EXPIRY: 900,
}));
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
import { db } from '../../src/db';
import { otpService } from '../../src/services/otp';

describe('AuthController - linkPhone', () => {
    let authController: AuthController;
    let mockReply: Partial<FastifyReply>;
    let mockRequest: Partial<AuthenticatedRequest>;

    const makeRequest = (overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest =>
        ({
            user: { userId: 'user-abc', isAdmin: false },
            body: { phone: '+966500000000', code: '123456' },
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
            ...overrides,
        } as unknown as AuthenticatedRequest);

    const mockSelectChain = (rows: { id: string }[]) => {
        const mockLimit = vi.fn().mockResolvedValue(rows);
        const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
        const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
        (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });
    };

    beforeEach(() => {
        vi.clearAllMocks();
        authController = new AuthController();

        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };

        // Default: no existing phone conflict
        mockSelectChain([]);

        // Default: db.update chain
        const mockSet = vi.fn().mockReturnThis();
        const mockWhere = vi.fn().mockResolvedValue([]);
        (db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: mockSet });
        mockSet.mockReturnValue({ where: mockWhere });
    });

    it('returns 401 when user is not authenticated', async () => {
        const req = makeRequest({ user: undefined });

        await authController.linkPhone(req, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(401);
        expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('returns 400 for invalid phone format', async () => {
        const req = makeRequest({ body: { phone: 'not-a-phone', code: '123456' } });

        await authController.linkPhone(req, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'invalid_phone' })
        );
    });

    it('returns 400 when code is missing', async () => {
        const req = makeRequest({ body: { phone: '+966500000000' } });

        await authController.linkPhone(req, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'invalid_request' })
        );
    });

    it('returns 400 when code is wrong length', async () => {
        const req = makeRequest({ body: { phone: '+966500000000', code: '12345' } });

        await authController.linkPhone(req, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when OTP is expired', async () => {
        vi.mocked(otpService.verifyOtp).mockResolvedValue('expired');
        const req = makeRequest();

        await authController.linkPhone(req, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'code_expired' })
        );
    });

    it('returns 429 when max attempts exceeded', async () => {
        vi.mocked(otpService.verifyOtp).mockResolvedValue('exceeded');
        const req = makeRequest();

        await authController.linkPhone(req, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(429);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'too_many_attempts' })
        );
    });

    it('returns 400 when code is invalid', async () => {
        vi.mocked(otpService.verifyOtp).mockResolvedValue('invalid');
        const req = makeRequest();

        await authController.linkPhone(req, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'invalid_code' })
        );
    });

    it('reassigns phone and returns success when phone is linked to a different account (OTP proves ownership)', async () => {
        vi.mocked(otpService.verifyOtp).mockResolvedValue('valid');
        mockSelectChain([{ id: 'other-user-xyz' }]); // different user currently holds this phone
        const req = makeRequest();

        await authController.linkPhone(req, mockReply as FastifyReply);

        // db.update called twice: once to clear old holder, once to set on current user
        expect(db.update).toHaveBeenCalledTimes(2);
        expect(mockReply.send).toHaveBeenCalledWith({ success: true });
    });

    it('updates phone and returns success when phone is already linked to the same user', async () => {
        vi.mocked(otpService.verifyOtp).mockResolvedValue('valid');
        mockSelectChain([{ id: 'user-abc' }]); // same user re-verifying their own phone
        const req = makeRequest();

        await authController.linkPhone(req, mockReply as FastifyReply);

        expect(db.update).toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith({ success: true });
    });

    it('updates phone and returns success on valid OTP', async () => {
        vi.mocked(otpService.verifyOtp).mockResolvedValue('valid');
        const req = makeRequest();

        await authController.linkPhone(req, mockReply as FastifyReply);

        expect(db.update).toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith({ success: true });
    });

    it('returns 500 on unexpected error', async () => {
        vi.mocked(otpService.verifyOtp).mockRejectedValue(new Error('DB failure'));
        const req = makeRequest();

        await authController.linkPhone(req, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(500);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'server_error' })
        );
    });
});
