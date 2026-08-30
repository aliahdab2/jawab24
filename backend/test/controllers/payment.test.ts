import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type Stripe from 'stripe';

// Create mocks before imports
vi.mock('../../src/services/stripe', () => ({
    stripeService: {
        createCheckoutSession: vi.fn(),
        createHostedCheckoutSession: vi.fn(),
        getCheckoutSession: vi.fn(),
        verifyWebhookSignature: vi.fn(),
        getSubscription: vi.fn(),
        cancelSubscriptionImmediately: vi.fn(),
        cancelSubscription: vi.fn(),
        updateSubscriptionPrice: vi.fn(),
        findOrCreateCustomer: vi.fn(),
        createTopupPaymentIntent: vi.fn(),
        createSubscriptionIntent: vi.fn(),
    },
    DemoUserStripeError: class DemoUserStripeError extends Error {
        code = 'DEMO_USER_STRIPE_BLOCKED';
        constructor() {
            super('Demo accounts cannot create Stripe customers or subscriptions');
            this.name = 'DemoUserStripeError';
        }
    },
    stripeRefId: (ref: string | { id: string } | null | undefined) =>
        !ref ? null : typeof ref === 'string' ? ref : ref.id,
}));

// The marketplace guard's only DB-touching dependency, stubbed so the REAL
// resolveMarketplaceBilling runs in these tests. Mocking the store lookup rather
// than the resolver keeps the row-based rails (Shopify, Zid) exercised end to
// end through the controller — including the order the rails are asked in —
// while services/marketplaceBilling.test.ts pins the rule itself.
// Defaults to "no marketplace stores" so no pre-existing case changes behaviour.
// In production these two are ONE query: `hasActiveStoreForBillingSubject` is
// literally `getActiveStoreForBillingSubject(...) !== null`. So the second is
// DERIVED from the first here — a flat pair of independent stubs models a state
// production cannot reach (a merchant who "has" a store that cannot be fetched),
// and that is exactly what broke this suite: #983 moved the Zid verdict from
// `has…` to `getActive…`, so tests that flip only `has…` stopped seeing a Zid
// merchant. A factory mock is also exhaustive — omitting an export the module
// under test imports makes vitest throw on the binding, which surfaces as every
// handler returning 500 rather than as a mock error.
const ecommerceMock = vi.hoisted(() => {
    const hasActiveStoreForBillingSubject = vi.fn(async (_platform: string, _userId: string) => false);
    const getActiveStoreForBillingSubject = vi.fn(async (platform: string, userId: string) =>
        (await hasActiveStoreForBillingSubject(platform, userId))
            ? { id: `store_${platform}`, platformData: { merchantId: 'zid_merchant_1' } }
            : null,
    );
    return { hasActiveStoreForBillingSubject, getActiveStoreForBillingSubject };
});
vi.mock('../../src/services/ecommerce', () => ecommerceMock);

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve([])),
                innerJoin: vi.fn(() => ({
                    where: vi.fn(() => ({
                        orderBy: vi.fn(() => ({
                            limit: vi.fn(() => Promise.resolve([])),
                        })),
                    })),
                })),
            })),
        })),
        transaction: vi.fn(),
        update: vi.fn(() => ({
            set: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve([])),
            })),
        })),
        insert: vi.fn(() => ({
            values: vi.fn(() => ({
                onConflictDoNothing: vi.fn(() => ({
                    returning: vi.fn(() => Promise.resolve([{ eventId: 'evt_default' }])),
                })),
                onConflictDoUpdate: vi.fn(() => Promise.resolve([])),
            })),
        })),
    },
}));

vi.mock('../../src/db/schema', () => ({
    users: { id: 'id', email: 'email' },
    plans: { id: 'id', stripePriceId: 'stripe_price_id', stripeYearlyPriceId: 'stripe_yearly_price_id' },
    subscriptions: { userId: 'user_id', stripeCustomerId: 'stripe_customer_id', createdAt: 'created_at', externalSubscriptionId: 'external_subscription_id' },
    stripeWebhookEvents: { eventId: 'event_id', eventType: 'event_type' },
    settings: { userId: 'user_id', dashboardLanguage: 'dashboard_language' },
}));


vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), quit: vi.fn() },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        initializeUsagePeriod: vi.fn().mockResolvedValue(undefined),
        invalidateStatusCache: vi.fn().mockResolvedValue(undefined),
        // null = not shopify-billed; the D-G guard (rejectIfShopifyBilled)
        // consults this before every Stripe surface.
        getUserSubscription: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/paymentRequest', () => ({
    paymentRequestService: {
        markPaid: vi.fn().mockResolvedValue(true),
    },
}));

vi.mock('../../src/services/topup', () => ({
    topupService: {
        createPendingStripeTopup: vi.fn().mockResolvedValue(undefined),
        settleStripeTopup: vi.fn(),
        markStripeTopupFailed: vi.fn().mockResolvedValue(undefined),
        reverseStripeTopup: vi.fn().mockResolvedValue({ reversed: false, decremented: false }),
    },
    UnknownTopupPackError: class UnknownTopupPackError extends Error {
        constructor(pack: string) {
            super(`Unknown top-up pack: ${pack}`);
            this.name = 'UnknownTopupPackError';
        }
    },
}));

vi.mock('../../src/config', () => ({
    config: {
        frontendUrl: 'http://localhost:3001',
        stripe: {
            webhookSecret: 'whsec_test',
        },
        topup: {
            enabled: true,
            packs: {
                '5k': { repliesAdded: 5000, priceCents: 4900 },
                '10k': { repliesAdded: 10000, priceCents: 7900 },
            },
            currency: 'usd',
            whatsappNumber: '',
        },
        demo: {
            enabled: false,
            userFacebookId: 'demo_user_jawab24',
            userName: 'Demo User',
            userEmail: 'demo@jawab24.com',
        },
        // Read by the marketplace guard's manage-URL builders. Both are the
        // real-world default (unconfigured), so the verdicts carry no link —
        // which is exactly the state the Zid rail ships in.
        shopify: { appHandle: '' },
        zid: { appMarketUrl: '' },
        salla: { appStoreUrl: '' },
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    sql: vi.fn(),
}));

// Import after mocking
import { PaymentController } from '../../src/controllers/payment';
import { handleCheckoutComplete } from '../../src/controllers/paymentWebhookHandlers';
import { stripeService } from '../../src/services/stripe';
import { topupService } from '../../src/services/topup';
import { db } from '../../src/db';
import { paymentRequestService } from '../../src/services/paymentRequest';
import { config } from '../../src/config';

describe('Payment Controller', () => {
    let paymentController: PaymentController;
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(async () => {
        vi.clearAllMocks();
        // clearAllMocks drains calls but NOT implementations, so a test that
        // connects a marketplace store must not leak into the next one.
        const { hasActiveStoreForBillingSubject } = await import('../../src/services/ecommerce');
        vi.mocked(hasActiveStoreForBillingSubject).mockImplementation(async () => false);
        paymentController = new PaymentController();

        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
    });

    describe('createCheckoutSession', () => {
        beforeEach(() => {
            mockRequest = {
                body: { planId: 'plan_123' },
                user: { userId: 'user_123' },
                geo: { country: 'US' }, // Mock allowed geo for sanctions check
                // info/warn are real on Fastify's logger; the guard logs a
                // Salla refusal through it. Matches the fuller stubs used by
                // the other describe blocks below.
                log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            };
        });

        it('rejects a shopify-billed account with 400 SHOPIFY_BILLED before any Stripe call (D-G)', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValueOnce({
                paymentMethod: 'shopify',
                status: 'active',
            } as never);

            await paymentController.createCheckoutSession(mockRequest, mockReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'SHOPIFY_BILLED' }),
            );
            expect(stripeService.createCheckoutSession).not.toHaveBeenCalled();
        });

        // D-G is a blanket rule: EVERY Stripe surface refuses shopify-billed
        // accounts server-side. One parameterized pin per endpoint so a new
        // handler that forgets the guard shows up as a missing row here.
        it.each([
            ['createSubscriptionIntent', { planId: 'plan_123' }],
            ['changePlan', { planId: 'plan_123' }],
            ['createTopupIntent', { pack: '5k' }],
            ['cancelSubscription', {}],
            ['createBillingPortalSession', {}],
        ] as const)('%s rejects shopify-billed with 400 SHOPIFY_BILLED', async (method, body) => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValueOnce({
                paymentMethod: 'shopify',
                status: 'active',
            } as never);
            mockRequest.body = body;

            await (paymentController[method] as (req: unknown, rep: unknown) => Promise<unknown>)(
                mockRequest, mockReply,
            );

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'SHOPIFY_BILLED' }),
            );
        });

        it('lets a CANCELED shopify mirror through the guard — the merchant is back on the Stripe rail', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValueOnce({
                paymentMethod: 'shopify',
                status: 'canceled',
            } as never);
            // Passes the guard, then 404s on the (unmocked-empty) user lookup —
            // proving the request reached the normal handler body.
            await paymentController.createCheckoutSession(mockRequest, mockReply);

            expect(mockReply.send).not.toHaveBeenCalledWith(
                expect.objectContaining({ code: 'SHOPIFY_BILLED' }),
            );
        });

        it('rejects a Salla merchant with 400 SALLA_BILLED before any Stripe call (Article 5)', async () => {
            const { hasActiveStoreForBillingSubject } = await import('../../src/services/ecommerce');
            vi.mocked(hasActiveStoreForBillingSubject).mockImplementation(async p => p === 'salla');

            await paymentController.createCheckoutSession(mockRequest, mockReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'SALLA_BILLED' }),
            );
            expect(stripeService.createCheckoutSession).not.toHaveBeenCalled();
        });

        // Article 5 is a blanket rule like D-G: EVERY Stripe surface refuses a
        // Salla merchant server-side. Same parameterized shape as the Shopify
        // block above, so a new handler that forgets the guard shows up as a
        // missing row in BOTH tables rather than silently leaking one rail.
        it.each([
            ['createSubscriptionIntent', { planId: 'plan_123' }],
            ['changePlan', { planId: 'plan_123' }],
            ['createTopupIntent', { pack: '5k' }],
            ['cancelSubscription', {}],
            ['createBillingPortalSession', {}],
        ] as const)('%s rejects a Salla merchant with 400 SALLA_BILLED', async (method, body) => {
            const { hasActiveStoreForBillingSubject } = await import('../../src/services/ecommerce');
            vi.mocked(hasActiveStoreForBillingSubject).mockImplementation(async p => p === 'salla');
            mockRequest.body = body;

            await (paymentController[method] as (req: unknown, rep: unknown) => Promise<unknown>)(
                mockRequest, mockReply,
            );

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'SALLA_BILLED' }),
            );
        });

        /**
         * Ordering pin: a Shopify-billed account must be refused as SHOPIFY_BILLED
         * (which carries the admin deep link the UI needs), never as SALLA_BILLED.
         * The two rails can legitimately overlap on one account — a merchant with
         * both stores connected — so the codes must not race.
         */
        it('reports SHOPIFY_BILLED, not SALLA_BILLED, when both rails would apply', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            const { hasActiveStoreForBillingSubject } = await import('../../src/services/ecommerce');
            vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValueOnce({
                paymentMethod: 'shopify',
                status: 'active',
            } as never);
            vi.mocked(hasActiveStoreForBillingSubject).mockImplementation(async () => true);

            await paymentController.createCheckoutSession(mockRequest, mockReply);

            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'SHOPIFY_BILLED' }),
            );
            expect(mockReply.send).not.toHaveBeenCalledWith(
                expect.objectContaining({ code: 'SALLA_BILLED' }),
            );
        });

        it('rejects a Zid merchant with 400 ZID_BILLED before any Stripe call', async () => {
            const { hasActiveStoreForBillingSubject } = await import('../../src/services/ecommerce');
            vi.mocked(hasActiveStoreForBillingSubject).mockImplementation(async p => p === 'zid');

            await paymentController.createCheckoutSession(mockRequest, mockReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'ZID_BILLED' }),
            );
            expect(stripeService.createCheckoutSession).not.toHaveBeenCalled();
        });

        // The Zid App Market's terms are the same shape as D-G and Article 5:
        // EVERY Stripe surface refuses a Zid merchant server-side. Same
        // parameterized shape as the two blocks above, so a new handler that
        // forgets the guard shows up as a missing row in ALL THREE tables.
        it.each([
            ['createSubscriptionIntent', { planId: 'plan_123' }],
            ['changePlan', { planId: 'plan_123' }],
            ['createTopupIntent', { pack: '5k' }],
            ['cancelSubscription', {}],
            ['createBillingPortalSession', {}],
        ] as const)('%s rejects a Zid merchant with 400 ZID_BILLED', async (method, body) => {
            const { hasActiveStoreForBillingSubject } = await import('../../src/services/ecommerce');
            vi.mocked(hasActiveStoreForBillingSubject).mockImplementation(async p => p === 'zid');
            mockRequest.body = body;

            await (paymentController[method] as (req: unknown, rep: unknown) => Promise<unknown>)(
                mockRequest, mockReply,
            );

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'ZID_BILLED' }),
            );
        });

        it('lets a CANCELED zid mirror through the guard — the merchant is back on the Stripe rail', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValueOnce({
                paymentMethod: 'zid',
                status: 'canceled',
            } as never);

            await paymentController.createCheckoutSession(mockRequest, mockReply);

            expect(mockReply.send).not.toHaveBeenCalledWith(
                expect.objectContaining({ code: 'ZID_BILLED' }),
            );
        });

        it('should create checkout session successfully', async () => {
            const mockUser = {
                id: 'user_123',
                email: 'test@example.com',
            };

            const mockPlan = {
                id: 'plan_123',
                name: 'Business',
                stripePriceId: 'price_123',
                trialDays: 0, // Business plan has no trial
            };

            const mockSession = {
                id: 'cs_test_123',
                client_secret: 'cs_test_123_secret',
            };

            // Mock db.select() for user, plan, and existing subscriptions
            const mockDb = vi.mocked(db);
            mockDb.select
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([mockUser]),
                    }),
                } as any)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([mockPlan]),
                    }),
                } as any)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([]), // No existing subscriptions
                    }),
                } as any);

            vi.mocked(stripeService.createCheckoutSession).mockResolvedValue(mockSession as any);

            await paymentController.createCheckoutSession(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
                'user_123',
                'test@example.com',
                'plan_123',
                'price_123',
                expect.stringContaining('/payment/return?session_id='),
                0 // No trial for Business plan
            );

            expect(mockReply.send).toHaveBeenCalledWith({
                sessionId: mockSession.id,
                clientSecret: mockSession.client_secret,
            });
        });

        it('should use yearly Stripe price when billingInterval is year', async () => {
            mockRequest.body = { planId: 'plan_123', billingInterval: 'year' };
            mockRequest.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as any;

            const mockUser = { id: 'user_123', email: 'test@example.com' };
            const mockPlan = {
                id: 'plan_123',
                name: 'Starter',
                stripePriceId: 'price_monthly',
                stripeYearlyPriceId: 'price_yearly',
                trialDays: 30,
            };
            const mockSession = { id: 'cs_test', client_secret: 'cs_test_secret' };

            const mockDb = vi.mocked(db);
            mockDb.select
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mockUser]) }) } as any)
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mockPlan]) }) } as any)
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) } as any);

            vi.mocked(stripeService.createCheckoutSession).mockResolvedValue(mockSession as any);

            await paymentController.createCheckoutSession(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
                'user_123', 'test@example.com', 'plan_123', 'price_yearly',
                expect.any(String), 30
            );
        });

        // The fallback WAS the bug (fixed 2026-08-15): a yearly checkout
        // silently subscribed the merchant to the MONTHLY price while the UI
        // promised an annual total with ~17% off. The controller now refuses.
        it('refuses yearly checkout with YEARLY_NOT_AVAILABLE when yearly is not configured', async () => {
            mockRequest.body = { planId: 'plan_123', billingInterval: 'year' };

            const mockUser = { id: 'user_123', email: 'test@example.com' };
            const mockPlan = {
                id: 'plan_123',
                name: 'Starter',
                stripePriceId: 'price_monthly',
                stripeYearlyPriceId: null,
                trialDays: 0,
            };

            const mockDb = vi.mocked(db);
            // Queue exactly the selects that run: user + plan. The refusal
            // fires before the subscriptions lookup, and an unconsumed
            // once-value would leak into the next test (clearAllMocks drains
            // calls, not once-queues).
            mockDb.select
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mockUser]) }) } as any)
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mockPlan]) }) } as any);

            await paymentController.createCheckoutSession(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({
                error: 'Yearly billing is not available for this plan',
                code: 'YEARLY_NOT_AVAILABLE',
            });
            // Never silently bill the monthly price
            expect(stripeService.createCheckoutSession).not.toHaveBeenCalled();
        });

        it('should default to monthly when billingInterval is invalid', async () => {
            mockRequest.body = { planId: 'plan_123', billingInterval: 'weekly' };

            const mockUser = { id: 'user_123', email: 'test@example.com' };
            const mockPlan = {
                id: 'plan_123',
                name: 'Business',
                stripePriceId: 'price_monthly',
                stripeYearlyPriceId: 'price_yearly',
                trialDays: 0,
            };
            const mockSession = { id: 'cs_test', client_secret: 'cs_test_secret' };

            const mockDb = vi.mocked(db);
            mockDb.select
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mockUser]) }) } as any)
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mockPlan]) }) } as any)
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) } as any);

            vi.mocked(stripeService.createCheckoutSession).mockResolvedValue(mockSession as any);

            await paymentController.createCheckoutSession(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
                'user_123', 'test@example.com', 'plan_123', 'price_monthly',
                expect.any(String), 0
            );
        });

        it('should return 401 if user is not authenticated', async () => {
            mockRequest.user = undefined;

            await paymentController.createCheckoutSession(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(401);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
        });

        it('should return 400 if planId is missing', async () => {
            mockRequest.body = {};

            await paymentController.createCheckoutSession(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Plan ID is required' });
        });

        it('should return 404 if user not found', async () => {
            const mockDb = vi.mocked(db);
            mockDb.select.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValueOnce([]), // User not found
                }),
            } as any);

            await paymentController.createCheckoutSession(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'User not found' });
        });

        it('should return 400 with EMAIL_REQUIRED code if user has no email', async () => {
            const mockUserNoEmail = {
                id: 'user_123',
                email: null, // No email!
            };

            const mockDb = vi.mocked(db);
            mockDb.select.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValueOnce([mockUserNoEmail]),
                }),
            } as any);

            await paymentController.createCheckoutSession(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({
                error: 'Email required',
                message: 'Please add your email address to complete the purchase',
                code: 'EMAIL_REQUIRED',
            });
        });

        it('should return 404 if plan not found', async () => {
            const mockUser = { id: 'user_123', email: 'test@example.com' };

            const mockDb = vi.mocked(db);
            mockDb.select.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn()
                        .mockResolvedValueOnce([mockUser]) // User found
                        .mockResolvedValueOnce([]), // Plan not found
                }),
            } as any);

            await paymentController.createCheckoutSession(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({
                error: 'Plan not found',
            });
        });

        it('should return 400 if plan has no stripePriceId', async () => {
            const mockUser = { id: 'user_123', email: 'test@example.com' };
            const mockPlanWithoutStripeId = {
                id: 'plan_123',
                name: 'Business',
                stripePriceId: null,
            };

            const mockDb = vi.mocked(db);
            mockDb.select.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn()
                        .mockResolvedValueOnce([mockUser])
                        .mockResolvedValueOnce([mockPlanWithoutStripeId]),
                }),
            } as any);

            await paymentController.createCheckoutSession(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({
                error: 'Plan does not have a Stripe Price ID configured',
                code: 'PRICE_NOT_CONFIGURED',
            });
        });

        it('should handle errors gracefully', async () => {
            const mockDb = vi.mocked(db);
            mockDb.select.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockRejectedValue(new Error('Database error')),
                }),
            } as any);

            await paymentController.createCheckoutSession(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({
                error: 'Failed to create checkout session',
            });
        });
    });

    /**
     * Hosted-mode branch (D-040): the native app and the web fallback link
     * request `uiMode: 'hosted'` and get a checkout.stripe.com redirect URL —
     * the path privacy browsers cannot block.
     */
    describe('createCheckoutSession — uiMode: hosted', () => {
        const stageDb = (user: unknown[], plan: unknown[], subs: unknown[]) => {
            const mockDb = vi.mocked(db);
            mockDb.select.mockReset();
            mockDb.select
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(user) }) } as any)
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(plan) }) } as any)
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(subs) }) } as any);
        };
        const USER = { id: 'user_123', email: 'merchant@example.com' };
        const PLAN = { id: 'plan_123', name: 'Business', stripePriceId: 'price_123', trialDays: 0 };

        beforeEach(() => {
            mockRequest = {
                body: { planId: 'plan_123', uiMode: 'hosted' },
                user: { userId: 'user_123' },
                geo: { country: 'LY' },
                log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            } as any;
        });

        it('returns the Stripe redirect URL instead of a client secret', async () => {
            stageDb([USER], [PLAN], []);
            vi.mocked(stripeService.createHostedCheckoutSession).mockResolvedValue({
                sessionId: 'cs_hosted_1',
                url: 'https://checkout.stripe.com/c/pay/cs_hosted_1',
            });

            await paymentController.createCheckoutSession(mockRequest as any, mockReply as FastifyReply);

            expect(stripeService.createHostedCheckoutSession).toHaveBeenCalledWith(
                'user_123',
                'merchant@example.com',
                'plan_123',
                'price_123',
                expect.stringContaining('hosted=1'),   // success_url marks the app-return path
                expect.stringContaining('/pricing'),   // cancel_url
                0,
            );
            expect(stripeService.createCheckoutSession).not.toHaveBeenCalled();
            expect(mockReply.send).toHaveBeenCalledWith({
                sessionId: 'cs_hosted_1',
                url: 'https://checkout.stripe.com/c/pay/cs_hosted_1',
            });
        });

        it('applies the same trial rules as the embedded flow', async () => {
            stageDb([USER], [{ ...PLAN, trialDays: 30 }], []);
            vi.mocked(stripeService.createHostedCheckoutSession).mockResolvedValue({ sessionId: 'cs_1', url: 'https://checkout.stripe.com/x' });

            await paymentController.createCheckoutSession(mockRequest as any, mockReply as FastifyReply);

            expect(stripeService.createHostedCheckoutSession).toHaveBeenCalledWith(
                expect.anything(), expect.anything(), expect.anything(), expect.anything(),
                expect.anything(), expect.anything(),
                30,
            );
        });

        it('is still blocked for a sanctioned country before any Stripe call', async () => {
            (mockRequest as any).geo = { country: 'SY' };

            await paymentController.createCheckoutSession(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(stripeService.createHostedCheckoutSession).not.toHaveBeenCalled();
        });
    });

    describe('handleWebhook', () => {
        beforeEach(() => {
            mockRequest = {
                headers: { 'stripe-signature': 'sig_test' },
                rawBody: Buffer.from('webhook_payload'),
                log: {
                    error: vi.fn(),
                    info: vi.fn(),
                    warn: vi.fn(),
                },
            };
        });

        it('should handle checkout.session.completed event', async () => {
            const mockEvent: Partial<Stripe.Event> = {
                type: 'checkout.session.completed',
                data: {
                    object: {
                        id: 'cs_123',
                        client_reference_id: 'user_123',
                        metadata: {
                            userId: 'user_123',
                            planId: 'plan_456',
                        },
                        subscription: 'sub_123',
                    } as any,
                },
            };

            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);
            vi.mocked(stripeService.getSubscription).mockResolvedValue({
                id: 'sub_123',
                status: 'active',
                customer: 'cus_123',
                current_period_start: 1640000000,
                current_period_end: 1642678400,
                trial_end: null,
            } as any);

            const mockDb = vi.mocked(db);
            // Mock select for existing subscriptions lookup
            mockDb.select.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]), // No existing subscriptions
                }),
            } as any);
            mockDb.insert
                .mockReturnValueOnce({
                    values: vi.fn().mockReturnValue({
                        onConflictDoNothing: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{ eventId: 'cs_123' }]),
                        }),
                    }),
                } as any)
                .mockReturnValueOnce({
                    values: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{ id: 'sub_row_id' }]),
                    }),
                } as any);

            await paymentController.handleWebhook(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(stripeService.verifyWebhookSignature).toHaveBeenCalled();
            expect(stripeService.getSubscription).toHaveBeenCalledWith('sub_123');
            expect(mockRequest.log?.info).toHaveBeenCalledWith('Webhook received: checkout.session.completed');
            expect(mockReply.send).toHaveBeenCalledWith({ received: true });
        });

        // Regression (finding 1b): a refund on a top-up charge must claw back the
        // reply credits. The charge resolves to its top-up row by PaymentIntent and
        // short-circuits the subscription path.
        it('reverses a top-up on charge.refunded (claws back credits)', async () => {
            const mockEvent: Partial<Stripe.Event> = {
                type: 'charge.refunded',
                data: { object: { id: 'ch_1', payment_intent: 'pi_topup_1', customer: 'cus_1', amount_refunded: 4900, currency: 'usd' } as any },
            };
            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);
            vi.mocked(topupService.reverseStripeTopup).mockResolvedValue({ reversed: true, decremented: true });

            const mockDb = vi.mocked(db);
            mockDb.insert.mockReturnValueOnce({
                values: vi.fn().mockReturnValue({
                    onConflictDoNothing: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ eventId: 'evt_refund' }]) }),
                }),
            } as any);
            // If the subscription path were (wrongly) reached, this would be consulted.
            const subSelect = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }) });
            mockDb.select.mockImplementation(subSelect as any);

            await paymentController.handleWebhook(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(topupService.reverseStripeTopup).toHaveBeenCalledWith('pi_topup_1');
            // Short-circuited: subscription lookup never ran.
            expect(subSelect).not.toHaveBeenCalled();
            expect(mockReply.send).toHaveBeenCalledWith({ received: true });
        });

        // Regression (finding 1b): a chargeback must also revoke top-up credits.
        it('reverses a top-up on charge.dispute.created', async () => {
            const mockEvent: Partial<Stripe.Event> = {
                type: 'charge.dispute.created',
                data: { object: { id: 'dp_1', charge: 'ch_2', payment_intent: 'pi_topup_2' } as any },
            };
            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);
            vi.mocked(topupService.reverseStripeTopup).mockResolvedValue({ reversed: true, decremented: true });

            const mockDb = vi.mocked(db);
            mockDb.insert.mockReturnValueOnce({
                values: vi.fn().mockReturnValue({
                    onConflictDoNothing: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ eventId: 'evt_dispute' }]) }),
                }),
            } as any);

            await paymentController.handleWebhook(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(topupService.reverseStripeTopup).toHaveBeenCalledWith('pi_topup_2');
            expect(mockReply.send).toHaveBeenCalledWith({ received: true });
        });

        // Regression: Stripe treats 4xx as a permanent failure and never retries.
        // A handler crash MUST return 5xx so the event is rescheduled — otherwise
        // failed subscription/charge updates are silently dropped forever.
        it('returns 500 when an event handler throws (so Stripe retries)', async () => {
            const mockEvent: Partial<Stripe.Event> = {
                type: 'checkout.session.completed',
                data: {
                    object: {
                        id: 'cs_boom',
                        client_reference_id: 'user_boom',
                        metadata: { userId: 'user_boom', planId: 'plan_boom' },
                        subscription: 'sub_boom',
                    } as any,
                },
            };

            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);
            // Force the handler to throw — simulates a downstream failure (DB, Stripe, etc.).
            vi.mocked(stripeService.getSubscription).mockRejectedValue(new Error('downstream blew up'));

            const mockDb = vi.mocked(db);
            // Idempotency insert succeeds (event marked 'processing').
            mockDb.insert.mockReturnValueOnce({
                values: vi.fn().mockReturnValue({
                    onConflictDoNothing: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{ eventId: 'evt_boom' }]),
                    }),
                }),
            } as any);
            // Subscription lookups inside handleCheckoutComplete.
            mockDb.select.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            await paymentController.handleWebhook(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockRequest.log?.error).toHaveBeenCalled();
        });

        it('should return 400 if signature is missing', async () => {
            mockRequest.headers = {};

            await paymentController.handleWebhook(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({
                error: 'Missing stripe-signature header',
            });
        });

        it('should return 400 for invalid signature', async () => {
            vi.mocked(stripeService.verifyWebhookSignature).mockImplementationOnce(() => {
                throw new Error('Invalid signature');
            });

            await paymentController.handleWebhook(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({
                error: 'Webhook verification failed',
            });
        });

        it('should handle invoice.payment_succeeded event', async () => {
            const mockEvent: Partial<Stripe.Event> = {
                type: 'invoice.payment_succeeded',
                data: {
                    object: {
                        id: 'inv_123',
                        customer: 'cus_123',
                        subscription: 'sub_123',
                    } as any,
                },
            };

            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);
            vi.mocked(stripeService.getSubscription).mockResolvedValue({
                id: 'sub_123',
                current_period_start: 1714402800, // 2026-04-29 17:00:00 UTC
                current_period_end: 1716994800,   // 2026-05-29 17:00:00 UTC
            } as any);

            const mockDb = vi.mocked(db);
            mockDb.update.mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{ id: 'sub_db_123', userId: 'user_123' }]),
                    }),
                }),
            } as any);

            await paymentController.handleWebhook(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockRequest.log?.info).toHaveBeenCalledWith('Webhook received: invoice.payment_succeeded');
            expect(mockReply.send).toHaveBeenCalledWith({ received: true });
        });

        // Regression guard: a renewed subscription must get a fresh usage row
        // aligned with the new Stripe period, otherwise the previous period's
        // counter keeps blocking replies even though status is 'active'.
        it('resets the usage period when invoice.payment_succeeded fires', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.initializeUsagePeriod).mockClear();

            const mockEvent: Partial<Stripe.Event> = {
                type: 'invoice.payment_succeeded',
                data: {
                    object: {
                        id: 'inv_renewal',
                        customer: 'cus_123',
                        subscription: 'sub_renewal',
                    } as any,
                },
            };

            const periodStartUnix = 1714402800; // 2026-04-29 17:00:00 UTC
            const periodEndUnix = 1716994800;   // 2026-05-29 17:00:00 UTC

            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);
            vi.mocked(stripeService.getSubscription).mockResolvedValue({
                id: 'sub_renewal',
                // A real Stripe.Subscription always carries a status, and since
                // 2026-08-18 handlePaymentSucceeded reads it: a paid invoice on
                // a still-unpaid subscription must not activate or reset quota.
                // This is a successful RENEWAL, so the subscription is active.
                status: 'active',
                current_period_start: periodStartUnix,
                current_period_end: periodEndUnix,
            } as any);

            const mockDb = vi.mocked(db);
            mockDb.update.mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{ id: 'sub_db_renewal', userId: 'user_renewal' }]),
                    }),
                }),
            } as any);

            await paymentController.handleWebhook(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(subscriptionsService.initializeUsagePeriod).toHaveBeenCalledTimes(1);
            const [userId, start, end] = vi.mocked(subscriptionsService.initializeUsagePeriod).mock.calls[0];
            expect(userId).toBe('user_renewal');
            expect(start).toEqual(new Date(periodStartUnix * 1000));
            expect(end).toEqual(new Date(periodEndUnix * 1000));
        });

        it('should handle unknown event types', async () => {
            const mockEvent: Partial<Stripe.Event> = {
                type: 'unknown.event.type' as any,
                data: { object: {} as any },
            };

            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);

            await paymentController.handleWebhook(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockRequest.log?.info).toHaveBeenCalledWith('Webhook received: unknown.event.type');
            expect(mockRequest.log?.info).toHaveBeenCalledWith({ eventType: 'unknown.event.type' }, 'Unhandled webhook event type');
            expect(mockReply.send).toHaveBeenCalledWith({ received: true });
        });

        it('should handle customer.subscription.created event', async () => {
            const mockEvent: Partial<Stripe.Event> = {
                type: 'customer.subscription.created',
                data: {
                    object: {
                        id: 'sub_new_123',
                        status: 'active',
                        customer: 'cus_123',
                        current_period_start: 1640000000,
                        current_period_end: 1642678400,
                    } as any,
                },
            };

            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);

            const mockDb = vi.mocked(db);
            // Mock finding existing subscription
            mockDb.select.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ id: 'sub_db_123', status: 'trialing' }]),
                    }),
                }),
            } as any);
            mockDb.update.mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{ id: 'sub_db_123' }]),
                }),
            } as any);

            await paymentController.handleWebhook(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockRequest.log?.info).toHaveBeenCalledWith('Webhook received: customer.subscription.created');
            expect(mockReply.send).toHaveBeenCalledWith({ received: true });
        });
    });

    describe('createCheckoutSession with trial logic', () => {
        beforeEach(() => {
            mockRequest = {
                body: { planId: 'plan_business' },
                user: { userId: 'user_123' },
                log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            };
        });

        it('should skip trial for existing subscriber (upgrade)', async () => {
            const mockUser = { id: 'user_123', email: 'test@example.com' };
            const mockPlan = { id: 'plan_business', name: 'Business', stripePriceId: 'price_biz', trialDays: 0 };
            const mockExistingSubscription = {
                id: 'sub_old',
                status: 'active',
                planId: 'plan_starter',
                externalSubscriptionId: 'sub_ext_old',
            };

            // Add geo mock for sanctions check
            mockRequest.geo = { country: 'US' };

            const mockDb = vi.mocked(db);

            // Mock user lookup
            mockDb.select
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([mockUser]),
                    }),
                } as any)
                // Mock plan lookup
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([mockPlan]),
                    }),
                } as any)
                // Mock existing subscriptions lookup
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([mockExistingSubscription]),
                    }),
                } as any);

            const mockSession = { id: 'cs_test', client_secret: 'cs_test_secret' };
            vi.mocked(stripeService.createCheckoutSession).mockResolvedValue(mockSession as any);

            await paymentController.createCheckoutSession(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            // Verify createCheckoutSession was called with trialDays=0 (no trial)
            expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
                'user_123',
                'test@example.com',
                'plan_business',
                'price_biz',
                expect.any(String),
                0 // No trial for existing subscriber
            );

            // Verify logging indicates an existing/returning subscriber
            expect(mockRequest.log?.info).toHaveBeenCalledWith(
                expect.objectContaining({ priorSubscriptions: 1 }),
                'Existing/returning subscriber - no trial on checkout'
            );
        });

        it('should skip trial for a returning subscriber whose only prior sub is CANCELED (closes re-trial loophole)', async () => {
            const mockUser = { id: 'user_ret', email: 'ret@example.com' };
            const mockPlan = { id: 'plan_starter', name: 'Starter', stripePriceId: 'price_start', trialDays: 30 };
            // A previously-canceled trial — under the old logic this user would have
            // been handed a fresh trial again. Must now be denied.
            const canceledSub = { id: 'sub_old', status: 'canceled', planId: 'plan_starter', externalSubscriptionId: null };

            mockRequest.user = { userId: 'user_ret' };
            mockRequest.body = { planId: 'plan_starter' };
            mockRequest.geo = { country: 'US' };

            const mockDb = vi.mocked(db);
            mockDb.select
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mockUser]) }) } as any)
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mockPlan]) }) } as any)
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([canceledSub]) }) } as any);

            vi.mocked(stripeService.createCheckoutSession).mockResolvedValue({ id: 'cs_test', client_secret: 'cs_test_secret' } as any);

            await paymentController.createCheckoutSession(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
                'user_ret',
                'ret@example.com',
                'plan_starter',
                'price_start',
                expect.any(String),
                0 // No fresh trial — they already had one on this account
            );
        });

        it('should give trial to new user on eligible plan', async () => {
            const mockUser = { id: 'user_new', email: 'new@example.com' };
            const mockPlan = { id: 'plan_starter', name: 'Starter', stripePriceId: 'price_start', trialDays: 30 };

            const mockDb = vi.mocked(db);

            mockRequest.user = { userId: 'user_new' };
            mockRequest.body = { planId: 'plan_starter' };
            mockRequest.geo = { country: 'US' }; // Add geo mock for sanctions check

            mockDb.select
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([mockUser]),
                    }),
                } as any)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([mockPlan]),
                    }),
                } as any)
                // No existing subscriptions
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([]),
                    }),
                } as any);

            const mockSession = { id: 'cs_trial', client_secret: 'cs_trial_secret' };
            vi.mocked(stripeService.createCheckoutSession).mockResolvedValue(mockSession as any);

            await paymentController.createCheckoutSession(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            // Verify trial days passed correctly
            expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
                'user_new',
                'new@example.com',
                'plan_starter',
                'price_start',
                expect.any(String),
                30 // 30 day trial from plan
            );

            expect(mockRequest.log?.info).toHaveBeenCalledWith(
                expect.objectContaining({ trialDays: 30 }),
                'New user eligible for trial'
            );
        });
    });

    // ── changePlan ───────────────────────────────────────────────────────────
    // TODO: these tests trip a vitest mock-resolution issue with drizzle-orm
    // (`desc` resolves to the global mock from a sibling test file, not this
    // file's). Skipped until the suite's drizzle-orm mocking strategy is
    // unified. The endpoint behavior is covered manually via the Stripe test
    // workflow described in the plan's Verification section.

    describe.skip('changePlan', () => {
        beforeEach(() => {
            mockRequest = {
                body: { planId: 'plan_pro', billingInterval: 'month' },
                user: { userId: 'user_123' },
                log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
            } as any;
        });

        it('calls stripe.subscriptions.update with proration when an active Stripe sub exists', async () => {
            const mockDb = vi.mocked(db);
            // 1st select: plans lookup
            // 2nd select: user subscriptions
            mockDb.select
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{ id: 'plan_pro', stripePriceId: 'price_pro_m', stripeYearlyPriceId: 'price_pro_y' }]),
                    }),
                } as any)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: vi.fn().mockResolvedValue([
                                { id: 'sub_active', planId: 'plan_starter', status: 'active', externalSubscriptionId: 'sub_stripe_1' },
                                { id: 'sub_old', planId: 'plan_starter', status: 'canceled', externalSubscriptionId: 'sub_stripe_0' },
                            ]),
                        }),
                    }),
                } as any);

            mockDb.update.mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            vi.mocked(stripeService.updateSubscriptionPrice).mockResolvedValue({
                id: 'sub_stripe_1',
                status: 'active',
                cancel_at_period_end: false,
                current_period_start: 1700000000,
                current_period_end: 1702592000,
            } as any);

            await paymentController.changePlan(mockRequest as any, mockReply as FastifyReply);

            expect(stripeService.updateSubscriptionPrice).toHaveBeenCalledWith('sub_stripe_1', 'price_pro_m');
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ success: true })
            );
        });

        it('returns 400 when the user has no active Stripe-backed subscription', async () => {
            const mockDb = vi.mocked(db);
            mockDb.select
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{ id: 'plan_pro', stripePriceId: 'price_pro_m' }]),
                    }),
                } as any)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: vi.fn().mockResolvedValue([
                                // Manual/orphan row — active status, no externalSubscriptionId.
                                { id: 'sub_orphan', planId: 'plan_business', status: 'active', externalSubscriptionId: null },
                            ]),
                        }),
                    }),
                } as any);

            await paymentController.changePlan(mockRequest as any, mockReply as FastifyReply);

            expect(stripeService.updateSubscriptionPrice).not.toHaveBeenCalled();
            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'NO_STRIPE_SUBSCRIPTION' })
            );
        });

        it('returns 400 when the user is already on the requested plan', async () => {
            const mockDb = vi.mocked(db);
            mockDb.select
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{ id: 'plan_pro', stripePriceId: 'price_pro_m' }]),
                    }),
                } as any)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: vi.fn().mockResolvedValue([
                                { id: 'sub_1', planId: 'plan_pro', status: 'active', externalSubscriptionId: 'sub_stripe_1' },
                            ]),
                        }),
                    }),
                } as any);

            await paymentController.changePlan(mockRequest as any, mockReply as FastifyReply);

            expect(stripeService.updateSubscriptionPrice).not.toHaveBeenCalled();
            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'SAME_PLAN' })
            );
        });
    });

    // ── createTopupIntent ─────────────────────────────────────────────────────

    /**
     * The LIVE subscribe endpoint. Before 2026-07-25 it appeared in zero test
     * files — the checkout every paying merchant uses had no controller
     * coverage at all, while the legacy Checkout Session path beside it was
     * tested exhaustively. That asymmetry is how a merchant could be charged
     * and never activated with the suite fully green.
     */
    describe('createSubscriptionIntent', () => {
        const stageDb = (user: unknown[], plan: unknown[], subs: unknown[]) => {
            const mockDb = vi.mocked(db);
            mockDb.select
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(user) }) } as any)
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(plan) }) } as any)
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(subs) }) } as any);
        };
        const USER = { id: 'user_123', email: 'merchant@example.com' };
        const PLAN = { id: 'plan_123', name: 'Business', stripePriceId: 'price_123', trialDays: 0 };

        beforeEach(() => {
            // Guard tests short-circuit before consuming every staged
            // mockReturnValueOnce, and vi.clearAllMocks() does NOT drain a
            // once-queue — leftovers would surface as the NEXT test's first
            // db.select(). Reset to a clean default so each test is isolated
            // (this leaked into the createTopupIntent suite before it was fixed).
            vi.mocked(db.select).mockReset();
            vi.mocked(db.select).mockImplementation(() => ({
                from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
            }) as any);

            mockRequest = {
                body: { planId: 'plan_123' },
                user: { userId: 'user_123' },
                geo: { country: 'LY' },
                log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            } as any;
        });

        // The metadata asserted here is load-bearing: it is the ONLY thing that
        // later lets a webhook find the local row (see subscriptionLinking.ts).
        it('passes userId and planId so the subscription can be linked later', async () => {
            stageDb([USER], [PLAN], []);
            vi.mocked(stripeService.findOrCreateCustomer).mockResolvedValue('cus_1');
            vi.mocked(stripeService.createSubscriptionIntent).mockResolvedValue({
                subscriptionId: 'sub_1', clientSecret: 'pi_1_secret', type: 'payment',
            } as any);

            await paymentController.createSubscriptionIntent(mockRequest as any, mockReply as FastifyReply);

            expect(stripeService.createSubscriptionIntent).toHaveBeenCalledWith(
                expect.objectContaining({ userId: 'user_123', planId: 'plan_123', customerId: 'cus_1' }),
            );
            expect(mockReply.send).toHaveBeenCalledWith({
                clientSecret: 'pi_1_secret', type: 'payment', subscriptionId: 'sub_1',
            });
        });

        it('reuses the Stripe customer already on a prior subscription', async () => {
            stageDb([USER], [PLAN], [{ id: 's1', status: 'canceled', stripeCustomerId: 'cus_existing' }]);
            vi.mocked(stripeService.createSubscriptionIntent).mockResolvedValue({
                subscriptionId: 'sub_2', clientSecret: 'pi_2_secret', type: 'payment',
            } as any);

            await paymentController.createSubscriptionIntent(mockRequest as any, mockReply as FastifyReply);

            expect(stripeService.findOrCreateCustomer).not.toHaveBeenCalled();
            expect(stripeService.createSubscriptionIntent).toHaveBeenCalledWith(
                expect.objectContaining({ customerId: 'cus_existing' }),
            );
        });

        // Re-trial loophole: any prior subscription history means no fresh trial.
        it('gives no trial days to a returning subscriber', async () => {
            stageDb([USER], [{ ...PLAN, trialDays: 30 }], [{ id: 's1', status: 'canceled' }]);
            vi.mocked(stripeService.findOrCreateCustomer).mockResolvedValue('cus_1');
            vi.mocked(stripeService.createSubscriptionIntent).mockResolvedValue({
                subscriptionId: 'sub_3', clientSecret: 'pi_3_secret', type: 'setup',
            } as any);

            await paymentController.createSubscriptionIntent(mockRequest as any, mockReply as FastifyReply);

            expect(stripeService.createSubscriptionIntent).toHaveBeenCalledWith(
                expect.objectContaining({ trialDays: 0 }),
            );
        });

        it('gives the plan trial to a brand-new account', async () => {
            stageDb([USER], [{ ...PLAN, trialDays: 30 }], []);
            vi.mocked(stripeService.findOrCreateCustomer).mockResolvedValue('cus_1');
            vi.mocked(stripeService.createSubscriptionIntent).mockResolvedValue({
                subscriptionId: 'sub_4', clientSecret: 'seti_secret', type: 'setup',
            } as any);

            await paymentController.createSubscriptionIntent(mockRequest as any, mockReply as FastifyReply);

            expect(stripeService.createSubscriptionIntent).toHaveBeenCalledWith(
                expect.objectContaining({ trialDays: 30 }),
            );
        });

        it('uses the yearly price when billingInterval is year', async () => {
            (mockRequest as any).body = { planId: 'plan_123', billingInterval: 'year' };
            stageDb([USER], [{ ...PLAN, stripeYearlyPriceId: 'price_yearly' }], []);
            vi.mocked(stripeService.findOrCreateCustomer).mockResolvedValue('cus_1');
            vi.mocked(stripeService.createSubscriptionIntent).mockResolvedValue({
                subscriptionId: 'sub_5', clientSecret: 'pi_5_secret', type: 'payment',
            } as any);

            await paymentController.createSubscriptionIntent(mockRequest as any, mockReply as FastifyReply);

            expect(stripeService.createSubscriptionIntent).toHaveBeenCalledWith(
                expect.objectContaining({ priceId: 'price_yearly' }),
            );
        });

        // Guards — every one of these must short-circuit BEFORE Stripe is touched.
        it('blocks a sanctioned country before any Stripe call', async () => {
            (mockRequest as any).geo = { country: 'SY' };

            await paymentController.createSubscriptionIntent(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'SANCTIONED_GEO_BLOCK' }),
            );
            expect(stripeService.createSubscriptionIntent).not.toHaveBeenCalled();
        });

        it('blocks an unresolved geo (fail-closed)', async () => {
            (mockRequest as any).geo = { country: undefined };

            await paymentController.createSubscriptionIntent(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'GEO_VERIFICATION_REQUIRED' }),
            );
            expect(stripeService.createSubscriptionIntent).not.toHaveBeenCalled();
        });

        it('returns 401 when unauthenticated', async () => {
            (mockRequest as any).user = undefined;

            await paymentController.createSubscriptionIntent(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(401);
        });

        it('returns 400 when planId is missing', async () => {
            (mockRequest as any).body = {};

            await paymentController.createSubscriptionIntent(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
        });

        it('returns EMAIL_REQUIRED when the account has no email', async () => {
            stageDb([{ id: 'user_123', email: null }], [PLAN], []);

            await paymentController.createSubscriptionIntent(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'EMAIL_REQUIRED' }),
            );
        });

        it('returns 404 when the plan does not exist', async () => {
            stageDb([USER], [], []);

            await paymentController.createSubscriptionIntent(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(404);
        });

        it('returns 400 when the plan has no Stripe price configured', async () => {
            stageDb([USER], [{ ...PLAN, stripePriceId: null }], []);

            await paymentController.createSubscriptionIntent(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
        });

        it('does not leak internals when Stripe throws', async () => {
            stageDb([USER], [PLAN], []);
            vi.mocked(stripeService.findOrCreateCustomer).mockResolvedValue('cus_1');
            vi.mocked(stripeService.createSubscriptionIntent).mockRejectedValue(new Error('stripe exploded'));

            await paymentController.createSubscriptionIntent(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to create subscription' });
        });
    });

    describe('createTopupIntent', () => {
        beforeEach(() => {
            mockRequest = {
                body: { pack: '5k' },
                user: { userId: 'user_123' },
                geo: { country: 'US' }, // allowed geo for the sanctions gate
                log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            };
        });

        it('returns 401 when not authenticated', async () => {
            mockRequest.user = undefined;
            await paymentController.createTopupIntent(mockRequest as FastifyRequest, mockReply as FastifyReply);
            expect(mockReply.status).toHaveBeenCalledWith(401);
        });

        it('returns 403 TOPUP_DISABLED (kill-switch) before any Stripe call', async () => {
            config.topup.enabled = false;
            try {
                await paymentController.createTopupIntent(mockRequest as FastifyRequest, mockReply as FastifyReply);
                expect(mockReply.status).toHaveBeenCalledWith(403);
                expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOPUP_DISABLED' }));
                expect(stripeService.createTopupPaymentIntent).not.toHaveBeenCalled();
                expect(topupService.createPendingStripeTopup).not.toHaveBeenCalled();
            } finally {
                config.topup.enabled = true;
            }
        });

        it('blocks a sanctioned jurisdiction with 403 before any Stripe call', async () => {
            mockRequest.geo = { country: 'IR' }; // Iran — sanctioned
            await paymentController.createTopupIntent(mockRequest as FastifyRequest, mockReply as FastifyReply);
            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'SANCTIONED_GEO_BLOCK' }));
            expect(stripeService.createTopupPaymentIntent).not.toHaveBeenCalled();
            expect(topupService.createPendingStripeTopup).not.toHaveBeenCalled();
        });

        it('rejects an unknown pack with 400 INVALID_PACK before any Stripe call', async () => {
            mockRequest.body = { pack: 'bogus' };
            await paymentController.createTopupIntent(mockRequest as FastifyRequest, mockReply as FastifyReply);
            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_PACK' }));
            expect(stripeService.createTopupPaymentIntent).not.toHaveBeenCalled();
        });

        it('returns EMAIL_REQUIRED when the user has no email', async () => {
            const mockDb = vi.mocked(db);
            mockDb.select.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ id: 'user_123', email: null }]) }),
            } as any);

            await paymentController.createTopupIntent(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'EMAIL_REQUIRED' }));
        });

        it('creates a PaymentIntent + pending row and returns the clientSecret', async () => {
            const mockDb = vi.mocked(db);
            mockDb.select
                // user lookup
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ id: 'user_123', email: 'u@example.com' }]) }) } as any)
                // existing subscriptions (no Stripe customer yet)
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) } as any);

            vi.mocked(stripeService.findOrCreateCustomer).mockResolvedValue('cus_1');
            vi.mocked(stripeService.createTopupPaymentIntent).mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret' } as any);
            vi.mocked(topupService.createPendingStripeTopup).mockResolvedValue(undefined);

            await paymentController.createTopupIntent(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(stripeService.createTopupPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({
                customerId: 'cus_1',
                amountCents: 4900, // 5k pack price from config
                currency: 'usd',
                userId: 'user_123',
                pack: '5k',
            }));
            expect(topupService.createPendingStripeTopup).toHaveBeenCalledWith({
                userId: 'user_123',
                pack: '5k',
                stripePaymentIntentId: 'pi_1',
            });
            expect(mockReply.send).toHaveBeenCalledWith({ clientSecret: 'pi_1_secret' });
        });

        it('reuses the existing Stripe customer from a subscription', async () => {
            const mockDb = vi.mocked(db);
            mockDb.select
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ id: 'user_123', email: 'u@example.com' }]) }) } as any)
                .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ stripeCustomerId: 'cus_existing' }]) }) } as any);

            vi.mocked(stripeService.createTopupPaymentIntent).mockResolvedValue({ id: 'pi_2', client_secret: 'pi_2_secret' } as any);

            await paymentController.createTopupIntent(mockRequest as FastifyRequest, mockReply as FastifyReply);

            // Must NOT create a new customer when one already exists.
            expect(stripeService.findOrCreateCustomer).not.toHaveBeenCalled();
            expect(stripeService.createTopupPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_existing' }));
        });
    });

    // ── handleWebhook: top-up payment_intent.succeeded ─────────────────────────
    describe('handleWebhook — top-up PaymentIntent', () => {
        beforeEach(() => {
            mockRequest = {
                headers: { 'stripe-signature': 'sig_test' },
                rawBody: Buffer.from('webhook_payload'),
                log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            };
        });

        it('credits the balance on payment_intent.succeeded tagged type=topup', async () => {
            const mockEvent: Partial<Stripe.Event> = {
                id: 'evt_pi_topup',
                type: 'payment_intent.succeeded',
                data: { object: { id: 'pi_topup_1', metadata: { type: 'topup', userId: 'user_123', pack: '5k' } } as any },
            };
            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);
            vi.mocked(topupService.settleStripeTopup).mockResolvedValue({
                credited: true, alreadySettled: false, userId: 'user_123', repliesAdded: 5000, newBalance: 5000,
            });

            await paymentController.handleWebhook(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(topupService.settleStripeTopup).toHaveBeenCalledWith('pi_topup_1');
            const { notificationService } = await import('../../src/services/notifications');
            expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith(
                'user_123', 'topup_credited', expect.objectContaining({ replies: '5000' }), expect.any(Object)
            );
            expect(mockReply.send).toHaveBeenCalledWith({ received: true });
        });

        it('ignores a payment_intent.succeeded that is NOT a top-up (subscription invoice PI)', async () => {
            const mockEvent: Partial<Stripe.Event> = {
                id: 'evt_pi_sub',
                type: 'payment_intent.succeeded',
                data: { object: { id: 'pi_sub_1', metadata: {} } as any }, // no type=topup
            };
            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);

            await paymentController.handleWebhook(mockRequest as FastifyRequest, mockReply as FastifyReply);

            // The guard must short-circuit before touching the top-up service.
            expect(topupService.settleStripeTopup).not.toHaveBeenCalled();
            expect(mockReply.send).toHaveBeenCalledWith({ received: true });
        });

        it('treats a replayed top-up succeeded event as a no-op (no double notification)', async () => {
            const mockEvent: Partial<Stripe.Event> = {
                id: 'evt_pi_replay',
                type: 'payment_intent.succeeded',
                data: { object: { id: 'pi_topup_replay', metadata: { type: 'topup', userId: 'user_123', pack: '5k' } } as any },
            };
            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);
            vi.mocked(topupService.settleStripeTopup).mockResolvedValue({ credited: false, alreadySettled: true });

            const { notificationService } = await import('../../src/services/notifications');
            vi.mocked(notificationService.sendTemplateNotification).mockClear();

            await paymentController.handleWebhook(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(notificationService.sendTemplateNotification).not.toHaveBeenCalled();
            expect(mockReply.send).toHaveBeenCalledWith({ received: true });
        });

        it('does NOT mark the row failed on payment_intent.payment_failed — the PI is retryable (type=topup)', async () => {
            // Regression: a single PaymentIntent fires payment_intent.payment_failed
            // on a declined attempt and then payment_intent.succeeded when the
            // customer retries on the SAME PI. Marking the row 'failed' here would
            // block settleStripeTopup from crediting the retry — money captured, no
            // replies, and reconcile (pending-only) can't self-heal. So this event
            // must be non-destructive: leave the row open for the retry/reconcile.
            const mockEvent: Partial<Stripe.Event> = {
                id: 'evt_pi_failed',
                type: 'payment_intent.payment_failed',
                data: { object: { id: 'pi_topup_failed', metadata: { type: 'topup', userId: 'user_123', pack: '5k' } } as any },
            };
            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);

            await paymentController.handleWebhook(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(topupService.markStripeTopupFailed).not.toHaveBeenCalled();
            expect(topupService.settleStripeTopup).not.toHaveBeenCalled();
            expect(mockReply.send).toHaveBeenCalledWith({ received: true });
        });
    });

    // ── handleWebhook: cache invalidation + planId-from-priceId + charge.refunded ──
    // TODO: same drizzle-orm mock resolution issue as changePlan above.
    describe.skip('handleWebhook side effects', () => {
        beforeEach(() => {
            mockRequest = {
                headers: { 'stripe-signature': 'sig_test' },
                rawBody: Buffer.from('webhook_payload'),
                log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            };
        });

        it('invalidates the status cache when a subscription is updated, and resolves planId from priceId', async () => {
            const mockEvent: Partial<Stripe.Event> = {
                id: 'evt_sub_updated',
                type: 'customer.subscription.updated',
                data: {
                    object: {
                        id: 'sub_stripe_1',
                        status: 'active',
                        current_period_start: 1700000000,
                        current_period_end: 1702592000,
                        cancel_at_period_end: false,
                        items: { data: [{ price: { id: 'price_pro_m' } }] },
                    } as any,
                },
            };
            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);

            const mockDb = vi.mocked(db);
            mockDb.insert.mockReturnValueOnce({
                values: vi.fn().mockReturnValue({
                    onConflictDoNothing: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{ eventId: 'evt_sub_updated' }]),
                    }),
                }),
            } as any);
            // 1st select inside handleSubscriptionUpdated: plans lookup by priceId.
            mockDb.select.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ id: 'plan_pro' }]),
                    }),
                }),
            } as any);
            mockDb.update.mockReturnValueOnce({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{ id: 'sub_db_1', userId: 'user_42' }]),
                    }),
                }),
            } as any).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            const { subscriptionsService } = await import('../../src/services/subscriptions');

            await paymentController.handleWebhook(mockRequest as FastifyRequest, mockReply as FastifyReply);

            // The handler must have set the resolved planId on the row.
            const setCall = mockDb.update.mock.results[0].value.set;
            expect(setCall).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan_pro' }));
            // And invalidated the status cache for the affected user.
            expect(subscriptionsService.invalidateStatusCache).toHaveBeenCalledWith('user_42');
        });

        it('logs and notifies on charge.refunded', async () => {
            const mockEvent: Partial<Stripe.Event> = {
                id: 'evt_charge_refunded',
                type: 'charge.refunded',
                data: {
                    object: {
                        id: 'ch_123',
                        customer: 'cus_42',
                        amount_refunded: 1500,
                        currency: 'usd',
                    } as any,
                },
            };
            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);

            const mockDb = vi.mocked(db);
            mockDb.insert.mockReturnValueOnce({
                values: vi.fn().mockReturnValue({
                    onConflictDoNothing: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{ eventId: 'evt_charge_refunded' }]),
                    }),
                }),
            } as any);
            mockDb.select.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([{ userId: 'user_42' }]),
                        }),
                    }),
                }),
            } as any);
            mockDb.update.mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            const { notificationService } = await import('../../src/services/notifications');

            await paymentController.handleWebhook(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith(
                'user_42',
                'refund_processed',
                expect.objectContaining({ amount: '15.00', currency: 'USD' }),
                expect.any(Object)
            );
        });
    });

    describe('handleCheckoutComplete — manual_payment routing (collect-only)', () => {
        const request = { log: { info: vi.fn(), error: vi.fn() } } as unknown as FastifyRequest;

        it('routes a paid manual_payment session to markPaid and skips subscription logic', async () => {
            const session = {
                id: 'cs_manual_1',
                payment_status: 'paid',
                payment_intent: 'pi_manual_1',
                metadata: { type: 'manual_payment', userId: 'user_1', paymentRequestId: 'pr_1' },
            } as unknown as Stripe.Checkout.Session;

            // Handler is the routing point under test.
            await handleCheckoutComplete(session, request);

            expect(paymentRequestService.markPaid).toHaveBeenCalledWith('cs_manual_1', 'pi_manual_1');
            // Must NOT fall through to the subscription path.
            expect(stripeService.getSubscription).not.toHaveBeenCalled();
        });

        it('does NOT mark paid when the manual_payment session is not yet paid', async () => {
            const session = {
                id: 'cs_manual_2',
                payment_status: 'unpaid',
                metadata: { type: 'manual_payment', userId: 'user_1', paymentRequestId: 'pr_2' },
            } as unknown as Stripe.Checkout.Session;

            await handleCheckoutComplete(session, request);

            expect(paymentRequestService.markPaid).not.toHaveBeenCalled();
            expect(stripeService.getSubscription).not.toHaveBeenCalled();
        });
    });
});

