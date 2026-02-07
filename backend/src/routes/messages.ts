import { FastifyInstance } from 'fastify';
import { messagesController } from '../controllers/messages';
import { authenticate } from '../middleware/auth';
import { auth, ErrorResponse, MessageResponse } from '../utils/swagger';

export default async function messagesRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        protectedRoutes.get('/messages', {
            schema: {
                tags: ['Messages'],
                summary: 'List all messages',
                security: auth,
            },
        }, messagesController.getAll);

        protectedRoutes.get('/messages/stats', {
            schema: {
                tags: ['Messages'],
                summary: 'Get message statistics',
                security: auth,
            },
        }, messagesController.getStats);

        protectedRoutes.get('/messages/conversation/:senderId', {
            schema: {
                tags: ['Messages'],
                summary: 'Get conversation with a specific sender',
                security: auth,
            },
        }, messagesController.getConversation);
    });
}
