import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import authRoutes from '../../src/routes/auth';

// Mock database — chainable query builder for select/update
const mockChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    set: vi.fn().mockReturnThis(),
};
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(() => mockChain),
        update: vi.fn(() => mockChain),
    },
}));

vi.mock('../../src/db/schema', () => ({
    users: { id: 'id', email: 'email', name: 'name', updatedAt: 'updated_at' },
    ecommerceStores: { id: 'id', userId: 'user_id', isActive: 'is_active' },
    // Login and /auth/me resolve the caller's partner status for the nav entry.
    partners: { id: 'id', phone: 'phone', userId: 'user_id', isActive: 'is_active' },
}));

vi.mock('../../src/config', () => ({
    config: {
        phoneAuthEnabled: true,
        vonage: { apiKey: '', apiSecret: '', senderId: '' },
        adminEmails: [],
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...args: unknown[]) => ({ op: 'and', conditions: args })),
    or: vi.fn((...args: unknown[]) => ({ op: 'or', conditions: args })),
    isNull: vi.fn((field) => ({ field, op: 'isNull' })),
}));

// Mock services
vi.mock('../../src/services/facebook', () => ({
    facebookService: {
        getAccessToken: vi.fn(),
        getLongLivedToken: vi.fn(),
        getUserProfile: vi.fn(),
        setLogger: vi.fn(),
    },
}));

vi.mock('../../src/services/auth', () => ({
    authService: {
        findOrCreateUser: vi.fn(),
        generateToken: vi.fn(),
        createAuthResponse: vi.fn(),
        verifyToken: vi.fn(),
        getUserById: vi.fn(),
        deleteUser: vi.fn(),
    },
}));

vi.mock('../../src/services/pages', () => ({
    pagesService: {
        syncFromFacebook: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/settings', () => ({
    settingsService: {
        getSettings: vi.fn(),
    },
}));

vi.mock('../../src/services/refreshToken', () => ({
    refreshTokenService: {
        createRefreshToken: vi.fn().mockResolvedValue('mock-refresh-token'),
        rotateRefreshToken: vi.fn(),
        revokeRefreshToken: vi.fn(),
    },
}));

// The controller's replay trigger pulls in services/activation → lib/redis; stub it like the rest.
vi.mock('../../src/services/activation', () => ({ replayPendingActivationEventsToGa4: vi.fn() }));
vi.mock('../../src/services/cookies', () => ({
    cookiesService: {
        setAuthCookies: vi.fn(),
        setRefreshTokenCookie: vi.fn(),
        clearAuthCookies: vi.fn(),
    },
}));

vi.mock('../../src/services/workspace', () => ({
    workspaceService: {
        getUserWorkspaces: vi.fn().mockResolvedValue([{ id: 'test_workspace_id', role: 'owner' }]),
        resolveDefaultWorkspaceId: vi.fn().mockResolvedValue('test_workspace_id'),
    },
}));

describe('Auth Routes - Login Flow', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = fastify();
        app.register(authRoutes);
        await app.ready();
        vi.clearAllMocks();

        // Setup default mocks
        const { settingsService } = await import('../../src/services/settings');
        vi.mocked(settingsService.getSettings).mockResolvedValue({
            id: 'settings_default',
            userId: 'user_uuid_default',
            dashboardLanguage: 'ar',
            defaultReplyLanguage: 'ar',
            supportedLanguages: ['ar', 'en'],
            autoDetectLanguage: true,
            aiEnabled: true,
            aiModel: 'gpt-4o',
            commentReplyMode: 'public',
            commentsAutoReply: true,
            messagesAutoReply: true,
            dualReplyConfig: {},
            businessHoursOnly: false,
            businessHoursStart: '09:00',
            businessHoursEnd: '17:00',
            awayMessage: null,
            greetingMessage: null,
            replyDelay: 0,
        });
    });

    describe('POST /auth/facebook - Facebook Login', () => {
        it('should successfully login with valid Facebook code', async () => {
            // Import mocked services
            const { facebookService } = await import('../../src/services/facebook');
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');

            // Setup mocks
            vi.mocked(settingsService.getSettings).mockResolvedValue({
                id: 'settings_123',
                userId: 'user_uuid_123',
                dashboardLanguage: 'ar',
                defaultReplyLanguage: 'ar',
                supportedLanguages: ['ar', 'en'],
                autoDetectLanguage: true,
                aiEnabled: true,
                aiModel: 'gpt-4o',
                commentReplyMode: 'public',
                commentsAutoReply: true,
                messagesAutoReply: true,
                dualReplyNudge: null,
                businessHoursOnly: false,
                businessHoursStart: '09:00',
                businessHoursEnd: '17:00',
                awayMessage: null,
                greetingMessage: null,
                replyDelay: 0,
            });
            vi.mocked(facebookService.getAccessToken).mockResolvedValue('fb_access_token_123');
            vi.mocked(facebookService.getLongLivedToken).mockResolvedValue({ token: 'long_lived_token_123', expiresAt: new Date('2026-04-22T00:00:00Z') });
            vi.mocked(facebookService.getUserProfile).mockResolvedValue({
                id: 'fb_user_123',
                name: 'John Doe',
                email: 'john@example.com',
                picture: 'https://example.com/photo.jpg',
            });
            vi.mocked(authService.findOrCreateUser).mockResolvedValue({
                id: 'user_uuid_123',
                facebookId: 'fb_user_123',
                name: 'John Doe',
                email: 'john@example.com',
                picture: 'https://example.com/photo.jpg',
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            vi.mocked(authService.generateToken).mockReturnValue('jwt_token_123');
            vi.mocked(authService.createAuthResponse).mockReturnValue({
                token: 'jwt_token_123',
                fbAccessToken: 'fb_access_token_123',
                user: {
                    id: 'user_uuid_123',
                    name: 'John Doe',
                    facebookId: 'fb_user_123',
                    picture: 'https://example.com/photo.jpg',
                },
            });

            const response = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: {
                    code: 'facebook_auth_code_xyz',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);

            expect(body.token).toBe('jwt_token_123');
            expect(body.fbAccessToken).toBe('fb_access_token_123');
            expect(body.user.id).toBe('user_uuid_123');
            expect(body.user.name).toBe('John Doe');
            expect(body.user.facebookId).toBe('fb_user_123');
            expect(body.user.picture).toBe('https://example.com/photo.jpg');

            // Verify service calls
            expect(facebookService.getAccessToken).toHaveBeenCalledWith('facebook_auth_code_xyz', undefined);
            expect(facebookService.getUserProfile).toHaveBeenCalledWith('long_lived_token_123');
            expect(authService.findOrCreateUser).toHaveBeenCalledWith(
                'fb_user_123',
                'John Doe',
                'john@example.com',
                'long_lived_token_123', // facebookAccessToken
                expect.any(Date), // facebookTokenExpiresAt
                'https://example.com/photo.jpg' // picture
            );
        });

        it('should return 400 if code is missing', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: {},
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.body);
            expect(body.error).toBe('Authorization code is required');
        });

        it('should return 401 if Facebook returns invalid code', async () => {
            const { facebookService } = await import('../../src/services/facebook');

            vi.mocked(facebookService.getAccessToken).mockRejectedValue(
                new Error('Facebook API error: Invalid authorization code')
            );

            const response = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: {
                    code: 'invalid_code',
                },
            });

            expect(response.statusCode).toBe(401);
            const body = JSON.parse(response.body);
            expect(body.error).toBe('Authentication failed');
            expect(body.message).toContain('Invalid authorization code');
        });

        it('should handle Facebook API rate limit errors', async () => {
            const { facebookService } = await import('../../src/services/facebook');

            vi.mocked(facebookService.getAccessToken).mockRejectedValue(
                new Error('Facebook API error: Rate limit exceeded')
            );

            const response = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: {
                    code: 'valid_code',
                },
            });

            expect(response.statusCode).toBe(401);
            const body = JSON.parse(response.body);
            expect(body.error).toBe('Authentication failed');
        });

        it('should create new user on first login', async () => {
            const { facebookService } = await import('../../src/services/facebook');
            const { authService } = await import('../../src/services/auth');

            vi.mocked(facebookService.getAccessToken).mockResolvedValue('fb_token');
            vi.mocked(facebookService.getUserProfile).mockResolvedValue({
                id: 'new_fb_user',
                name: 'Jane Smith',
                email: 'jane@example.com',
            });
            vi.mocked(authService.findOrCreateUser).mockResolvedValue({
                id: 'new_user_uuid',
                facebookId: 'new_fb_user',
                name: 'Jane Smith',
                email: 'jane@example.com',
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            vi.mocked(authService.generateToken).mockReturnValue('new_jwt_token');
            vi.mocked(authService.createAuthResponse).mockReturnValue({
                token: 'new_jwt_token',
                fbAccessToken: 'fb_token',
                user: {
                    id: 'new_user_uuid',
                    name: 'Jane Smith',
                    facebookId: 'new_fb_user',
                },
            });

            const response = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: {
                    code: 'new_user_code',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.user.name).toBe('Jane Smith');
            expect(authService.findOrCreateUser).toHaveBeenCalled();
        });

        it('should trigger page sync after successful login', async () => {
            const { facebookService } = await import('../../src/services/facebook');
            const { authService } = await import('../../src/services/auth');
            const { pagesService } = await import('../../src/services/pages');

            vi.mocked(facebookService.getAccessToken).mockResolvedValue('fb_token');
            vi.mocked(facebookService.getLongLivedToken).mockResolvedValue({ token: 'long_lived_sync_token', expiresAt: new Date('2026-04-22T00:00:00Z') });
            vi.mocked(facebookService.getUserProfile).mockResolvedValue({
                id: 'fb_123',
                name: 'Test User',
            });
            vi.mocked(authService.findOrCreateUser).mockResolvedValue({
                id: 'user_123',
                facebookId: 'fb_123',
                name: 'Test User',
                email: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            vi.mocked(authService.generateToken).mockReturnValue('jwt');
            vi.mocked(authService.createAuthResponse).mockReturnValue({
                token: 'jwt',
                fbAccessToken: 'long_lived_sync_token',
                user: {
                    id: 'user_123',
                    name: 'Test User',
                    facebookId: 'fb_123',
                },
            });

            await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: { code: 'test_code' },
            });

            // Page sync is called async, give it a moment
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(pagesService.syncFromFacebook).toHaveBeenCalledWith(
                'test_workspace_id',
                'user_123',
                'long_lived_sync_token',
                undefined,
                expect.objectContaining({ info: expect.any(Function) }),
            );
        });

        it('should handle login without email (privacy setting)', async () => {
            const { facebookService } = await import('../../src/services/facebook');
            const { authService } = await import('../../src/services/auth');

            vi.mocked(facebookService.getAccessToken).mockResolvedValue('fb_token');
            vi.mocked(facebookService.getLongLivedToken).mockResolvedValue({ token: 'long_lived_fb_token', expiresAt: new Date('2026-04-22T00:00:00Z') });
            vi.mocked(facebookService.getUserProfile).mockResolvedValue({
                id: 'fb_no_email',
                name: 'Private User',
                // email is undefined
                // picture is undefined
            });
            vi.mocked(authService.findOrCreateUser).mockResolvedValue({
                id: 'user_no_email',
                facebookId: 'fb_no_email',
                name: 'Private User',
                email: null,
                picture: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            vi.mocked(authService.generateToken).mockReturnValue('jwt_no_email');
            vi.mocked(authService.createAuthResponse).mockReturnValue({
                token: 'jwt_no_email',
                fbAccessToken: 'fb_token',
                user: {
                    id: 'user_no_email',
                    name: 'Private User',
                    facebookId: 'fb_no_email',
                },
            });

            const response = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: { code: 'code_no_email' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.user.name).toBe('Private User');
            expect(authService.findOrCreateUser).toHaveBeenCalledWith(
                'fb_no_email',
                'Private User',
                undefined, // email
                'long_lived_fb_token', // facebookAccessToken
                expect.any(Date), // facebookTokenExpiresAt
                undefined  // picture
            );
        });
    });

    describe('GET /auth/me - Get Current User', () => {
        it('should return current user with valid token', async () => {
            const { authService } = await import('../../src/services/auth');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });
            vi.mocked(authService.getUserById).mockResolvedValue({
                id: 'user_123',
                facebookId: 'fb_123',
                name: 'Current User',
                email: 'current@example.com',
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const response = await app.inject({
                method: 'GET',
                url: '/auth/me',
                headers: {
                    authorization: 'Bearer valid_jwt_token',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.id).toBe('user_123');
            expect(body.name).toBe('Current User');
        });

        it('should return 401 without auth token', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/auth/me',
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return 401 with invalid token', async () => {
            const { authService } = await import('../../src/services/auth');

            vi.mocked(authService.verifyToken).mockReturnValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/auth/me',
                headers: {
                    authorization: 'Bearer invalid_token',
                },
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return 404 if user not found in database', async () => {
            const { authService } = await import('../../src/services/auth');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'deleted_user',
                facebookId: 'fb_deleted',
            });
            vi.mocked(authService.getUserById).mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/auth/me',
                headers: {
                    authorization: 'Bearer valid_but_orphaned_token',
                },
            });

            expect(response.statusCode).toBe(404);
            const body = JSON.parse(response.body);
            expect(body.error).toBe('User not found');
        });
    });

    describe('Login Flow - End to End', () => {
        it('should complete full login flow: code → token → authenticated request', async () => {
            const { facebookService } = await import('../../src/services/facebook');
            const { authService } = await import('../../src/services/auth');

            // Step 1: Login with Facebook code
            vi.mocked(facebookService.getAccessToken).mockResolvedValue('fb_access_token');
            vi.mocked(facebookService.getUserProfile).mockResolvedValue({
                id: 'fb_e2e_user',
                name: 'E2E Test User',
                email: 'e2e@test.com',
            });
            vi.mocked(authService.findOrCreateUser).mockResolvedValue({
                id: 'e2e_user_id',
                facebookId: 'fb_e2e_user',
                name: 'E2E Test User',
                email: 'e2e@test.com',
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            vi.mocked(authService.generateToken).mockReturnValue('e2e_jwt_token');
            vi.mocked(authService.createAuthResponse).mockReturnValue({
                token: 'e2e_jwt_token',
                fbAccessToken: 'fb_access_token',
                user: {
                    id: 'e2e_user_id',
                    name: 'E2E Test User',
                    facebookId: 'fb_e2e_user',
                },
            });

            const loginResponse = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: { code: 'e2e_code' },
            });

            expect(loginResponse.statusCode).toBe(200);
            const loginBody = JSON.parse(loginResponse.body);
            const token = loginBody.token;

            // Step 2: Use token to access protected endpoint
            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'e2e_user_id',
                facebookId: 'fb_e2e_user',
            });
            vi.mocked(authService.getUserById).mockResolvedValue({
                id: 'e2e_user_id',
                facebookId: 'fb_e2e_user',
                name: 'E2E Test User',
                email: 'e2e@test.com',
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const meResponse = await app.inject({
                method: 'GET',
                url: '/auth/me',
                headers: {
                    authorization: `Bearer ${token}`,
                },
            });

            expect(meResponse.statusCode).toBe(200);
            const meBody = JSON.parse(meResponse.body);
            expect(meBody.id).toBe('e2e_user_id');
            expect(meBody.name).toBe('E2E Test User');
        });

        it('should handle login with redirect to checkout page', async () => {
            const { facebookService } = await import('../../src/services/facebook');
            const { authService } = await import('../../src/services/auth');

            vi.mocked(facebookService.getAccessToken).mockResolvedValue('fb_token');
            vi.mocked(facebookService.getUserProfile).mockResolvedValue({
                id: 'fb_redirect_user',
                name: 'Redirect User',
            });
            vi.mocked(authService.findOrCreateUser).mockResolvedValue({
                id: 'redirect_user_id',
                facebookId: 'fb_redirect_user',
                name: 'Redirect User',
                email: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            vi.mocked(authService.generateToken).mockReturnValue('redirect_jwt');
            vi.mocked(authService.createAuthResponse).mockReturnValue({
                token: 'redirect_jwt',
                fbAccessToken: 'fb_token',
                user: {
                    id: 'redirect_user_id',
                    name: 'Redirect User',
                    facebookId: 'fb_redirect_user',
                },
            });

            const response = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: {
                    code: 'redirect_code',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            // Frontend should use this token and redirect to /checkout or wherever
            expect(body.token).toBe('redirect_jwt');
            expect(body.fbAccessToken).toBe('fb_token');
        });
    });

    describe('DELETE /auth/me - Delete Account', () => {
        it('should delete account successfully with valid token', async () => {
            const { authService } = await import('../../src/services/auth');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_to_delete',
                facebookId: 'fb_delete',
            });
            vi.mocked(authService.deleteUser).mockResolvedValue(undefined);

            const response = await app.inject({
                method: 'DELETE',
                url: '/auth/me',
                headers: {
                    authorization: 'Bearer valid_token',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.success).toBe(true);
            expect(authService.deleteUser).toHaveBeenCalledWith('user_to_delete');
        });

        it('should return 401 without auth token', async () => {
            const response = await app.inject({
                method: 'DELETE',
                url: '/auth/me',
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return 404 when user not found', async () => {
            const { authService } = await import('../../src/services/auth');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'ghost_user',
                facebookId: 'fb_ghost',
            });
            vi.mocked(authService.deleteUser).mockRejectedValue(
                new Error('User ghost_user not found')
            );

            const response = await app.inject({
                method: 'DELETE',
                url: '/auth/me',
                headers: {
                    authorization: 'Bearer valid_token',
                },
            });

            expect(response.statusCode).toBe(404);
            const body = response.json();
            expect(body.error).toBe('User not found');
        });

        it('should return 500 when service throws unexpected error', async () => {
            const { authService } = await import('../../src/services/auth');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_crash',
                facebookId: 'fb_crash',
            });
            vi.mocked(authService.deleteUser).mockRejectedValue(
                new Error('deadlock detected')
            );

            const response = await app.inject({
                method: 'DELETE',
                url: '/auth/me',
                headers: {
                    authorization: 'Bearer valid_token',
                },
            });

            expect(response.statusCode).toBe(500);
            const body = response.json();
            expect(body.error).toBe('Failed to delete account');
            expect(body.code).toBeDefined();
        });
    });

    describe('PATCH /auth/profile - Update Profile', () => {
        it('should update user profile successfully', async () => {
            const { authService } = await import('../../src/services/auth');
            const { db } = await import('../../src/db');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            // Mock update chain
            const mockWhere = vi.fn().mockResolvedValue(undefined);
            const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            // Mock select chain for fetching updated user
            const updatedUser = {
                id: 'user_123',
                facebookId: 'fb_123',
                name: 'Test User',
                email: 'new@example.com',
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const mockSelectWhere = vi.fn().mockResolvedValue([updatedUser]);
            const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            const response = await app.inject({
                method: 'PATCH',
                url: '/auth/profile',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    email: 'new@example.com',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.email).toBe('new@example.com');
            expect(body.hasEmail).toBe(true);
        });

        it('should require authentication', async () => {
            const { authService } = await import('../../src/services/auth');

            vi.mocked(authService.verifyToken).mockReturnValue(null);

            const response = await app.inject({
                method: 'PATCH',
                url: '/auth/profile',
                payload: {
                    email: 'new@example.com',
                },
            });

            expect(response.statusCode).toBe(401);
        });
    });

    describe('Phone OTP Routes (phoneAuthEnabled=true)', () => {
        it('POST /auth/phone/request should be registered', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/auth/phone/request',
                payload: { phone: '+966500000000' },
            });
            // Route exists — not 404. Controller handles the logic (may return any status).
            expect(response.statusCode).not.toBe(404);
        });

        it('POST /auth/phone/verify should be registered', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/auth/phone/verify',
                payload: { phone: '+966500000000', code: '123456' },
            });
            expect(response.statusCode).not.toBe(404);
        });
    });
});
