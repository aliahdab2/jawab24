import { FastifyInstance } from 'fastify';
import { webhookController } from '../controllers/webhook';

interface WebhookVerifyQuery {
    'hub.mode'?: string;
    'hub.verify_token'?: string;
    'hub.challenge'?: string;
}

export default async function webhookRoutes(fastify: FastifyInstance) {
    // Webhook verification - query params are optional during verification
    fastify.get<{ Querystring: WebhookVerifyQuery }>('/webhook', (req, reply) => webhookController.verifyWebhook(req, reply));

    // Webhook event handling
    fastify.post('/webhook', (req, reply) => webhookController.handleWebhook(req, reply));
}
