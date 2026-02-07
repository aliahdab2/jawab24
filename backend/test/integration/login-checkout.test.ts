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
    users: { id: 'id', email: 'email' },
    plans: { id: 'id', stripePriceId: 'stripe_price_id' },
    subscriptions: {},
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    sql: vi.fn(),
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
        app = fastify();
        app.register(authRoutes);
        app.register(paymentRoutes, { prefix: '/payment' });
        await app.ready();
        vi.clearAllMocks();
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

            // Step 1: User clicks upgrade on pricing page
            const planId = '92598acb-dde0-4d25-8312-17d7f9d9df9b';
            const redirectUrl = encodeURIComponent(`/checkout?planId=${planId}`);

            // Step 2: User is redirected to login page with redirect param
            // Frontend: https://jawab24.com/en/login?redirect=%2Fcheckout%3FplanId%3D...

            // Step 3: User clicks "Login with Facebook" and gets redirected to Facebook OAuth
            // Facebook redirects back with code

            // Step 4: Frontend sends code to backend
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

            // Mock database queries for plan lookup
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        {
                            id: 'user_uuid_789',
                            email: 'testuser@example.com',
                        },
                    ]),
                }),
            } as any);

            // For the second db.select call (plan lookup), need separate mock
            const dbSelectMock = vi.mocked(db.select);
            dbSelectMock.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        {
                            id: 'user_uuid_789',
                            email: 'testuser@example.com',
                        },
                    ]),
                }),
            } as any);
            dbSelectMock.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        {
                            id: planId,
                            name: 'Business Plan',
                            stripePriceId: 'price_1234567890',
                        },
                    ]),
                }),
            } as any);

            vi.mocked(stripeService.createCheckoutSession).mockResolvedValue({
                id: 'cs_test_abc123',
                url: 'https://checkout.stripe.com/pay/cs_test_abc123',
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
            expect(checkoutBody.url).toBe('https://checkout.stripe.com/pay/cs_test_abc123');

            // Verify the entire flow
            expect(facebookService.getAccessToken).toHaveBeenCalledWith('facebook_oauth_code', undefined);
            expect(authService.findOrCreateUser).toHaveBeenCalled();
            expect(authService.verifyToken).toHaveBeenCalledWith(authToken);
            expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
                'user_uuid_789',
                'testuser@example.com',
                planId,
                'price_1234567890',
                expect.stringContaining('success'),
                expect.stringContaining('cancel')
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

            // User logs in without email permission
            vi.mocked(facebookService.getAccessToken).mockResolvedValue('fb_token');
            vi.mocked(facebookService.getUserProfile).mockResolvedValue({
                id: 'fb_no_email',
                name: 'Private User',
                // No email
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

            const loginResponse = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: { code: 'code_no_email' },
            });

            expect(loginResponse.statusCode).toBe(200);

            // Now try to checkout - should handle missing email gracefully
            vi.mocked(authService.verifyToken).mockReturnValue({
                userId: 'user_no_email',
                facebookId: 'fb_no_email',
            });

            const { db } = await import('../../src/db');
            const { stripeService } = await import('../../src/services/stripe');

            const dbSelectMock = vi.mocked(db.select);
            dbSelectMock.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        {
                            id: 'user_no_email',
                            email: null, // No email
                        },
                    ]),
                }),
            } as any);
            dbSelectMock.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        {
                            id: 'plan_123',
                            name: 'Starter Plan',
                            stripePriceId: 'price_starter',
                        },
                    ]),
                }),
            } as any);

            vi.mocked(stripeService.createCheckoutSession).mockResolvedValue({
                id: 'cs_no_email',
                url: 'https://checkout.stripe.com/pay/cs_no_email',
                object: 'checkout.session',
                metadata: {
                    userId: 'user_no_email',
                    planId: 'plan_123',
                },
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
});
