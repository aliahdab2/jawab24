import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { paymentController } from '../controllers/payment';
import { offlinePaymentsController } from '../controllers/offlinePayments';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth';
import {
    OFFLINE_PAYMENT_NOTE_MAX,
    OFFLINE_PAYMENT_RAILS,
    OFFLINE_PAYMENT_RECEIPT_BASE64_MAX,
    OFFLINE_PAYMENT_REFERENCE_MAX,
    OFFLINE_PAYMENT_SENDER_NAME_MAX,
    OFFLINE_PAYMENT_STATUSES,
} from '@jawab24/shared';
import { CreateCheckoutSessionRequest } from '../types/payment';
import { auth } from '../utils/swagger';

export default async function paymentRoutes(fastify: FastifyInstance) {
    // Create Stripe Checkout Session (stricter rate limit — creates Stripe sessions)
    fastify.post<{ Body: CreateCheckoutSessionRequest }>(
        '/create-checkout-session',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['Payment'], summary: 'Create Stripe checkout session', security: auth }, preHandler: [authenticate] },
        async (request, reply) => {
            return paymentController.createCheckoutSession(request, reply);
        }
    );

    // Create Subscription with PaymentElement (returns PaymentIntent or SetupIntent clientSecret)
    fastify.post<{ Body: CreateCheckoutSessionRequest }>(
        '/create-subscription-intent',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['Payment'], summary: 'Create subscription intent for PaymentElement', security: auth }, preHandler: [authenticate] },
        async (request, reply) => {
            return paymentController.createSubscriptionIntent(request, reply);
        }
    );

    // Create a one-time PaymentIntent for a Credit top-up pack (returns clientSecret for the modal PaymentElement)
    fastify.post<{ Body: { pack?: string } }>(
        '/create-topup-intent',
        {
            config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
            schema: {
                tags: ['Payment'],
                summary: 'Create a PaymentIntent for a Credit top-up pack',
                security: auth,
                body: {
                    type: 'object',
                    required: ['pack'],
                    properties: { pack: { type: 'string', enum: ['5k', '10k'] } },
                },
            },
            preHandler: [authenticate],
        },
        async (request, reply) => {
            return paymentController.createTopupIntent(request, reply);
        }
    );

    // Get checkout session status (for embedded checkout return page)
    fastify.get<{ Querystring: { session_id: string } }>(
        '/checkout-session-status',
        { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['Payment'], summary: 'Get checkout session status', security: auth }, preHandler: [authenticate] },
        async (request, reply) => {
            return paymentController.getCheckoutSessionStatus(request, reply);
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

    // Change plan on existing Stripe subscription with proration.
    fastify.post<{ Body: { planId: string; billingInterval?: 'month' | 'year' } }>(
        '/change-plan',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['Payment'], summary: 'Change plan with proration on existing Stripe subscription', security: auth }, preHandler: [authenticate] },
        async (request, reply) => {
            return paymentController.changePlan(request, reply);
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
    // ── Offline payment rail (Sham Cash) ───────────────────────────────────
    // A second rail BESIDE the Stripe block, never a hole in it: the sanctions
    // guard on card payments is untouched. These endpoints only record and read
    // a merchant's claim that they transferred; nothing here grants a plan.

    fastify.get(
        '/offline/config',
        { schema: { tags: ['Payment'], summary: 'Sham Cash wallet details — always 200, `enabled:false` when the rail is off', security: auth }, preHandler: [authenticate] },
        async (request, reply) => {
            return offlinePaymentsController.getConfig(request as AuthenticatedRequest, reply);
        }
    );

    fastify.post(
        '/offline/claims',
        {
            // Tighter than the card endpoints: each request can carry a 2 MB
            // image, and a claim is a human review task, not a machine one.
            config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
            schema: {
                tags: ['Payment'],
                summary: 'Submit a completed offline transfer for review',
                security: auth,
                body: {
                    type: 'object',
                    // billingInterval is REQUIRED: the claim's amount derives from it,
                    // and a silently defaulted 'month' would file a yearly transfer
                    // as a monthly claim.
                    required: ['planId', 'transferReference', 'billingInterval'],
                    properties: {
                        planId: { type: 'string', format: 'uuid' },
                        billingInterval: { type: 'string', enum: ['month', 'year'] },
                        // Additive now so a second rail is not a breaking change later.
                        rail: { type: 'string', enum: [...OFFLINE_PAYMENT_RAILS], default: 'sham_cash' },
                        transferReference: { type: 'string', minLength: 1, maxLength: OFFLINE_PAYMENT_REFERENCE_MAX, pattern: '\\S' },
                        senderName: { type: 'string', maxLength: OFFLINE_PAYMENT_SENDER_NAME_MAX },
                        note: { type: 'string', maxLength: OFFLINE_PAYMENT_NOTE_MAX },
                        receipt: {
                            type: ['object', 'null'],
                            properties: {
                                // Refused by the schema before the body is decoded into a Buffer.
                                base64: { type: 'string', maxLength: OFFLINE_PAYMENT_RECEIPT_BASE64_MAX },
                                mimeType: { type: 'string' },
                            },
                        },
                    },
                },
            },
            preHandler: [authenticate],
        },
        async (request, reply) => {
            return offlinePaymentsController.submit(request as AuthenticatedRequest, reply);
        }
    );

    fastify.get(
        '/offline/claims',
        {
            schema: {
                tags: ['Payment'],
                summary: "The caller's own offline payment claims",
                security: auth,
                // The MERCHANT shape, enforced at serialization: fast-json-stringify
                // emits only the listed properties, so a column added for the
                // reviewer (reviewNote, userId, …) can never reach the merchant.
                response: {
                    200: {
                        type: 'object',
                        properties: {
                            claims: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        id: { type: 'string' },
                                        rail: { type: 'string' },
                                        planId: { type: 'string' },
                                        planName: { type: 'string' },
                                        planSlug: { type: 'string' },
                                        billingInterval: { type: 'string', enum: ['month', 'year'] },
                                        amountCents: { type: 'integer' },
                                        currency: { type: 'string' },
                                        transferReference: { type: 'string' },
                                        senderName: { type: ['string', 'null'] },
                                        note: { type: ['string', 'null'] },
                                        status: { type: 'string', enum: [...OFFLINE_PAYMENT_STATUSES] },
                                        hasReceipt: { type: 'boolean' },
                                        createdAt: { type: 'string', format: 'date-time' },
                                        reviewedAt: { type: ['string', 'null'], format: 'date-time' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            preHandler: [authenticate],
        },
        async (request, reply) => {
            return offlinePaymentsController.listMine(request as AuthenticatedRequest, reply);
        }
    );
}
