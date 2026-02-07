import { FastifyInstance } from 'fastify';
import { webhookController } from '../controllers/webhook';

interface WebhookVerifyQuery {
    'hub.mode'?: string;
    'hub.verify_token'?: string;
    'hub.challenge'?: string;
}

export default async function webhookRoutes(fastify: FastifyInstance) {
    // Webhook verification - query params are optional during verification
    fastify.get<{ Querystring: WebhookVerifyQuery }>('/webhook', {
        schema: { tags: ['Webhooks'], summary: 'Verify Facebook webhook subscription' },
    }, (req, reply) => webhookController.verifyWebhook(req, reply));

    // Webhook event handling
    fastify.post('/webhook', {
        schema: { tags: ['Webhooks'], summary: 'Handle incoming Facebook webhook events' },
    }, (req, reply) => webhookController.handleWebhook(req, reply));
}
