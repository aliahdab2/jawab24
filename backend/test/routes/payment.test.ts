import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Mock the modules before importing the routes
vi.mock('../../src/controllers/payment', () => ({
    paymentController: {
        createCheckoutSession: vi.fn().mockImplementation(async (request, reply) => {
            return reply.send({ url: 'https://checkout.stripe.com/pay/cs_test' });
        }),
        getSubscriptionStatus: vi.fn().mockImplementation(async (request, reply) => {
            return reply.send({ status: 'active' });
        }),
        cancelSubscription: vi.fn().mockImplementation(async (request, reply) => {
            return reply.send({ message: 'Canceled' });
        }),
        createBillingPortalSession: vi.fn().mockImplementation(async (request, reply) => {
            return reply.send({ url: 'https://billing.stripe.com' });
        }),
        handleWebhook: vi.fn().mockImplementation(async (request, reply) => {
            return reply.send({ received: true });
        }),
    },
}));

vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn((request: any, reply: any, done: any) => {
        request.user = { id: 'user_123', email: 'test@example.com' };
        done();
    }),
}));

// Import after mocking
import paymentRoutes from '../../src/routes/payment';
import { paymentController } from '../../src/controllers/payment';
import { authenticate } from '../../src/middleware/auth';

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
            const response = await app.inject({
                method: 'POST',
                url: '/api/payment/create-checkout-session',
                payload: { planId: 'plan_123' },
            });

            expect(authenticate).toHaveBeenCalled();
            expect(paymentController.createCheckoutSession).toHaveBeenCalled();
            expect(response.statusCode).toBe(200);
        });

        it('should require authentication', async () => {
            vi.mocked(authenticate).mockImplementationOnce((request: any, reply: any, done: any) => {
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

    describe('GET /api/payment/subscription-status', () => {
        it('should call getSubscriptionStatus controller', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/payment/subscription-status',
            });

            expect(authenticate).toHaveBeenCalled();
            expect(paymentController.getSubscriptionStatus).toHaveBeenCalled();
            expect(response.statusCode).toBe(200);
        });
    });

    describe('POST /api/payment/cancel-subscription', () => {
        it('should call cancelSubscription controller', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/payment/cancel-subscription',
            });

            expect(authenticate).toHaveBeenCalled();
            expect(paymentController.cancelSubscription).toHaveBeenCalled();
            expect(response.statusCode).toBe(200);
        });
    });

    describe('POST /api/payment/billing-portal', () => {
        it('should call createBillingPortalSession controller', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/payment/billing-portal',
            });

            expect(authenticate).toHaveBeenCalled();
            expect(paymentController.createBillingPortalSession).toHaveBeenCalled();
            expect(response.statusCode).toBe(200);
        });
    });

    describe('POST /api/payment/webhook', () => {
        it('should call handleWebhook controller', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/payment/webhook',
                headers: {
                    'stripe-signature': 'sig_test',
                },
                payload: { type: 'checkout.session.completed' },
            });

            expect(paymentController.handleWebhook).toHaveBeenCalled();
            expect(response.statusCode).toBe(200);
        });

        it('should not require authentication for webhooks', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/payment/webhook',
                payload: {},
            });

            // Webhook should still work without authentication
            expect(response.statusCode).toBe(200);
        });
    });
});
