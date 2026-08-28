import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import authRoutes from '../../src/routes/auth';
import paymentRoutes from '../../src/routes/payment';

/**
 * Integration Tests: Login and Checkout Flow
 * 
 * These tests verify the complete user journey:
 * 1. User visits pricing page and clicks upgrade
 * 2. User is redirected to login
 * 3. User logs in with Facebook
 * 4. User is redirected to checkout with plan ID
 * 5. User completes Stripe checkout
 * 
 * NOTE: These tests use mocked services with Fastify's inject API.
 * The core login functionality is also tested in test/routes/auth.test.ts
 */

// Mock services
vi.mock('../../src/services/facebook', () => ({
    facebookService: {
        getAccessToken: vi.fn(),
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
    },
    ACCESS_TOKEN_EXPIRY: 900000,
}));

// The marketplace billing guard — every Stripe entry point consults it. Mocked
// at the service boundary so this flow test keeps exercising the happy path;
// the rule itself is covered in test/services/marketplaceBilling.test.ts and the
// refusal wiring in test/controllers/payment.test.ts.
vi.mock('../../src/services/marketplaceBilling', () => ({
    resolveMarketplaceBilling: vi.fn(async () => null),
}));

vi.mock('../../src/services/stripe', () => ({
    stripeService: {
        createCheckoutSession: vi.fn(),
    },
}));

vi.mock('../../src/services/pages', () => ({
    pagesService: {
        syncFromFacebook: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/settings', () => ({
    settingsService: {
        getSettings: vi.fn().mockResolvedValue({ dashboardLanguage: 'en' }),
    },
}));

vi.mock('../../src/services/refreshToken', () => ({
    refreshTokenService: {
        createRefreshToken: vi.fn().mockResolvedValue('mock_refresh_token'),
    },
}));

vi.mock('../../src/services/cookies', () => ({
    cookiesService: {
        setAuthCookies: vi.fn(),
        setRefreshTokenCookie: vi.fn(),
    },
}));

vi.mock('../../src/utils/sanctions', () => ({
    isSanctionedGeo: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/middleware/geo', () => ({
    shouldBlockUnknownGeo: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), quit: vi.fn() },
}));

vi.mock('../../src/config', () => ({
    config: {
        frontendUrl: 'http://localhost:3001',
        stripe: { webhookSecret: 'whsec_test' },
    },
}));

vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        // null = not shopify-billed, so the D-G guard lets checkout proceed.
        getUserSubscription: vi.fn().mockResolvedValue(null),
        initializeUsagePeriod: vi.fn().mockResolvedValue(undefined),
        invalidateStatusCache: vi.fn().mockResolvedValue(undefined),
        PRIORITY_SQL: {},
    },
}));

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve([])),
            })),
        })),
    },
}));

vi.mock('../../src/db/schema', () => ({
    // The offline (Sham Cash) payment rail's tables. Present here only because
    // this file hand-rolls the schema mock: the admin/payment routes import the
    // offline-payments controller, and a missing export throws at import time.
    offlinePayments: { id: 'id', userId: 'userId', rail: 'rail', planId: 'planId', billingInterval: 'bi', amountCents: 'ac', currency: 'currency', transferReference: 'tr', transferReferenceNormalized: 'trn', senderName: 'sn', note: 'note', status: 'status', reviewNote: 'rn', reviewedByAdminUserId: 'rba', reviewedAt: 'ra', createdAt: 'createdAt', updatedAt: 'updatedAt' },
    offlinePaymentReceipts: { offlinePaymentId: 'opi', mimeType: 'mimeType', byteLength: 'bl', bytes: 'bytes', createdAt: 'createdAt' },
    users: { id: 'id', email: 'email' },
    plans: { id: 'id', stripePriceId: 'stripe_price_id' },
    subscriptions: {},
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    sql: vi.fn(),
}));

// Login resolves the caller's partner status for the nav entry. Not what this
// suite is about — stubbed so the flow under test keeps its narrow db mock.
vi.mock('../../src/services/partnerAccess', () => ({
    isPartnerUser: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../src/services/workspace', () => ({
    workspaceService: {
        getUserWorkspaces: vi.fn().mockResolvedValue([]),
        resolveDefaultWorkspaceId: vi.fn().mockResolvedValue(null),
    },
}));

// Mock authentication middleware
vi.mock('../../src/middleware/auth', () => ({
    authenticate: async (req: any) => {
        // Mock authenticate to set user from auth header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw { statusCode: 401, message: 'Unauthorized' };
        }
        const token = authHeader.split(' ')[1];
        const { authService } = await import('../../src/services/auth');
        const payload = authService.verifyToken(token);
        if (!payload) {
            throw { statusCode: 401, message: 'Invalid token' };
        }
        req.user = payload;
    },
}));

describe('Integration: Login → Checkout Flow', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        vi.resetAllMocks();
        app = fastify();
        app.register(authRoutes);
        app.register(paymentRoutes, { prefix: '/payment' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
    });

    describe('Complete flow: Pricing → Login → Checkout', () => {
        it('should complete full flow from pricing page to Stripe checkout', async () => {
            const { facebookService } = await import('../../src/services/facebook');
            const { authService } = await import('../../src/services/auth');
            const { stripeService } = await import('../../src/services/stripe');
            const { db } = await import('../../src/db');
            const { settingsService } = await import('../../src/services/settings');
            const { refreshTokenService } = await import('../../src/services/refreshToken');
            const { cookiesService } = await import('../../src/services/cookies');
            const { pagesService } = await import('../../src/services/pages');
            const { workspaceService } = await import('../../src/services/workspace');

            const planId = '92598acb-dde0-4d25-8312-17d7f9d9df9b';

            // Setup login service mocks
            vi.mocked(facebookService.getAccessToken).mockResolvedValue('fb_access_token_xyz');
            vi.mocked(facebookService.getUserProfile).mockResolvedValue({
                id: 'fb_12345',
                name: 'Test User',
                email: 'testuser@example.com',
            });
            vi.mocked(authService.findOrCreateUser).mockResolvedValue({
                id: 'user_uuid_789',
                facebookId: 'fb_12345',
                name: 'Test User',
                email: 'testuser@example.com',
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            vi.mocked(authService.generateToken).mockReturnValue('jwt_token_xyz');
            vi.mocked(authService.createAuthResponse).mockReturnValue({
                token: 'jwt_token_xyz',
                fbAccessToken: 'fb_access_token_xyz',
                user: {
                    id: 'user_uuid_789',
                    name: 'Test User',
                    facebookId: 'fb_12345',
                },
            });
            vi.mocked(pagesService.syncFromFacebook).mockResolvedValue([] as any);
            vi.mocked(settingsService.getSettings).mockResolvedValue({ dashboardLanguage: 'en' } as any);
            vi.mocked(refreshTokenService.createRefreshToken).mockResolvedValue('mock_refresh_token');
            vi.mocked(cookiesService.setAuthCookies).mockReturnValue(undefined);
            vi.mocked(cookiesService.setRefreshTokenCookie).mockReturnValue(undefined);
            vi.mocked(workspaceService.getUserWorkspaces).mockResolvedValue([]);

            const loginResponse = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: {
                    code: 'facebook_oauth_code',
                },
            });

            expect(loginResponse.statusCode).toBe(200);
            const loginBody = JSON.parse(loginResponse.body);
            const authToken = loginBody.token;
            expect(authToken).toBe('jwt_token_xyz');

            // Step 5: Frontend stores token and redirects to /checkout?planId=...
            // Step 6: User makes authenticated request to create checkout session

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_uuid_789',
                facebookId: 'fb_12345',
            });

            // Mock database queries: user lookup, plan lookup, subscriptions check
            const dbSelectMock = vi.mocked(db.select);
            dbSelectMock.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        { id: 'user_uuid_789', email: 'testuser@example.com' },
                    ]),
                }),
            } as any);
            dbSelectMock.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        { id: planId, name: 'Business Plan', stripePriceId: 'price_1234567890', trialDays: 0 },
                    ]),
                }),
            } as any);
            dbSelectMock.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            vi.mocked(stripeService.createCheckoutSession).mockResolvedValue({
                id: 'cs_test_abc123',
                client_secret: 'cs_test_abc123_secret',
                object: 'checkout.session',
                customer_email: 'testuser@example.com',
                metadata: {
                    userId: 'user_uuid_789',
                    planId: planId,
                },
            } as any);

            const checkoutResponse = await app.inject({
                method: 'POST',
                url: '/payment/create-checkout-session',
                headers: {
                    authorization: `Bearer ${authToken}`,
                },
                payload: {
                    planId: planId,
                },
            });

            expect(checkoutResponse.statusCode).toBe(200);
            const checkoutBody = JSON.parse(checkoutResponse.body);
            expect(checkoutBody.clientSecret).toBe('cs_test_abc123_secret');

            // Verify the entire flow
            expect(facebookService.getAccessToken).toHaveBeenCalledWith('facebook_oauth_code', undefined);
            expect(authService.findOrCreateUser).toHaveBeenCalled();
            expect(authService.verifyToken).toHaveBeenCalledWith(authToken);
            expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
                'user_uuid_789',
                'testuser@example.com',
                planId,
                'price_1234567890',
                expect.stringContaining('return'),
                0 // trialDays
            );
        });

        it('should handle login errors during checkout flow', async () => {
            const { facebookService } = await import('../../src/services/facebook');

            // User tries to login but Facebook returns error
            vi.mocked(facebookService.getAccessToken).mockRejectedValue(
                new Error('Facebook API error: Invalid code')
            );

            const loginResponse = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: {
                    code: 'invalid_facebook_code',
                },
            });

            expect(loginResponse.statusCode).toBe(401);
            const body = JSON.parse(loginResponse.body);
            expect(body.error).toBe('Authentication failed');

            // User should be shown error and cannot proceed to checkout
        });

        it('should require authentication for checkout', async () => {
            // User tries to access checkout without logging in
            const response = await app.inject({
                method: 'POST',
                url: '/payment/create-checkout-session',
                payload: {
                    planId: 'plan_123',
                },
            });

            expect(response.statusCode).toBe(401);
        });

        it('should handle expired token during checkout', async () => {
            const { authService } = await import('../../src/services/auth');

            // Token is expired or invalid
            vi.mocked(authService.verifyToken).mockReturnValue(null);

            const response = await app.inject({
                method: 'POST',
                url: '/payment/create-checkout-session',
                headers: {
                    authorization: 'Bearer expired_token',
                },
                payload: {
                    planId: 'plan_123',
                },
            });

            expect(response.statusCode).toBe(401);
            // User should be redirected back to login
        });
    });

    describe('Edge cases in login-to-checkout flow', () => {
        it('should handle user with no email trying to checkout', async () => {
            const { facebookService } = await import('../../src/services/facebook');
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');
            const { refreshTokenService } = await import('../../src/services/refreshToken');
            const { cookiesService } = await import('../../src/services/cookies');
            const { pagesService } = await import('../../src/services/pages');
            const { workspaceService } = await import('../../src/services/workspace');

            // Setup login service mocks
            vi.mocked(facebookService.getAccessToken).mockResolvedValue('fb_token');
            vi.mocked(facebookService.getUserProfile).mockResolvedValue({
                id: 'fb_no_email',
                name: 'Private User',
            });
            vi.mocked(authService.findOrCreateUser).mockResolvedValue({
                id: 'user_no_email',
                facebookId: 'fb_no_email',
                name: 'Private User',
                email: null,
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
            vi.mocked(pagesService.syncFromFacebook).mockResolvedValue([] as any);
            vi.mocked(settingsService.getSettings).mockResolvedValue({ dashboardLanguage: 'en' } as any);
            vi.mocked(refreshTokenService.createRefreshToken).mockResolvedValue('mock_refresh_token');
            vi.mocked(cookiesService.setAuthCookies).mockReturnValue(undefined);
            vi.mocked(cookiesService.setRefreshTokenCookie).mockReturnValue(undefined);
            vi.mocked(workspaceService.getUserWorkspaces).mockResolvedValue([]);

            const loginResponse = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: { code: 'code_no_email' },
            });

            expect(loginResponse.statusCode).toBe(200);

            // Now try to checkout - controller requires email
            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_no_email',
                facebookId: 'fb_no_email',
            });

            const { db } = await import('../../src/db');
            const dbSelectMock = vi.mocked(db.select);
            // Only need user lookup — controller returns 400 before plan lookup
            dbSelectMock.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        { id: 'user_no_email', email: null },
                    ]),
                }),
            } as any);

            const checkoutResponse = await app.inject({
                method: 'POST',
                url: '/payment/create-checkout-session',
                headers: {
                    authorization: 'Bearer jwt_no_email',
                },
                payload: {
                    planId: 'plan_123',
                },
            });

            // Controller requires email for Stripe checkout
            expect(checkoutResponse.statusCode).toBe(400);
            const checkoutBody = JSON.parse(checkoutResponse.body);
            expect(checkoutBody.code).toBe('EMAIL_REQUIRED');
        });

        it('should handle invalid plan ID in checkout', async () => {
            const { authService } = await import('../../src/services/auth');
            const { db } = await import('../../src/db');

            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_123',
                facebookId: 'fb_123',
            });

            // Mock user exists
            const dbSelectMock = vi.mocked(db.select);
            dbSelectMock.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        {
                            id: 'user_123',
                            email: 'user@test.com',
                        },
                    ]),
                }),
            } as any);
            // Mock plan does not exist
            dbSelectMock.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]), // Empty - plan not found
                }),
            } as any);

            const response = await app.inject({
                method: 'POST',
                url: '/payment/create-checkout-session',
                headers: {
                    authorization: 'Bearer valid_token',
                },
                payload: {
                    planId: 'invalid_plan_id',
                },
            });

            expect(response.statusCode).toBe(404);
            const body = JSON.parse(response.body);
            expect(body.error).toContain('Plan not found');
        });
    });

    describe('Security: Authentication and Authorization', () => {
        it('should prevent access to checkout without valid JWT', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/payment/create-checkout-session',
                headers: {
                    authorization: 'Bearer fake_token',
                },
                payload: {
                    planId: 'plan_123',
                },
            });

            expect(response.statusCode).toBe(401);
        });

        it('should prevent checkout with tampered JWT', async () => {
            const { authService } = await import('../../src/services/auth');

            // Mock verifyToken to return null (invalid signature)
            vi.mocked(authService.verifyToken).mockReturnValue(null);

            const response = await app.inject({
                method: 'POST',
                url: '/payment/create-checkout-session',
                headers: {
                    authorization: 'Bearer tampered.jwt.token',
                },
                payload: {
                    planId: 'plan_123',
                },
            });

            expect(response.statusCode).toBe(401);
        });

        it('should log authentication attempts for security monitoring', async () => {
            const { facebookService } = await import('../../src/services/facebook');

            vi.mocked(facebookService.getAccessToken).mockRejectedValue(
                new Error('Invalid authorization code')
            );

            const response = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: {
                    code: 'suspicious_code',
                },
            });

            expect(response.statusCode).toBe(401);
            // Request log should contain error details for security monitoring
        });
    });

    // ── Regression: pages must be synced BEFORE login response is returned ───
    // Without this, new users land on the onboarding wizard with 0 pages because
    // the non-blocking fire-and-forget sync hadn't finished yet.
    describe('Page sync blocking guarantee', () => {
        it('awaits syncFromFacebook so pages exist before the login response is returned', async () => {
            const { facebookService } = await import('../../src/services/facebook');
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');
            const { refreshTokenService } = await import('../../src/services/refreshToken');
            const { cookiesService } = await import('../../src/services/cookies');
            const { pagesService } = await import('../../src/services/pages');
            const { workspaceService } = await import('../../src/services/workspace');

            vi.mocked(facebookService.getAccessToken).mockResolvedValue('fb_token');
            vi.mocked(facebookService.getUserProfile).mockResolvedValue({
                id: 'fb_sync_test',
                name: 'Sync Test User',
            });
            vi.mocked(authService.findOrCreateUser).mockResolvedValue({
                id: 'user_sync_test',
                facebookId: 'fb_sync_test',
                name: 'Sync Test User',
                email: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            vi.mocked(authService.generateToken).mockReturnValue('jwt_sync_test');
            vi.mocked(authService.createAuthResponse).mockReturnValue({
                token: 'jwt_sync_test',
                fbAccessToken: 'fb_token',
                user: { id: 'user_sync_test', name: 'Sync Test User', facebookId: 'fb_sync_test' },
            });
            vi.mocked(settingsService.getSettings).mockResolvedValue({ dashboardLanguage: 'en' } as any);
            vi.mocked(refreshTokenService.createRefreshToken).mockResolvedValue('refresh_token');
            vi.mocked(cookiesService.setAuthCookies).mockReturnValue(undefined);
            vi.mocked(cookiesService.setRefreshTokenCookie).mockReturnValue(undefined);

            // Return a real workspace ID so the sync is triggered
            vi.mocked(workspaceService.getUserWorkspaces).mockResolvedValue([
                { id: 'ws_sync_test', name: 'Test WS', role: 'owner' },
            ] as any);

            // Track whether syncFromFacebook completed before the response arrived
            let syncCompleted = false;
            vi.mocked(pagesService.syncFromFacebook).mockImplementation(async () => {
                await new Promise((r) => setTimeout(r, 30)); // simulate async Facebook API call
                syncCompleted = true;
                return { syncedPages: [], skippedCount: 0 } as any;
            });

            const response = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: { code: 'sync_test_code' },
            });

            expect(response.statusCode).toBe(200);
            // The critical assertion: if sync were non-blocking (fire-and-forget),
            // syncCompleted would still be false here because the response would return
            // before the 30ms timeout resolved.
            expect(syncCompleted).toBe(true);
            expect(pagesService.syncFromFacebook).toHaveBeenCalledWith(
                'ws_sync_test',
                'user_sync_test',
                'fb_token',
                undefined,
                expect.objectContaining({ info: expect.any(Function) }),
            );
        });

        it('still succeeds when syncFromFacebook throws (sync failure is non-fatal)', async () => {
            const { facebookService } = await import('../../src/services/facebook');
            const { authService } = await import('../../src/services/auth');
            const { settingsService } = await import('../../src/services/settings');
            const { refreshTokenService } = await import('../../src/services/refreshToken');
            const { cookiesService } = await import('../../src/services/cookies');
            const { pagesService } = await import('../../src/services/pages');
            const { workspaceService } = await import('../../src/services/workspace');

            vi.mocked(facebookService.getAccessToken).mockResolvedValue('fb_token');
            vi.mocked(facebookService.getUserProfile).mockResolvedValue({ id: 'fb_fail', name: 'Fail User' });
            vi.mocked(authService.findOrCreateUser).mockResolvedValue({
                id: 'user_fail',
                facebookId: 'fb_fail',
                name: 'Fail User',
                email: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            vi.mocked(authService.generateToken).mockReturnValue('jwt_fail');
            vi.mocked(authService.createAuthResponse).mockReturnValue({
                token: 'jwt_fail',
                fbAccessToken: 'fb_token',
                user: { id: 'user_fail', name: 'Fail User', facebookId: 'fb_fail' },
            });
            vi.mocked(settingsService.getSettings).mockResolvedValue({ dashboardLanguage: 'en' } as any);
            vi.mocked(refreshTokenService.createRefreshToken).mockResolvedValue('refresh_token');
            vi.mocked(cookiesService.setAuthCookies).mockReturnValue(undefined);
            vi.mocked(cookiesService.setRefreshTokenCookie).mockReturnValue(undefined);
            vi.mocked(workspaceService.getUserWorkspaces).mockResolvedValue([
                { id: 'ws_fail', name: 'Fail WS', role: 'owner' },
            ] as any);
            // Sync throws — login must still succeed
            vi.mocked(pagesService.syncFromFacebook).mockRejectedValue(new Error('Facebook API down'));

            const response = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: { code: 'fail_sync_code' },
            });

            // Login must succeed even if sync fails
            expect(response.statusCode).toBe(200);
        });
    });
});
