import { FastifyReply, FastifyRequest } from 'fastify';
import { commentsService } from '../services/comments';
import { UpdateCommentDTO } from '../types';
import { parseInboxFilters, parseLimit } from '../lib/queryParsers';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';

export class CommentsController {
    /**
     * Get all comments for user with pagination
     * GET /comments
     *
     * Query params:
     * - cursor: Comment ID to start after (for infinite scroll)
     * - limit: Number of comments per page (default 50, max 100)
     * - replied: Filter by replied status ('true' | 'false')
     * - replyMethod: Filter by reply method ('ai' | 'template' | 'manual')
     * - needsAttention: Filter by needsAttention flag ('true' | 'false')
     *
     * Response:
     * {
     *   data: Comment[],
     *   pagination: { hasMore: boolean, nextCursor: string | null, limit: number }
     * }
     */
    async getAll(request: FastifyRequest<{
        Querystring: {
            cursor?: string;
            limit?: string;
            replied?: string;
            replyMethod?: 'ai' | 'template' | 'manual' | 'post_reply';
            needsAttention?: string;
            resolved?: string;
            actionRequired?: string;
            pageId?: string;
        }
    }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        const { cursor, limit, replied, replyMethod, needsAttention, resolved, actionRequired, pageId } = request.query;

        try {
            const options = {
                ...(cursor && { cursor }),
                ...(limit !== undefined && { limit: parseLimit(limit) }),
                ...(replyMethod && ['ai', 'template', 'manual', 'post_reply'].includes(replyMethod) && { replyMethod }),
                ...(pageId && { pageId }),
                ...parseInboxFilters({ replied, resolved, needsAttention, actionRequired }),
            };

            const result = await commentsService.getCommentsByWorkspace(req.workspaceId, options);
            return reply.send(result);
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
        const req = request as ResolvedWorkspaceRequest;
        const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;

        try {
            const comments = await commentsService.getUnrepliedComments(req.workspaceId, limit);
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
        const req = request as ResolvedWorkspaceRequest;
        const { postId } = request.params;

        try {
            // Scope by workspace: without this, any authenticated user could read
            // another workspace's comment thread (customer names + message PII) by
            // supplying a foreign post id (IDOR). Foreign/unknown post → empty list.
            const comments = await commentsService.getCommentsByPost(postId, req.workspaceId);
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
        const req = request as ResolvedWorkspaceRequest;
        const { id } = request.params;

        try {
            const comment = await commentsService.getCommentForWorkspace(id, req.workspaceId);
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
        const req = request as ResolvedWorkspaceRequest;
        const { id } = request.params;

        try {
            const owned = await commentsService.getCommentForWorkspace(id, req.workspaceId);
            if (!owned) {
                return reply.status(404).send({ error: 'Comment not found' });
            }
            const comment = await commentsService.updateComment(id, request.body);
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
        const req = request as ResolvedWorkspaceRequest;
        const { id } = request.params;
        const { replyText, language } = request.body;

        if (!replyText || replyText.trim().length === 0) {
            return reply.status(400).send({ error: 'Reply text is required' });
        }

        try {
            const owned = await commentsService.getCommentForWorkspace(id, req.workspaceId);
            if (!owned) {
                return reply.status(404).send({ error: 'Comment not found' });
            }
            const comment = await commentsService.markAsReplied(id, replyText, 'manual', language);
            return reply.send(comment);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to reply to comment' });
        }
    }

    /**
     * Get comment statistics for the current workspace.
     *
     * GET /comments/stats
     *
     * Query params:
     * - pageId (optional, UUID): Scope counts to a single page so the chip badges
     *   on the comments page match the filtered list. Omit for workspace-wide totals.
     */
    async getStats(
        request: FastifyRequest<{ Querystring: { pageId?: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId } = request.query;

        try {
            const stats = await commentsService.getStats(req.workspaceId, pageId ? { pageId } : undefined);
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
        const req = request as ResolvedWorkspaceRequest;
        const { id } = request.params;

        try {
            const owned = await commentsService.getCommentForWorkspace(id, req.workspaceId);
            if (!owned) {
                return reply.status(404).send({ error: 'Comment not found' });
            }
            await commentsService.deleteComment(id);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to delete comment' });
        }
    }

    /**
     * Resolve a comment (mark as handled without replying)
     * POST /comments/:id/resolve
     */
    async resolve(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        const { id } = request.params;

        try {
            const owned = await commentsService.getCommentForWorkspace(id, req.workspaceId);
            if (!owned) {
                return reply.status(404).send({ error: 'Comment not found' });
            }
            await commentsService.resolveComment(id);
            return reply.send({ success: true });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to resolve comment' });
        }
    }

    /**
     * Unresolve a comment (reopen for action)
     * POST /comments/:id/unresolve
     */
    async unresolve(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        const { id } = request.params;

        try {
            const owned = await commentsService.getCommentForWorkspace(id, req.workspaceId);
            if (!owned) {
                return reply.status(404).send({ error: 'Comment not found' });
            }
            await commentsService.unresolveComment(id);
            return reply.send({ success: true });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to unresolve comment' });
        }
    }

    /**
     * Submit feedback for a reply
     * POST /comments/:id/feedback
     */
    async feedback(request: FastifyRequest<{ Params: { id: string }; Body: { helpful: boolean; reason?: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const user = req.user;
        
        const { id } = request.params;
        const { helpful, reason } = request.body;
        
        if (typeof helpful !== 'boolean') {
            return reply.status(400).send({ error: 'Helpful status is required' });
        }

        try {
            const log = await commentsService.logFeedback(id, user.userId, helpful, reason);
            return reply.send({ success: true, logId: log.id });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to submit feedback' });
        }
    }
}

export const commentsController = new CommentsController();

