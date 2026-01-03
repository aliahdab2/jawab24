import { FastifyReply, FastifyRequest } from 'fastify';
import { postsService } from '../services/posts';
import { pagesService } from '../services/pages';
import { UpdatePostDTO } from '../types';
import { AuthenticatedRequest } from '../middleware/auth';

export class PostsController {
    /**
     * Get all posts for user
     * GET /posts
     */
    async getAll(request: FastifyRequest, reply: FastifyReply) {
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        
        try {
            const posts = await postsService.getPostsByUser(userId);
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
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        const { pageId } = request.params;
        
        try {
            // Verify user owns the page
            const page = await pagesService.getPage(userId, pageId);
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
        const { id } = request.params;
        
        try {
            const post = await postsService.getPost(id);
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
        const { id } = request.params;
        
        try {
            const post = await postsService.updatePost(id, request.body);
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
        const { id } = request.params;
        
        try {
            await postsService.deletePost(id);
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
        const { id } = request.params;
        const { enabled } = request.body;
        
        try {
            const post = await postsService.toggleAutoReply(id, enabled);
            if (!post) {
                return reply.status(404).send({ error: 'Post not found' });
            }
            return reply.send(post);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to toggle auto-reply' });
        }
    }
}

export const postsController = new PostsController();

