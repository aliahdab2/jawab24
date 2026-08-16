import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- vi.hoisted mocks for shared state ---
const { mockClaimPendingInstall } = vi.hoisted(() => {
    return {
        mockClaimPendingInstall: vi.fn(),
    };
});

// Mock integrations registry with a Salla integration that delegates to mockClaimPendingInstall
vi.mock('../../src/integrations', () => {
    const mockIntegration = {
        name: 'salla',
        isEnabled: () => true,
        claimPendingInstall: async (request: any, reply: any, userId: string) => {
            if (!request.cookies?.pendingSallaId) return null;
            const result = request.unsignCookie(request.cookies.pendingSallaId);
            if (!result.valid || !result.value) return null;
            try {
                const store = await mockClaimPendingInstall(result.value, userId);
                if (store) {
                    reply.clearCookie('pendingSallaId', { path: '/' });
                    return { sallaOnboarding: true, ecommerceStoreId: store.id };
                }
            } catch (err) {
                request.log.error({ err }, 'Failed to claim pending Salla install');
            }
            return null;
        },
    };
    return {
        integrationRegistry: {
            getEnabled: () => [mockIntegration],
        },
    };
});

// Mock Facebook service
const mockGetAccessToken = vi.fn().mockResolvedValue('fb_access_token');
const mockGetUserProfile = vi.fn().mockResolvedValue({
    id: 'fb_123',
    name: 'Test User',
    email: 'test@example.com',
    picture: 'https://pic.url/avatar.jpg',
});
const mockVerifyAccessToken = vi.fn().mockResolvedValue({
    scopes: ['pages_show_list', 'instagram_basic'],
    granularScopes: [],
});
const mockGetLongLivedToken = vi.fn().mockResolvedValue({
    token: 'long_lived_token',
    expiresAt: new Date(Date.now() + 5184000000),
});

vi.mock('../../src/services/facebook', () => ({
    facebookService: {
        getAccessToken: (...args: any[]) => mockGetAccessToken(...args),
        getUserProfile: (...args: any[]) => mockGetUserProfile(...args),
        verifyAccessToken: (...args: any[]) => mockVerifyAccessToken(...args),
        getLongLivedToken: (...args: any[]) => mockGetLongLivedToken(...args),
    },
}));

// Mock auth service
const mockFindOrCreateUser = vi.fn().mockResolvedValue({
    id: 'user-123',
    facebookId: 'fb_123',
    name: 'Test User',
    email: 'test@example.com',
});
const mockGenerateToken = vi.fn().mockReturnValue('jwt_token_123');
const mockCreateAuthResponse = vi.fn().mockImplementation((user, token, fbToken, extra) => ({
    user: { id: user.id, name: user.name },
    token,
    fbAccessToken: fbToken,
    ...extra,
}));

vi.mock('../../src/services/auth', () => ({
    authService: {
        findOrCreateUser: (...args: any[]) => mockFindOrCreateUser(...args),
        generateToken: (...args: any[]) => mockGenerateToken(...args),
        createAuthResponse: (...args: any[]) => mockCreateAuthResponse(...args),
    },
    ACCESS_TOKEN_EXPIRY: '15m',
}));

// Mock pages service
vi.mock('../../src/services/pages', () => ({
    pagesService: {
        syncFromFacebook: vi.fn().mockResolvedValue(undefined),
    },
}));

// Mock settings service
vi.mock('../../src/services/settings', () => ({
    settingsService: {
        getSettings: vi.fn().mockResolvedValue({ dashboardLanguage: 'en' }),
    },
}));

// Mock cookies service
vi.mock('../../src/services/cookies', () => ({
    cookiesService: {
        setAuthCookies: vi.fn(),
        setRefreshTokenCookie: vi.fn(),
        clearAuthCookies: vi.fn(),
    },
}));

// Mock refresh token service
vi.mock('../../src/services/refreshToken', () => ({
    refreshTokenService: {
        createRefreshToken: vi.fn().mockResolvedValue('refresh_token_123'),
    },
}));

// Mock DB
vi.mock('../../src/db', () => ({
    db: {
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    catch: vi.fn(),
                }),
            }),
        }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    users: { id: 'id', hasInstagramPermission: 'has_instagram_permission' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn(),
}));

// Login resolves the caller's partner status for the nav entry. Not what this
// suite is about — stubbed so the claim flow keeps its narrow db mock.
vi.mock('../../src/services/partnerAccess', () => ({
    isPartnerUser: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../src/services/workspace', () => ({
    workspaceService: {
        getUserWorkspaces: vi.fn().mockResolvedValue([]),
        resolveDefaultWorkspaceId: vi.fn().mockResolvedValue(null),
    },
}));

// Import after mocks
import { AuthController } from '../../src/controllers/auth';

function createMockRequest(overrides: Partial<any> = {}): any {
    return {
        body: { code: 'fb_auth_code', redirectUri: 'https://jawab24.com/callback' },
        cookies: {},
        unsignCookie: vi.fn().mockReturnValue({ valid: false, value: null }),
        log: {
            error: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
        },
        ...overrides,
    };
}

function createMockReply(): any {
    return {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        setCookie: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
    };
}

describe('AuthController - Salla Pending Install Claim', () => {
    let controller: AuthController;

    beforeEach(() => {
        vi.clearAllMocks();
        controller = new AuthController();
    });

    describe('facebookLogin - Salla claim flow', () => {
        it('should claim pending Salla install after successful FB login', async () => {
            mockClaimPendingInstall.mockResolvedValueOnce({
                id: 'store-salla-new',
                storeDomain: 'my-store.salla.sa',
                userId: 'user-123',
            });

            const req = createMockRequest({
                cookies: { pendingSallaId: 'signed_pending_cookie' },
                unsignCookie: vi.fn().mockImplementation((cookie: string) => {
                    if (cookie === 'signed_pending_cookie') {
                        return { valid: true, value: 'pending-salla-uuid-123' };
                    }
                    return { valid: false, value: null };
                }),
            });
            const rep = createMockReply();

            await controller.facebookLogin(req, rep);

            // Should claim the pending install
            expect(mockClaimPendingInstall).toHaveBeenCalledWith('pending-salla-uuid-123', 'user-123');

            // Should clear the pending cookie
            expect(rep.clearCookie).toHaveBeenCalledWith('pendingSallaId', { path: '/' });

            // Should include sallaOnboarding in response
            const sendCall = rep.send.mock.calls[0][0];
            expect(sendCall.sallaOnboarding).toBe(true);
            expect(sendCall.ecommerceStoreId).toBe('store-salla-new');
        });

        it('should login normally when no pending Salla cookie exists', async () => {
            const req = createMockRequest({
                cookies: {},
            });
            const rep = createMockReply();

            await controller.facebookLogin(req, rep);

            expect(mockClaimPendingInstall).not.toHaveBeenCalled();
            expect(rep.clearCookie).not.toHaveBeenCalled();

            // Should still send auth response
            expect(rep.send).toHaveBeenCalled();
            const sendCall = rep.send.mock.calls[0][0];
            expect(sendCall.sallaOnboarding).toBeUndefined();
        });

        it('should login normally when pending Salla cookie is invalid (tampered)', async () => {
            const req = createMockRequest({
                cookies: { pendingSallaId: 'tampered_cookie' },
                unsignCookie: vi.fn().mockReturnValue({ valid: false, value: null }),
            });
            const rep = createMockReply();

            await controller.facebookLogin(req, rep);

            expect(mockClaimPendingInstall).not.toHaveBeenCalled();
            expect(rep.send).toHaveBeenCalled();
        });

        it('should login normally when claim fails (non-fatal)', async () => {
            mockClaimPendingInstall.mockRejectedValueOnce(new Error('Salla store already connected'));

            const req = createMockRequest({
                cookies: { pendingSallaId: 'signed_pending_cookie' },
                unsignCookie: vi.fn().mockImplementation((cookie: string) => {
                    if (cookie === 'signed_pending_cookie') {
                        return { valid: true, value: 'pending-salla-uuid-123' };
                    }
                    return { valid: false, value: null };
                }),
            });
            const rep = createMockReply();

            await controller.facebookLogin(req, rep);

            // Should still send auth response (non-fatal error)
            expect(rep.send).toHaveBeenCalled();
            const sendCall = rep.send.mock.calls[0][0];
            expect(sendCall.sallaOnboarding).toBeUndefined();

            // Should log the error
            expect(req.log.error).toHaveBeenCalled();
        });

        it('should not add sallaOnboarding when claim returns null (expired)', async () => {
            mockClaimPendingInstall.mockResolvedValueOnce(null);

            const req = createMockRequest({
                cookies: { pendingSallaId: 'signed_pending_cookie' },
                unsignCookie: vi.fn().mockImplementation((cookie: string) => {
                    if (cookie === 'signed_pending_cookie') {
                        return { valid: true, value: 'pending-salla-expired' };
                    }
                    return { valid: false, value: null };
                }),
            });
            const rep = createMockReply();

            await controller.facebookLogin(req, rep);

            // Should NOT set sallaOnboarding
            const sendCall = rep.send.mock.calls[0][0];
            expect(sendCall.sallaOnboarding).toBeUndefined();

            // Should NOT clear cookie (claim returned null)
            expect(rep.clearCookie).not.toHaveBeenCalledWith('pendingSallaId', expect.anything());
        });
    });

    describe('nativeLogin - Salla claim flow', () => {
        it('should claim pending Salla install after successful native login', async () => {
            mockClaimPendingInstall.mockResolvedValueOnce({
                id: 'store-salla-mobile',
                storeDomain: 'mobile-store.salla.sa',
                userId: 'user-123',
            });

            const req = createMockRequest({
                body: { accessToken: 'fb_native_token' },
                cookies: { pendingSallaId: 'signed_pending_cookie' },
                unsignCookie: vi.fn().mockImplementation((cookie: string) => {
                    if (cookie === 'signed_pending_cookie') {
                        return { valid: true, value: 'pending-salla-mobile' };
                    }
                    return { valid: false, value: null };
                }),
            });
            const rep = createMockReply();

            await controller.nativeLogin(req, rep);

            expect(mockClaimPendingInstall).toHaveBeenCalledWith('pending-salla-mobile', 'user-123');
            expect(rep.clearCookie).toHaveBeenCalledWith('pendingSallaId', { path: '/' });

            const sendCall = rep.send.mock.calls[0][0];
            expect(sendCall.sallaOnboarding).toBe(true);
            expect(sendCall.ecommerceStoreId).toBe('store-salla-mobile');
        });

        it('should login normally on native when no pending Salla cookie', async () => {
            const req = createMockRequest({
                body: { accessToken: 'fb_native_token' },
                cookies: {},
            });
            const rep = createMockReply();

            await controller.nativeLogin(req, rep);

            expect(mockClaimPendingInstall).not.toHaveBeenCalled();
            expect(rep.send).toHaveBeenCalled();
        });

        it('should handle claim error gracefully on native login', async () => {
            mockClaimPendingInstall.mockRejectedValueOnce(new Error('already connected'));

            const req = createMockRequest({
                body: { accessToken: 'fb_native_token' },
                cookies: { pendingSallaId: 'signed_pending_cookie' },
                unsignCookie: vi.fn().mockImplementation((cookie: string) => {
                    if (cookie === 'signed_pending_cookie') {
                        return { valid: true, value: 'pending-salla-conflict' };
                    }
                    return { valid: false, value: null };
                }),
            });
            const rep = createMockReply();

            await controller.nativeLogin(req, rep);

            // Should still succeed (non-fatal)
            expect(rep.send).toHaveBeenCalled();
            expect(req.log.error).toHaveBeenCalled();
        });
    });
});
