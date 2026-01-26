import { FastifyReply, FastifyRequest } from 'fastify';
import { messagesService } from '../services/messages';

/** Authenticated request with user info */
interface AuthenticatedRequest extends FastifyRequest {
    user: { userId: string; facebookId: string };
}

export class MessagesController {
    /**
     * Get all messages with pagination
     * GET /messages
     *
     * Query params:
     * - cursor: Message ID to start after (for infinite scroll)
     * - limit: Number of messages per page (default 50, max 100)
     * - direction: Filter by direction ('incoming' | 'outgoing')
     *
     * Response:
     * {
     *   data: Message[],
     *   pagination: { hasMore: boolean, nextCursor: string | null, limit: number }
     * }
     */
    async getAll(request: FastifyRequest<{
        Querystring: {
            cursor?: string;
            limit?: string;
            direction?: 'incoming' | 'outgoing';
        }
    }>, reply: FastifyReply) {
        try {
            const userId = (request as AuthenticatedRequest).user.userId;
            const { cursor, limit, direction } = request.query;

            const options: {
                cursor?: string;
                limit?: number;
                direction?: 'incoming' | 'outgoing';
            } = {};

            if (cursor) {
                options.cursor = cursor;
            }

            if (limit) {
                const parsedLimit = parseInt(limit, 10);
                options.limit = Math.min(Math.max(parsedLimit, 1), 100);
            }

            if (direction && ['incoming', 'outgoing'].includes(direction)) {
                options.direction = direction;
            }

            const result = await messagesService.getMessages(userId, options);
            return reply.send(result);
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
            const userId = (request as AuthenticatedRequest).user.userId;
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










