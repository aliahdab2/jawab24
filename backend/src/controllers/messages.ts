import { FastifyReply, FastifyRequest } from 'fastify';
import { messagesService } from '../services/messages';
import { pagesService } from '../services/pages';
import { facebookService } from '../services/facebook';
import { instagramService } from '../services/instagram';
import { settingsService } from '../services/settings';

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
    /**
     * Reply to a message manually
     * POST /messages/:id/reply
     */
    async reply(
        request: FastifyRequest<{ Params: { id: string }; Body: { replyText: string } }>,
        reply: FastifyReply
    ) {
        const userId = (request as AuthenticatedRequest).user.userId;
        const { id } = request.params;
        const { replyText } = request.body;

        if (!replyText || replyText.trim().length === 0) {
            return reply.status(400).send({ error: 'Reply text is required' });
        }

        try {
            // 1. Find the original incoming message
            const message = await messagesService.getMessageById(id);
            if (!message) {
                return reply.status(404).send({ error: 'Message not found' });
            }

            // 2. Verify user owns the page
            const page = await pagesService.getPage(userId, message.pageId);
            if (!page) {
                return reply.status(403).send({ error: 'Unauthorized: page not owned by user' });
            }

            // 3. Send the reply via the appropriate platform API
            const platform = message.platform || 'facebook';
            if (platform === 'instagram' && page.instagramAccountId) {
                await instagramService.sendDirectMessage(
                    page.instagramAccountId,
                    message.senderId,
                    replyText.trim(),
                    page.accessToken
                );
            } else {
                await facebookService.sendPrivateMessage(
                    page.accessToken,
                    message.senderId,
                    replyText.trim()
                );
            }

            // 4. Mark the original message as replied (manual)
            await messagesService.markAsReplied(message.id, replyText.trim(), 'manual');

            // 5. Store the outgoing message
            const outgoing = await messagesService.storeOutgoingMessage(
                message.pageId,
                message.senderId,
                replyText.trim(),
                'manual'
            );

            return reply.send(outgoing);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to send reply' });
        }
    }

    /**
     * Pause smart replies for a conversation
     * POST /messages/conversation/:senderId/pause
     */
    async pauseConversation(
        request: FastifyRequest<{
            Params: { senderId: string };
            Body: { pageId: string; durationMinutes?: number };
        }>,
        reply: FastifyReply
    ) {
        const userId = (request as AuthenticatedRequest).user.userId;
        const { senderId } = request.params;
        const { pageId, durationMinutes } = request.body;

        if (!pageId) {
            return reply.status(400).send({ error: 'pageId is required' });
        }

        try {
            // Verify user owns the page
            const page = await pagesService.getPage(userId, pageId);
            if (!page) {
                return reply.status(403).send({ error: 'Unauthorized: page not owned by user' });
            }

            // Use custom duration or fall back to user's default setting
            let duration = durationMinutes;
            if (!duration) {
                const userSettings = await settingsService.getSettings(userId);
                duration = userSettings.handoffPauseDurationMinutes;
            }

            const result = await messagesService.pauseConversation(page.id, senderId, duration);
            return reply.send(result);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to pause conversation' });
        }
    }

    /**
     * Resume smart replies for a conversation
     * POST /messages/conversation/:senderId/resume
     */
    async resumeConversation(
        request: FastifyRequest<{
            Params: { senderId: string };
            Body: { pageId: string };
        }>,
        reply: FastifyReply
    ) {
        const userId = (request as AuthenticatedRequest).user.userId;
        const { senderId } = request.params;
        const { pageId } = request.body;

        if (!pageId) {
            return reply.status(400).send({ error: 'pageId is required' });
        }

        try {
            const page = await pagesService.getPage(userId, pageId);
            if (!page) {
                return reply.status(403).send({ error: 'Unauthorized: page not owned by user' });
            }

            await messagesService.resumeConversation(page.id, senderId);
            return reply.send({ success: true });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to resume conversation' });
        }
    }

    /**
     * Get pause status for a conversation
     * GET /messages/conversation/:senderId/pause-status
     */
    async getPauseStatus(
        request: FastifyRequest<{
            Params: { senderId: string };
            Querystring: { pageId?: string };
        }>,
        reply: FastifyReply
    ) {
        const { senderId } = request.params;
        const { pageId } = request.query;

        if (!pageId) {
            return reply.status(400).send({ error: 'pageId is required' });
        }

        try {
            const status = await messagesService.getPauseStatus(pageId, senderId);
            return reply.send(status);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to get pause status' });
        }
    }
}

export const messagesController = new MessagesController();










