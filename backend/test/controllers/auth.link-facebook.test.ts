import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from '../../src/middleware/auth';

vi.mock('../../src/db', () => ({
    db: { update: vi.fn(), select: vi.fn() },
}));
vi.mock('../../src/db/schema', () => ({
    users: {}, ecommerceStores: {}, subscriptions: {},
}));
vi.mock('drizzle-orm', () => ({
    eq: vi.fn((f, v) => ({ f, v })),
    and: vi.fn((...args) => ({ args })),
    sql: vi.fn(),
}));
vi.mock('../../src/config', () => ({
    config: { phoneAuthEnabled: false, vonage: { apiKey: '', apiSecret: '', senderId: '' } },
}));
vi.mock('../../src/services/otp', () => ({
    otpService: { verifyOtp: vi.fn(), generateCode: vi.fn(), storeOtp: vi.fn(), sendOtp: vi.fn() },
    OtpRateLimitError: class OtpRateLimitError extends Error {
        constructor() { super('rate limit'); this.name = 'OtpRateLimitError'; }
    },
}));
vi.mock('../../src/services/cookies', () => ({ cookiesService: { setAuthCookies: vi.fn() } }));
vi.mock('../../src/services/refreshToken', () => ({ refreshTokenService: {} }));
vi.mock('../../src/services/settings', () => ({ settingsService: {} }));
vi.mock('../../src/integrations', () => ({ integrationRegistry: {} }));
vi.mock('../../src/services/auditLog', () => ({ auditLog: { log: vi.fn() } }));
vi.mock('../../src/services/sms', () => ({ smsService: { send: vi.fn() } }));

vi.mock('../../src/services/auth', () => ({
    authService: {
        linkFacebookToUser: vi.fn().mockResolvedValue(undefined),
        getUserById: vi.fn().mockResolvedValue({
            id: 'user-1', facebookId: 'fb-123', name: 'Test', email: null,
            phone: '+966500000000', phoneVerified: true, picture: null,
            facebookAccessToken: null, facebookTokenExpiresAt: null,
            hasInstagramPermission: false, isAdmin: false, createdAt: new Date(), updatedAt: new Date(),
        }),
        generateToken: vi.fn().mockReturnValue('new-jwt'),
        createAuthResponse: vi.fn().mockReturnValue({ token: 'new-jwt', user: { id: 'user-1' } }),
    },
    ACCESS_TOKEN_EXPIRY: 900,
}));

vi.mock('../../src/services/facebook', () => ({
    facebookService: {
        getAccessToken: vi.fn().mockResolvedValue('short-lived'),
        getLongLivedToken: vi.fn().mockResolvedValue({ token: 'long-lived', expiresAt: new Date('2026-12-31') }),
        getUserProfile: vi.fn().mockResolvedValue({ id: 'fb-123', picture: 'https://pic.example.com' }),
    },
}));

vi.mock('../../src/services/pages', () => ({
    pagesService: { syncFromFacebook: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/services/workspace', () => ({
    workspaceService: { getUserWorkspaces: vi.fn().mockResolvedValue([{ id: 'ws-1' }]) },
}));

import { AuthController } from '../../src/controllers/auth';
import { authService } from '../../src/services/auth';
import { facebookService } from '../../src/services/facebook';
import { pagesService } from '../../src/services/pages';
import { workspaceService } from '../../src/services/workspace';

describe('AuthController - linkFacebook', () => {
    let authController: AuthController;
    let mockReply: Partial<FastifyReply>;

    const makeRequest = (overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest =>
        ({
            user: { userId: 'user-1', isAdmin: false },
            body: { code: 'fb-code-abc', redirectUri: 'https://jawab24.com/ar/auth/callback' },
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
            ...overrides,
        } as unknown as AuthenticatedRequest);

    beforeEach(() => {
        vi.clearAllMocks();
        authController = new AuthController();
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
            setCookie: vi.fn().mockReturnThis(),
        };
        // Restore defaults after clearAllMocks
        vi.mocked(facebookService.getAccessToken).mockResolvedValue('short-lived');
        vi.mocked(facebookService.getLongLivedToken).mockResolvedValue({ token: 'long-lived', expiresAt: new Date('2026-12-31') });
        vi.mocked(facebookService.getUserProfile).mockResolvedValue({ id: 'fb-123', picture: 'https://pic.example.com' });
        vi.mocked(workspaceService.getUserWorkspaces).mockResolvedValue([{ id: 'ws-1' }] as any);
        vi.mocked(pagesService.syncFromFacebook).mockResolvedValue(undefined);
        vi.mocked(authService.linkFacebookToUser).mockResolvedValue(undefined);
        vi.mocked(authService.getUserById).mockResolvedValue({
            id: 'user-1', facebookId: 'fb-123', name: 'Test', email: null,
            phone: '+966500000000', phoneVerified: true, picture: null,
            facebookAccessToken: null, facebookTokenExpiresAt: null,
            hasInstagramPermission: false, isAdmin: false, createdAt: new Date(), updatedAt: new Date(),
        } as any);
        vi.mocked(authService.generateToken).mockReturnValue('new-jwt');
        vi.mocked(authService.createAuthResponse).mockReturnValue({ token: 'new-jwt', user: { id: 'user-1' } } as any);
    });

    it('returns 401 when user is not authenticated', async () => {
        const req = makeRequest({ user: undefined });

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(401);
        expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('returns 400 when code is missing', async () => {
        const req = makeRequest({ body: { redirectUri: 'https://example.com' } });

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).toHaveBeenCalledWith({ error: 'code is required' });
    });

    it('uses authService.linkFacebookToUser (not direct db.update)', async () => {
        const req = makeRequest();

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(authService.linkFacebookToUser).toHaveBeenCalledWith(
            'user-1', 'fb-123', 'long-lived', new Date('2026-12-31'), 'https://pic.example.com'
        );
    });

    it('syncs pages after linking', async () => {
        const req = makeRequest();

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(pagesService.syncFromFacebook).toHaveBeenCalledWith(
            'ws-1',
            'user-1',
            'long-lived',
            undefined,
            expect.objectContaining({ info: expect.any(Function) }),
        );
    });

    it('returns auth response on success', async () => {
        const req = makeRequest();

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ token: 'new-jwt' })
        );
    });

    it('skips page sync when user has no workspace', async () => {
        vi.mocked(workspaceService.getUserWorkspaces).mockResolvedValueOnce([]);
        const req = makeRequest();

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(pagesService.syncFromFacebook).not.toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ token: 'new-jwt' })
        );
    });

    it('continues (non-fatal) when page sync fails', async () => {
        vi.mocked(pagesService.syncFromFacebook).mockRejectedValueOnce(new Error('sync failed'));
        const req = makeRequest();

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ token: 'new-jwt' })
        );
    });

    it('falls back to short-lived token when long-lived exchange fails', async () => {
        vi.mocked(facebookService.getLongLivedToken).mockRejectedValueOnce(new Error('exchange failed'));
        const req = makeRequest();

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(authService.linkFacebookToUser).toHaveBeenCalledWith(
            'user-1', 'fb-123', 'short-lived', undefined, 'https://pic.example.com'
        );
    });

    it('returns 500 when Facebook token exchange fails', async () => {
        vi.mocked(facebookService.getAccessToken).mockRejectedValueOnce(new Error('Facebook API error'));
        const req = makeRequest();

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(500);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'server_error' })
        );
    });
});
