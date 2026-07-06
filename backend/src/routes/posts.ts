import { FastifyInstance } from 'fastify';
import { postsController } from '../controllers/posts';
import { commentsController } from '../controllers/comments';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function postsRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);
        protectedRoutes.addHook('preHandler', resolveWorkspace);

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

        protectedRoutes.patch('/posts/:id/trigger', {
            schema: {
                tags: ['Posts'],
                summary: 'Set or clear trigger keyword + reply for a post or Instagram media',
                security: auth,
            },
        }, postsController.updateTrigger);

        // Ensure an internal row exists for a picked published post (Post Reply picker).
        protectedRoutes.post('/posts/ensure', {
            schema: {
                tags: ['Posts'],
                summary: 'Find-or-create the internal row for a published post so its Post Reply can be configured',
                security: auth,
            },
        }, postsController.ensurePost);

        // Posts by page
        protectedRoutes.get('/pages/:pageId/posts', {
            schema: {
                tags: ['Posts'],
                summary: 'List posts for a specific page',
                security: auth,
            },
        }, postsController.getByPage);

        // Recent published posts for the Post Reply picker (Graph API + trigger state).
        protectedRoutes.get('/pages/:pageId/published-posts', {
            schema: {
                tags: ['Posts'],
                summary: 'List recent published FB/IG posts with their Post Reply trigger state',
                security: auth,
            },
        }, postsController.getPublishedPosts);

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
