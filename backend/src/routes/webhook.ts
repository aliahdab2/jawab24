import { FastifyInstance } from 'fastify';
import { webhookController } from '../controllers/webhook';

interface WebhookVerifyQuery {
    'hub.mode'?: string;
    'hub.verify_token'?: string;
    'hub.challenge'?: string;
}

// Meta delivers webhooks for ALL merchants from a small shared pool of edge
// IPs, so the global per-IP limiter (5000/15min) would 429 legitimate
// deliveries as volume grows and force Meta into redelivery/backoff — delaying
// every reply. Exempt these routes: abuse is already gated by the timing-safe
// X-Hub-Signature-256 check (and verify-token on GET) in the controller.
const META_WEBHOOK_CONFIG = { rateLimit: false } as const;

export default async function webhookRoutes(fastify: FastifyInstance) {
    // Webhook verification - query params are optional during verification
    fastify.get<{ Querystring: WebhookVerifyQuery }>('/webhook', {
        schema: { tags: ['Webhooks'], summary: 'Verify Facebook webhook subscription' },
        config: META_WEBHOOK_CONFIG,
    }, (req, reply) => webhookController.verifyWebhook(req, reply));

    // Webhook event handling
    fastify.post('/webhook', {
        schema: { tags: ['Webhooks'], summary: 'Handle incoming Facebook webhook events' },
        config: META_WEBHOOK_CONFIG,
    }, (req, reply) => webhookController.handleWebhook(req, reply));

    // Facebook Data Deletion Callback (GDPR compliance)
    fastify.post('/webhook/data-deletion', {
        schema: { tags: ['Webhooks'], summary: 'Facebook data deletion callback (GDPR)' },
        config: META_WEBHOOK_CONFIG,
    }, (req, reply) => webhookController.handleDataDeletion(req, reply));
}
