import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type Stripe from 'stripe';

// Create mocks before imports
vi.mock('../../src/services/stripe', () => ({
    stripeService: {
        createCheckoutSession: vi.fn(),
        verifyWebhookSignature: vi.fn(),
        getSubscription: vi.fn(),
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
                onConflictDoUpdate: vi.fn(() => Promise.resolve([])),
            })),
        })),
    },
}));

vi.mock('../../src/db/schema', () => ({
    users: { id: 'id', email: 'email' },
    plans: { id: 'id', stripePriceId: 'stripe_price_id' },
    subscriptions: {},
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
                user: { userId: 'user_123', facebookId: 'fb_123' },
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
            };

            const mockSession = {
                id: 'cs_test_123',
                url: 'https://checkout.stripe.com/pay/cs_test_123',
            };

            // Mock db.select().from(users).where() to return user
            const mockDb = vi.mocked(db);
            mockDb.select.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn()
                        .mockResolvedValueOnce([mockUser]) // First call for user
                        .mockResolvedValueOnce([mockPlan]), // Second call for plan
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
                expect.stringContaining('/payment/success?session_id='),
                expect.stringContaining('/payment/cancel')
            );

            expect(mockReply.send).toHaveBeenCalledWith({
                sessionId: mockSession.id,
                url: mockSession.url,
            });
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
            mockDb.insert.mockReturnValue({
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
            vi.mocked(stripeService.verifyWebhookSignature).mockImplementation(() => {
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
                        customer: 'cus_123',
                        subscription: 'sub_123',
                    } as any,
                },
            };

            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);

            const mockDb = vi.mocked(db);
            mockDb.update.mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
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
    });
});

