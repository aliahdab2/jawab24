import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// ─── Mocks ─────────────────────────────────────────────────────
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
vi.mock('../../src/services/settings', () => ({
    settingsService: { getSettings: vi.fn().mockResolvedValue({}) },
}));
vi.mock('../../src/integrations', () => ({ integrationRegistry: {} }));
vi.mock('../../src/services/auditLog', () => ({ auditLog: { log: vi.fn() } }));
vi.mock('../../src/services/sms', () => ({ smsService: { send: vi.fn() } }));

vi.mock('../../src/services/auth', () => ({
    authService: {
        findOrCreateUser: vi.fn().mockResolvedValue({
            id: 'user-1', facebookId: 'fb-123', name: 'Test User', email: 'test@test.com',
            phone: null, picture: null, isAdmin: false,
        }),
        generateToken: vi.fn().mockReturnValue('mock-jwt'),
    },
    ACCESS_TOKEN_EXPIRY: 900,
    MOBILE_DEEP_LINK_TOKEN_EXPIRY: 7 * 24 * 60 * 60 * 1000,
}));

vi.mock('../../src/services/facebook', () => ({
    facebookService: {
        getAccessToken: vi.fn().mockResolvedValue('short-lived-token'),
        getLongLivedToken: vi.fn().mockResolvedValue({ token: 'long-lived-token', expiresAt: new Date('2026-12-31') }),
        getUserProfile: vi.fn().mockResolvedValue({ id: 'fb-123', name: 'Test User', email: 'test@test.com', picture: null }),
    },
}));

vi.mock('../../src/services/pages', () => ({
    pagesService: { syncFromFacebook: vi.fn().mockResolvedValue(undefined) },
}));

// The deep-link user payload carries partner status for the nav entry.
vi.mock('../../src/services/partnerAccess', () => ({
    isPartnerUser: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../src/services/workspace', () => ({
    workspaceService: {
        getUserWorkspaces: vi.fn().mockResolvedValue([{ id: 'ws-1', role: 'owner' }]),
        resolveDefaultWorkspaceId: vi.fn().mockResolvedValue('ws-1'),
    },
}));

import { AuthController } from '../../src/controllers/auth';
import { facebookService } from '../../src/services/facebook';

// ─── Tests ─────────────────────────────────────────────────────

describe('AuthController - mobileFacebookCallback', () => {
    let controller: AuthController;
    let mockReply: Partial<FastifyReply>;
    let redirectedUrl: string;

    const makeRequest = (query: Record<string, string> = {}) =>
        ({
            query: { code: 'valid-code', state: encodeURIComponent('/dashboard|mobile|ar'), ...query },
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
        } as unknown as FastifyRequest<{ Querystring: { code?: string; error?: string; state?: string } }>);

    beforeEach(() => {
        vi.clearAllMocks();
        redirectedUrl = '';
        controller = new AuthController();
        mockReply = {
            redirect: vi.fn((url: string) => { redirectedUrl = url; return mockReply as FastifyReply; }),
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
    });

    // ─── Issue 1: redirect_uri must match frontend ──────────────

    it('should pass redirect_uri ending with /api/auth/facebook/mobile-callback to Facebook', async () => {
        await controller.mobileFacebookCallback(makeRequest(), mockReply as FastifyReply);

        // The redirect_uri sent to facebookService.getAccessToken must end with
        // /api/auth/facebook/mobile-callback — NOT /auth/facebook/mobile-callback.
        // The frontend sends the user to Facebook with this exact URL, so the backend
        // code exchange must use the identical redirect_uri or Facebook rejects it.
        const calledRedirectUri = vi.mocked(facebookService.getAccessToken).mock.calls[0][1];
        expect(calledRedirectUri).toMatch(/\/api\/auth\/facebook\/mobile-callback$/);
    });

    it('should use BACKEND_PUBLIC_URL env for redirect_uri when set', async () => {
        const original = process.env.BACKEND_PUBLIC_URL;
        process.env.BACKEND_PUBLIC_URL = 'https://jawab24.com/api';

        await controller.mobileFacebookCallback(makeRequest(), mockReply as FastifyReply);

        const calledRedirectUri = vi.mocked(facebookService.getAccessToken).mock.calls[0][1];
        expect(calledRedirectUri).toBe('https://jawab24.com/api/auth/facebook/mobile-callback');

        process.env.BACKEND_PUBLIC_URL = original;
    });

    it('should default redirect_uri to jawab24.com/api when BACKEND_PUBLIC_URL is unset', async () => {
        const original = process.env.BACKEND_PUBLIC_URL;
        delete process.env.BACKEND_PUBLIC_URL;

        await controller.mobileFacebookCallback(makeRequest(), mockReply as FastifyReply);

        const calledRedirectUri = vi.mocked(facebookService.getAccessToken).mock.calls[0][1];
        expect(calledRedirectUri).toBe('https://jawab24.com/api/auth/facebook/mobile-callback');

        process.env.BACKEND_PUBLIC_URL = original;
    });

    // ─── Issue 2: error handling redirects to app, not HTML ─────

    it('should redirect to app error scheme when Facebook returns error param', async () => {
        await controller.mobileFacebookCallback(
            makeRequest({ error: 'access_denied', code: '' }),
            mockReply as FastifyReply,
        );

        expect(redirectedUrl).toContain('com.jawab24.app://auth/error');
        expect(redirectedUrl).toContain('reason=cancelled');
    });

    it('should redirect to app error scheme when code is missing', async () => {
        await controller.mobileFacebookCallback(
            makeRequest({ code: '' }),
            mockReply as FastifyReply,
        );

        expect(redirectedUrl).toContain('com.jawab24.app://auth/error');
    });

    it('should redirect to app error scheme when code exchange fails', async () => {
        vi.mocked(facebookService.getAccessToken).mockRejectedValueOnce(
            new Error('Facebook API error: redirect_uri mismatch'),
        );

        await controller.mobileFacebookCallback(makeRequest(), mockReply as FastifyReply);

        // Must redirect to the native app error handler, NOT return HTML/502
        expect(redirectedUrl).toContain('com.jawab24.app://auth/error');
        expect(mockReply.redirect).toHaveBeenCalledTimes(1);
    });

    // ─── Happy path ─────────────────────────────────────────────

    it('should redirect to app auth sync with token on success', async () => {
        await controller.mobileFacebookCallback(makeRequest(), mockReply as FastifyReply);

        expect(redirectedUrl).toContain('https://jawab24.com/auth/app-sync');
        expect(redirectedUrl).toContain('token=');
        expect(redirectedUrl).toContain('fbToken=');
        expect(redirectedUrl).toContain('user=');
    });

    it('should preserve locale from state in error redirect', async () => {
        await controller.mobileFacebookCallback(
            makeRequest({ error: 'access_denied', code: '', state: encodeURIComponent('/dashboard|mobile|en') }),
            mockReply as FastifyReply,
        );

        expect(redirectedUrl).toContain('locale=en');
    });
});
