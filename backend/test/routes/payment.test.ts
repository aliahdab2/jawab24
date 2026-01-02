import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import paymentRoutes from '../../src/routes/payment';

// Mock the payment controller
const mockPaymentController = {
    createCheckoutSession: vi.fn(),
    handleStripeWebhook: vi.fn(),
};

vi.mock('../../src/controllers/payment', () => ({
    paymentController: mockPaymentController,
}));

// Mock auth middleware
const mockAuthMiddleware = vi.fn((request, reply, done) => {
    request.user = { id: 'user_123', email: 'test@example.com' };
    done();
});

vi.mock('../../src/middleware/auth', () => ({
    authMiddleware: mockAuthMiddleware,
}));

describe('Payment Routes', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = Fastify();
        await app.register(paymentRoutes, { prefix: '/api/payment' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
    });

    describe('POST /api/payment/create-checkout-session', () => {
        it('should call createCheckoutSession controller', async () => {
            mockPaymentController.createCheckoutSession.mockImplementation(
                async (request, reply) => {
                    return reply.send({ url: 'https://checkout.stripe.com/pay/cs_test' });
                }
            );

            const response = await app.inject({
                method: 'POST',
                url: '/api/payment/create-checkout-session',
                payload: { planId: 'plan_123' },
            });

            expect(mockAuthMiddleware).toHaveBeenCalled();
            expect(mockPaymentController.createCheckoutSession).toHaveBeenCalled();
            expect(response.statusCode).toBe(200);
        });

        it('should require authentication', async () => {
            mockAuthMiddleware.mockImplementationOnce((request, reply, done) => {
                reply.code(401).send({ error: 'Unauthorized' });
            });

            const response = await app.inject({
                method: 'POST',
                url: '/api/payment/create-checkout-session',
                payload: { planId: 'plan_123' },
            });

            expect(response.statusCode).toBe(401);
        });
    });

    describe('POST /api/payment/webhook', () => {
        it('should call handleStripeWebhook controller', async () => {
            mockPaymentController.handleStripeWebhook.mockImplementation(
                async (request, reply) => {
                    return reply.status(200).send({ received: true });
                }
            );

            const response = await app.inject({
                method: 'POST',
                url: '/api/payment/webhook',
                headers: {
                    'stripe-signature': 'sig_test',
                },
                payload: { type: 'checkout.session.completed' },
            });

            expect(mockPaymentController.handleStripeWebhook).toHaveBeenCalled();
            expect(response.statusCode).toBe(200);
        });

        it('should not require authentication for webhooks', async () => {
            mockPaymentController.handleStripeWebhook.mockImplementation(
                async (request, reply) => {
                    return reply.status(200).send({ received: true });
                }
            );

            const response = await app.inject({
                method: 'POST',
                url: '/api/payment/webhook',
                payload: {},
            });

            // Auth middleware should not be called for webhook
            expect(response.statusCode).not.toBe(401);
        });
    });
});

