import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type Stripe from 'stripe';

// Create mocks before imports
vi.mock('../../src/services/stripe', () => ({
    stripeService: {
        createCheckoutSession: vi.fn(),
        getCheckoutSession: vi.fn(),
        verifyWebhookSignature: vi.fn(),
        getSubscription: vi.fn(),
        cancelSubscriptionImmediately: vi.fn(),
    },
}));

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
    subscriptions: {},
    stripeWebhookEvents: { eventId: 'event_id', eventType: 'event_type' },
}));

vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), quit: vi.fn() },
}));

vi.mock('../../src/config', () => ({
    config: {
        frontendUrl: 'http://localhost:3001',
        stripe: {
            webhookSecret: 'whsec_test',
        },
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    sql: vi.fn(),
}));

// Import after mocking
import { PaymentController } from '../../src/controllers/payment';
import { stripeService } from '../../src/services/stripe';
import { db } from '../../src/db';

describe('Payment Controller', () => {
    let paymentController: PaymentController;
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
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
                log: { error: vi.fn() },
            };
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

        it('should fall back to monthly price when yearly is not configured', async () => {
            mockRequest.body = { planId: 'plan_123', billingInterval: 'year' };

            const mockUser = { id: 'user_123', email: 'test@example.com' };
            const mockPlan = {
                id: 'plan_123',
                name: 'Starter',
                stripePriceId: 'price_monthly',
                stripeYearlyPriceId: null,
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
                    values: vi.fn().mockResolvedValue([]),
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

            const mockDb = vi.mocked(db);
            mockDb.update.mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{ id: 'sub_db_123' }]),
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

            // Verify logging indicates existing subscriber
            expect(mockRequest.log?.info).toHaveBeenCalledWith(
                expect.objectContaining({ existingPlanId: 'plan_starter' }),
                'Existing subscriber - no trial on plan change'
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
});

