import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type Stripe from 'stripe';

// Create mocks before imports
vi.mock('../../src/services/stripe', () => ({
    stripeService: {
        createCheckoutSession: vi.fn(),
        verifyWebhookSignature: vi.fn(),
    },
}));

vi.mock('../../src/db', () => ({
    db: {
        query: {
            plans: {
                findFirst: vi.fn(),
            },
        },
        transaction: vi.fn(),
        update: vi.fn(),
        insert: vi.fn(),
    },
}));

vi.mock('../../src/config', () => ({
    config: {
        frontendUrl: 'http://localhost:3001',
        stripe: {
            webhookSecret: 'whsec_test',
        },
    },
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
                user: { id: 'user_123', email: 'test@example.com' },
                log: { error: vi.fn() },
            };
        });

        it('should create checkout session successfully', async () => {
            const mockPlan = {
                id: 'plan_123',
                name: 'Business',
                stripePriceId: 'price_123',
            };

            const mockSession = {
                id: 'cs_test_123',
                url: 'https://checkout.stripe.com/pay/cs_test_123',
            };

            vi.mocked(db.query.plans.findFirst).mockResolvedValue(mockPlan);
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

            expect(mockReply.send).toHaveBeenCalledWith({ url: mockSession.url });
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
            vi.mocked(db.query.plans.findFirst).mockResolvedValue(null);

            await paymentController.createCheckoutSession(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({
                error: 'Plan not found or missing Stripe Price ID',
            });
        });

        it('should return 404 if plan has no stripePriceId', async () => {
            vi.mocked(db.query.plans.findFirst).mockResolvedValue({
                id: 'plan_123',
                name: 'Business',
                stripePriceId: null,
            });

            await paymentController.createCheckoutSession(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(404);
        });

        it('should handle errors gracefully', async () => {
            vi.mocked(db.query.plans.findFirst).mockRejectedValue(new Error('Database error'));

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

    describe('handleStripeWebhook', () => {
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
                        metadata: {
                            userId: 'user_123',
                            planId: 'plan_456',
                        },
                        customer: 'cus_123',
                        subscription: 'sub_123',
                    } as any,
                },
            };

            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);

            const mockTx = {
                update: vi.fn().mockReturnValue({
                    set: vi.fn().mockReturnValue({
                        where: vi.fn(),
                    }),
                }),
                insert: vi.fn().mockReturnValue({
                    values: vi.fn().mockReturnValue({
                        onConflictDoUpdate: vi.fn(),
                    }),
                }),
            };

            vi.mocked(db.transaction).mockImplementation(async (callback: any) => {
                return await callback(mockTx);
            });

            await paymentController.handleStripeWebhook(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(stripeService.verifyWebhookSignature).toHaveBeenCalled();
            expect(db.transaction).toHaveBeenCalled();
            expect(mockReply.status).toHaveBeenCalledWith(200);
            expect(mockReply.send).toHaveBeenCalledWith({ received: true });
        });

        it('should return 400 if signature is missing', async () => {
            mockRequest.headers = {};

            await paymentController.handleStripeWebhook(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                'Webhook Error: No Stripe-Signature or payload'
            );
        });

        it('should return 400 for invalid signature', async () => {
            vi.mocked(stripeService.verifyWebhookSignature).mockImplementation(() => {
                throw new Error('Invalid signature');
            });

            await paymentController.handleStripeWebhook(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.stringContaining('Webhook Error')
            );
        });

        it('should handle invoice.payment_succeeded event', async () => {
            const mockEvent: Partial<Stripe.Event> = {
                type: 'invoice.payment_succeeded',
                data: {
                    object: {
                        customer: 'cus_123',
                    } as any,
                },
            };

            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);

            await paymentController.handleStripeWebhook(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockRequest.log?.info).toHaveBeenCalledWith(
                expect.stringContaining('Invoice payment succeeded')
            );
            expect(mockReply.status).toHaveBeenCalledWith(200);
        });

        it('should handle unknown event types', async () => {
            const mockEvent: Partial<Stripe.Event> = {
                type: 'unknown.event.type' as any,
                data: { object: {} as any },
            };

            vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(mockEvent as any);

            await paymentController.handleStripeWebhook(
                mockRequest as FastifyRequest,
                mockReply as FastifyReply
            );

            expect(mockRequest.log?.warn).toHaveBeenCalledWith(
                expect.stringContaining('Unhandled event type')
            );
            expect(mockReply.status).toHaveBeenCalledWith(200);
        });
    });
});

