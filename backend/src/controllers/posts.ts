import { FastifyReply, FastifyRequest } from 'fastify';
import { postsService } from '../services/posts';
import { pagesService } from '../services/pages';
import { validatePostReplyRuleInput } from '../services/reply/postReplyRule';
import { UpdatePostDTO } from '../types';
import type { WorkspaceRequest } from '../middleware/workspace';

export class PostsController {
    /**
     * Get all posts for workspace
     * GET /posts
     */
    async getAll(request: FastifyRequest, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const posts = await postsService.getPostsByWorkspace(req.workspaceId);
            return reply.send(posts);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch posts' });
        }
    }

    /**
     * Get posts for a specific page
     * GET /pages/:pageId/posts
     */
    async getByPage(request: FastifyRequest<{ Params: { pageId: string } }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { pageId } = request.params;

        try {
            // Verify workspace owns the page
            const page = await pagesService.getPage(req.workspaceId, pageId);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }

            const posts = await postsService.getPostsByPage(pageId);
            return reply.send(posts);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch posts' });
        }
    }

    /**
     * Get a single post
     * GET /posts/:id
     */
    async getOne(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
        const { id } = request.params;

        try {
            const post = await postsService.getPost(id, req.workspaceId);
            if (!post) {
                return reply.status(404).send({ error: 'Post not found' });
            }
            return reply.send(post);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch post' });
        }
    }

    /**
     * Update a post
     * PUT /posts/:id
     */
    async update(request: FastifyRequest<{ Params: { id: string }; Body: UpdatePostDTO }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
        const { id } = request.params;

        try {
            const post = await postsService.updatePostByWorkspace(id, request.body, req.workspaceId);
            if (!post) {
                return reply.status(404).send({ error: 'Post not found' });
            }
            return reply.send(post);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to update post' });
        }
    }

    /**
     * Delete a post
     * DELETE /posts/:id
     */
    async delete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
        const { id } = request.params;

        try {
            const deleted = await postsService.deletePost(id, req.workspaceId);
            if (!deleted) return reply.status(404).send({ error: 'Post not found' });
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to delete post' });
        }
    }

    /**
     * Toggle auto-reply for a post
     * PATCH /posts/:id/auto-reply
     */
    async toggleAutoReply(request: FastifyRequest<{ Params: { id: string }; Body: { enabled: boolean } }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
        const { id } = request.params;
        const { enabled } = request.body;

        try {
            const post = await postsService.toggleAutoReply(id, enabled, req.workspaceId);
            if (!post) {
                return reply.status(404).send({ error: 'Post not found' });
            }
            return reply.send(post);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to toggle auto-reply' });
        }
    }

    /**
     * Update trigger keyword + reply for a post or Instagram media
     * PATCH /posts/:id/trigger
     */
    async updateTrigger(
        request: FastifyRequest<{ Params: { id: string }; Body: { source: 'facebook' | 'instagram'; triggerKeyword: string | null; triggerReply: string | null; triggerType?: 'keyword' | 'all' } }>,
        reply: FastifyReply,
    ) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
        const { id } = request.params;
        const { source, triggerKeyword, triggerReply, triggerType } = request.body;

        if (!['facebook', 'instagram'].includes(source)) {
            return reply.status(400).send({ error: 'Invalid source: must be facebook or instagram' });
        }

        const type: 'keyword' | 'all' = triggerType === 'all' ? 'all' : 'keyword';
        const keyword = triggerKeyword?.trim() || null;
        const replyText = triggerReply?.trim() || null;

        try {
            // Clearing the trigger: both keyword and reply empty → remove the rule (fields
            // nulled, type reset to the default).
            if (!keyword && !replyText) {
                const cleared = await postsService.updateTrigger(id, source, null, null, req.workspaceId, 'keyword');
                if (!cleared) return reply.status(404).send({ error: 'Post not found' });
                return reply.send({ success: true });
            }

            // Setting: validate keyword vs any-comment shape via the shared validator. A
            // partial trigger (keyword without a reply) fails here — triggerReply is required.
            const validationError = validatePostReplyRuleInput({ triggerType: type, triggerKeyword: keyword, triggerReply: replyText });
            if (validationError) return reply.status(400).send({ error: validationError });

            // Any-comment mode stores no keyword.
            const storedKeyword = type === 'all' ? null : keyword;
            const found = await postsService.updateTrigger(id, source, storedKeyword, replyText, req.workspaceId, type);
            if (!found) return reply.status(404).send({ error: 'Post not found' });
            return reply.send({ success: true });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to update trigger' });
        }
    }
}

export const postsController = new PostsController();
