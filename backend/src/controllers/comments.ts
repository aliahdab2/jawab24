import { FastifyReply, FastifyRequest } from 'fastify';
import { commentsService } from '../services/comments';
import { UpdateCommentDTO } from '../types';
import { AuthenticatedRequest } from '../middleware/auth';

export class CommentsController {
    /**
     * Get all comments for user
     * GET /comments
     */
    async getAll(request: FastifyRequest<{ Querystring: { replied?: string; limit?: string } }>, reply: FastifyReply) {
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        const { replied, limit } = request.query;
        
        try {
            const options: { replied?: boolean; limit?: number } = {};
            
            if (replied !== undefined) {
                options.replied = replied === 'true';
            }
            if (limit) {
                options.limit = parseInt(limit, 10);
            }

            const comments = await commentsService.getCommentsByUser(userId, options);
            return reply.send(comments);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch comments' });
        }
    }

    /**
     * Get unreplied comments (inbox)
     * GET /comments/inbox
     */
    async getInbox(request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) {
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
        
        try {
            const comments = await commentsService.getUnrepliedComments(userId, limit);
            return reply.send(comments);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch inbox' });
        }
    }

    /**
     * Get comments for a specific post
     * GET /posts/:postId/comments
     */
    async getByPost(request: FastifyRequest<{ Params: { postId: string } }>, reply: FastifyReply) {
        const { postId } = request.params;
        
        try {
            const comments = await commentsService.getCommentsByPost(postId);
            return reply.send(comments);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch comments' });
        }
    }

    /**
     * Get a single comment
     * GET /comments/:id
     */
    async getOne(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const { id } = request.params;
        
        try {
            const comment = await commentsService.getComment(id);
            if (!comment) {
                return reply.status(404).send({ error: 'Comment not found' });
            }
            return reply.send(comment);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch comment' });
        }
    }

    /**
     * Update a comment
     * PUT /comments/:id
     */
    async update(request: FastifyRequest<{ Params: { id: string }; Body: UpdateCommentDTO }>, reply: FastifyReply) {
        const { id } = request.params;
        
        try {
            const comment = await commentsService.updateComment(id, request.body);
            if (!comment) {
                return reply.status(404).send({ error: 'Comment not found' });
            }
            return reply.send(comment);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to update comment' });
        }
    }

    /**
     * Reply to a comment manually
     * POST /comments/:id/reply
     */
    async reply(request: FastifyRequest<{ Params: { id: string }; Body: { replyText: string; language?: string } }>, reply: FastifyReply) {
        const { id } = request.params;
        const { replyText, language } = request.body;
        
        if (!replyText || replyText.trim().length === 0) {
            return reply.status(400).send({ error: 'Reply text is required' });
        }

        try {
            const comment = await commentsService.markAsReplied(id, replyText, 'manual', undefined, language);
            if (!comment) {
                return reply.status(404).send({ error: 'Comment not found' });
            }
            return reply.send(comment);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to reply to comment' });
        }
    }

    /**
     * Get comment statistics
     * GET /comments/stats
     */
    async getStats(request: FastifyRequest, reply: FastifyReply) {
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        
        try {
            const stats = await commentsService.getStats(userId);
            return reply.send(stats);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch statistics' });
        }
    }

    /**
     * Delete a comment
     * DELETE /comments/:id
     */
    async delete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const { id } = request.params;
        
        try {
            await commentsService.deleteComment(id);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to delete comment' });
        }
    }
}

export const commentsController = new CommentsController();

