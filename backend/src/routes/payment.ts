import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { paymentController } from '../controllers/payment';
import { authenticate } from '../middleware/auth';
import { CreateCheckoutSessionRequest } from '../types/payment';

export default async function paymentRoutes(fastify: FastifyInstance) {
    // Create Stripe Checkout Session
    fastify.post<{ Body: CreateCheckoutSessionRequest }>(
        '/create-checkout-session',
        { preHandler: [authenticate] },
        async (request, reply) => {
            return paymentController.createCheckoutSession(request, reply);
        }
    );

    // Get subscription status
    fastify.get(
        '/subscription-status',
        { preHandler: [authenticate] },
        async (request: FastifyRequest, reply: FastifyReply) => {
            return paymentController.getSubscriptionStatus(request, reply);
        }
    );

    // Cancel subscription
    fastify.post(
        '/cancel-subscription',
        { preHandler: [authenticate] },
        async (request: FastifyRequest, reply: FastifyReply) => {
            return paymentController.cancelSubscription(request, reply);
        }
    );

    // Create billing portal session
    fastify.post(
        '/billing-portal',
        { preHandler: [authenticate] },
        async (request: FastifyRequest, reply: FastifyReply) => {
            return paymentController.createBillingPortalSession(request, reply);
        }
    );

    // Stripe webhook (no authentication needed - verified by signature)
    fastify.post(
        '/webhook',
        async (request: FastifyRequest, reply: FastifyReply) => {
            return paymentController.handleWebhook(request, reply);
        }
    );
}
