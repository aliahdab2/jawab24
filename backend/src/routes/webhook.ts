import { FastifyInstance } from 'fastify';
import { webhookController } from '../controllers/webhook';

export default async function webhookRoutes(fastify: FastifyInstance) {
    // Webhook verification
    fastify.get('/webhook', (req, reply) => webhookController.verifyWebhook(req as any, reply));

    // Webhook event handling
    fastify.post('/webhook', (req, reply) => webhookController.handleWebhook(req, reply));
}
