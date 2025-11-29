import { FastifyInstance } from 'fastify';
import { messagesController } from '../controllers/messages';
import { authenticate } from '../middleware/auth';

export default async function messagesRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        protectedRoutes.get('/messages', messagesController.getAll);
        protectedRoutes.get('/messages/stats', messagesController.getStats);
        protectedRoutes.get('/messages/conversation/:senderId', messagesController.getConversation);
    });
}

