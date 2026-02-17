import { FastifyInstance } from 'fastify';
import { commentsController } from '../controllers/comments';
import { authenticate } from '../middleware/auth';
import { auth } from '../utils/swagger';

export default async function commentsRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        // Comments
        protectedRoutes.get('/comments', {
            schema: {
                tags: ['Comments'],
                summary: 'List all comments',
                security: auth,
            },
        }, commentsController.getAll);

        protectedRoutes.get('/comments/inbox', {
            schema: {
                tags: ['Comments'],
                summary: 'Get comments inbox',
                security: auth,
            },
        }, commentsController.getInbox);

        protectedRoutes.get('/comments/stats', {
            schema: {
                tags: ['Comments'],
                summary: 'Get comment statistics',
                security: auth,
            },
        }, commentsController.getStats);

        protectedRoutes.get('/comments/:id', {
            schema: {
                tags: ['Comments'],
                summary: 'Get a single comment by ID',
                security: auth,
            },
        }, commentsController.getOne);

        protectedRoutes.put('/comments/:id', {
            schema: {
                tags: ['Comments'],
                summary: 'Update a comment',
                security: auth,
            },
        }, commentsController.update);

        protectedRoutes.delete('/comments/:id', {
            schema: {
                tags: ['Comments'],
                summary: 'Delete a comment',
                security: auth,
            },
        }, commentsController.delete);

        // Reply to comment
        protectedRoutes.post('/comments/:id/reply', {
            schema: {
                tags: ['Comments'],
                summary: 'Reply to a comment',
                security: auth,
            },
        }, commentsController.reply);

        protectedRoutes.post('/comments/:id/resolve', {
            schema: {
                tags: ['Comments'],
                summary: 'Resolve a comment (mark as handled)',
                security: auth,
            },
        }, commentsController.resolve);

        protectedRoutes.post('/comments/:id/unresolve', {
            schema: {
                tags: ['Comments'],
                summary: 'Unresolve a comment (reopen for action)',
                security: auth,
            },
        }, commentsController.unresolve);

        protectedRoutes.post('/comments/:id/feedback', {
            schema: {
                tags: ['Comments'],
                summary: 'Submit feedback for a comment reply',
                security: auth,
            },
        }, commentsController.feedback);
    });
}
