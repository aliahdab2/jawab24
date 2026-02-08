import { FastifyInstance } from 'fastify';
import { messagesController } from '../controllers/messages';
import { authenticate } from '../middleware/auth';
import { auth } from '../utils/swagger';

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

        protectedRoutes.post('/messages/:id/reply', {
            schema: {
                tags: ['Messages'],
                summary: 'Reply to a message manually',
                security: auth,
            },
        }, messagesController.reply);

        protectedRoutes.post('/messages/conversation/:senderId/pause', {
            schema: {
                tags: ['Messages'],
                summary: 'Pause auto-reply for a conversation',
                security: auth,
            },
        }, messagesController.pauseConversation);

        protectedRoutes.post('/messages/conversation/:senderId/resume', {
            schema: {
                tags: ['Messages'],
                summary: 'Resume auto-reply for a conversation',
                security: auth,
            },
        }, messagesController.resumeConversation);

        protectedRoutes.get('/messages/conversation/:senderId/pause-status', {
            schema: {
                tags: ['Messages'],
                summary: 'Get pause status for a conversation',
                security: auth,
            },
        }, messagesController.getPauseStatus);
    });
}
