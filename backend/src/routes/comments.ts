import { FastifyInstance } from 'fastify';
import { commentsController } from '../controllers/comments';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function commentsRoutes(fastify: FastifyInstance) {
    // --- Member+: all members can view, reply, resolve ---
    fastify.register(async (memberRoutes) => {
        memberRoutes.addHook('preHandler', authenticate);
        memberRoutes.addHook('preHandler', resolveWorkspace);

        memberRoutes.get('/comments', {
            schema: { tags: ['Comments'], summary: 'List all comments', security: auth },
        }, commentsController.getAll);

        memberRoutes.get('/comments/inbox', {
            schema: { tags: ['Comments'], summary: 'Get comments inbox', security: auth },
        }, commentsController.getInbox);

        memberRoutes.get('/comments/stats', {
            schema: {
                tags: ['Comments'],
                summary: 'Get comment statistics',
                security: auth,
                querystring: {
                    type: 'object',
                    properties: {
                        pageId: { type: 'string', format: 'uuid', description: 'Scope counts to a single page so badges match the filtered list' },
                    },
                    additionalProperties: false,
                },
            },
        }, commentsController.getStats);

        memberRoutes.get('/comments/:id', {
            schema: { tags: ['Comments'], summary: 'Get a single comment by ID', security: auth },
        }, commentsController.getOne);

        memberRoutes.put('/comments/:id', {
            schema: { tags: ['Comments'], summary: 'Update a comment', security: auth },
        }, commentsController.update);

        memberRoutes.post('/comments/:id/reply', {
            schema: { tags: ['Comments'], summary: 'Reply to a comment', security: auth },
        }, commentsController.reply);

        memberRoutes.post('/comments/:id/resolve', {
            schema: { tags: ['Comments'], summary: 'Resolve a comment (mark as handled)', security: auth },
        }, commentsController.resolve);

        memberRoutes.post('/comments/:id/unresolve', {
            schema: { tags: ['Comments'], summary: 'Unresolve a comment (reopen for action)', security: auth },
        }, commentsController.unresolve);

        memberRoutes.post('/comments/:id/feedback', {
            schema: { tags: ['Comments'], summary: 'Submit feedback for a comment reply', security: auth },
        }, commentsController.feedback);

        // Hiding is reversible + non-destructive — same tier as resolve.
        memberRoutes.post('/comments/:id/hide', {
            schema: { tags: ['Comments'], summary: 'Hide a comment on the platform (reversible)', security: auth },
        }, commentsController.hide);

        memberRoutes.post('/comments/:id/unhide', {
            schema: { tags: ['Comments'], summary: 'Un-hide a previously hidden comment', security: auth },
        }, commentsController.unhide);
    });

    // --- Admin+: destructive / irreversible operations ---
    fastify.register(async (adminRoutes) => {
        adminRoutes.addHook('preHandler', authenticate);
        adminRoutes.addHook('preHandler', resolveWorkspace);
        adminRoutes.addHook('preHandler', requireRole('admin'));

        adminRoutes.delete('/comments/:id', {
            schema: { tags: ['Comments'], summary: 'Delete a comment (platform + local)', security: auth },
        }, commentsController.delete);

        adminRoutes.post('/comments/:id/block', {
            schema: { tags: ['Comments'], summary: 'Block the comment author from the page (Facebook only)', security: auth },
        }, commentsController.block);
    });
}
