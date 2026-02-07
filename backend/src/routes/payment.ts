import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { paymentController } from '../controllers/payment';
import { authenticate } from '../middleware/auth';
import { CreateCheckoutSessionRequest } from '../types/payment';
import { auth } from '../utils/swagger';

export default async function paymentRoutes(fastify: FastifyInstance) {
    // Create Stripe Checkout Session
    fastify.post<{ Body: CreateCheckoutSessionRequest }>(
        '/create-checkout-session',
        { schema: { tags: ['Payment'], summary: 'Create Stripe checkout session', security: auth }, preHandler: [authenticate] },
        async (request, reply) => {
            return paymentController.createCheckoutSession(request, reply);
        }
    );

    // Get subscription status
    fastify.get(
        '/subscription-status',
        { schema: { tags: ['Payment'], summary: 'Get subscription status', security: auth }, preHandler: [authenticate] },
        async (request: FastifyRequest, reply: FastifyReply) => {
            return paymentController.getSubscriptionStatus(request, reply);
        }
    );

    // Cancel subscription
    fastify.post(
        '/cancel-subscription',
        { schema: { tags: ['Payment'], summary: 'Cancel subscription', security: auth }, preHandler: [authenticate] },
        async (request: FastifyRequest, reply: FastifyReply) => {
            return paymentController.cancelSubscription(request, reply);
        }
    );

    // Create billing portal session
    fastify.post(
        '/billing-portal',
        { schema: { tags: ['Payment'], summary: 'Create billing portal session', security: auth }, preHandler: [authenticate] },
        async (request: FastifyRequest, reply: FastifyReply) => {
            return paymentController.createBillingPortalSession(request, reply);
        }
    );

    // Stripe webhook (no authentication needed - verified by signature)
    fastify.post(
        '/webhook',
        { schema: { tags: ['Payment'], summary: 'Stripe webhook handler (signature-verified)' } },
        async (request: FastifyRequest, reply: FastifyReply) => {
            return paymentController.handleWebhook(request, reply);
        }
    );
}
