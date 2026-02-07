import { FastifyInstance } from 'fastify';
import { postsController } from '../controllers/posts';
import { commentsController } from '../controllers/comments';
import { authenticate } from '../middleware/auth';
import { auth, IdParam, ErrorResponse, MessageResponse } from '../utils/swagger';

export default async function postsRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        // Posts
        protectedRoutes.get('/posts', {
            schema: {
                tags: ['Posts'],
                summary: 'List all posts',
                security: auth,
            },
        }, postsController.getAll);

        protectedRoutes.get('/posts/:id', {
            schema: {
                tags: ['Posts'],
                summary: 'Get a single post by ID',
                security: auth,
            },
        }, postsController.getOne);

        protectedRoutes.put('/posts/:id', {
            schema: {
                tags: ['Posts'],
                summary: 'Update a post',
                security: auth,
            },
        }, postsController.update);

        protectedRoutes.delete('/posts/:id', {
            schema: {
                tags: ['Posts'],
                summary: 'Delete a post',
                security: auth,
            },
        }, postsController.delete);

        protectedRoutes.patch('/posts/:id/auto-reply', {
            schema: {
                tags: ['Posts'],
                summary: 'Toggle auto-reply for a post',
                security: auth,
            },
        }, postsController.toggleAutoReply);

        // Posts by page
        protectedRoutes.get('/pages/:pageId/posts', {
            schema: {
                tags: ['Posts'],
                summary: 'List posts for a specific page',
                security: auth,
            },
        }, postsController.getByPage);

        // Comments by post
        protectedRoutes.get('/posts/:postId/comments', {
            schema: {
                tags: ['Comments'],
                summary: 'List comments for a specific post',
                security: auth,
            },
        }, commentsController.getByPost);
    });
}
