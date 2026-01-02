import { FastifyInstance } from 'fastify';
import { paymentController } from '../controllers/payment';

export default async function paymentRoutes(fastify: FastifyInstance) {
    // Create Stripe Checkout Session
    fastify.post(
        '/create-checkout-session',
        {
            preHandler: [fastify.authenticate],
        },
        paymentController.createCheckoutSession.bind(paymentController)
    );

    // Get subscription status
    fastify.get(
        '/subscription-status',
        {
            preHandler: [fastify.authenticate],
        },
        paymentController.getSubscriptionStatus.bind(paymentController)
    );

    // Cancel subscription
    fastify.post(
        '/cancel-subscription',
        {
            preHandler: [fastify.authenticate],
        },
        paymentController.cancelSubscription.bind(paymentController)
    );

    // Create billing portal session
    fastify.post(
        '/billing-portal',
        {
            preHandler: [fastify.authenticate],
        },
        paymentController.createBillingPortalSession.bind(paymentController)
    );

    // Stripe webhook (no authentication needed - verified by signature)
    fastify.post(
        '/webhook',
        {
            config: {
                rawBody: true, // Need raw body for webhook signature verification
            },
        },
        paymentController.handleWebhook.bind(paymentController)
    );
}

