import { FastifyReply, FastifyRequest } from 'fastify';
import { messagesService } from '../services/messages';

/** Authenticated request with user info */
interface AuthenticatedRequest extends FastifyRequest {
    user: { id: string };
}

export class MessagesController {
    /**
     * Get all messages
     * GET /messages
     */
    async getAll(request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) {
        try {
            const userId = (request as AuthenticatedRequest).user.id;
            const limit = request.query.limit ? parseInt(request.query.limit) : 50;
            const messages = await messagesService.getMessages(userId, limit);
            return reply.send(messages);
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error getting messages');
            return reply.status(500).send({ error: 'Failed to get messages' });
        }
    }

    /**
     * Get message statistics
     * GET /messages/stats
     */
    async getStats(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = (request as AuthenticatedRequest).user.id;
            const stats = await messagesService.getStats(userId);
            return reply.send(stats);
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error getting message stats');
            return reply.status(500).send({ error: 'Failed to get message stats' });
        }
    }

    /**
     * Get conversation with a specific sender
     * GET /messages/conversation/:senderId
     */
    async getConversation(
        request: FastifyRequest<{ Params: { senderId: string }; Querystring: { pageId?: string; limit?: string } }>,
        reply: FastifyReply
    ) {
        try {
            const { senderId } = request.params;
            const { pageId, limit: limitStr } = request.query;
            const limit = limitStr ? parseInt(limitStr) : 50;

            if (!pageId) {
                return reply.status(400).send({ error: 'pageId is required' });
            }

            const messages = await messagesService.getConversation(pageId, senderId, limit);
            return reply.send(messages);
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error getting conversation');
            return reply.status(500).send({ error: 'Failed to get conversation' });
        }
    }
}

export const messagesController = new MessagesController();










