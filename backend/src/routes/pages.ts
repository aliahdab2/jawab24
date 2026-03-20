import { FastifyInstance } from 'fastify';
import { pagesController } from '../controllers/pages';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function pagesRoutes(fastify: FastifyInstance) {
    // --- Read: all workspace members ---
    fastify.register(async (readRoutes) => {
        readRoutes.addHook('preHandler', authenticate);
        readRoutes.addHook('preHandler', resolveWorkspace);

        readRoutes.get('/pages', {
            schema: {
                tags: ['Pages'],
                summary: 'List all pages',
                security: auth,
            },
        }, pagesController.getAll);

        readRoutes.get('/pages/:id', {
            schema: {
                tags: ['Pages'],
                summary: 'Get a single page by ID',
                security: auth,
            },
        }, pagesController.getOne);

        readRoutes.get('/pages/:id/kb-gaps', {
            schema: {
                tags: ['Pages'],
                summary: 'Get unresolved KB gaps for a page',
                security: auth,
            },
        }, pagesController.getKbGaps);
    });

    // --- Write: admin+ only ---
    fastify.register(async (adminRoutes) => {
        adminRoutes.addHook('preHandler', authenticate);
        adminRoutes.addHook('preHandler', resolveWorkspace);
        adminRoutes.addHook('preHandler', requireRole('admin'));

        adminRoutes.post('/pages', {
            schema: {
                tags: ['Pages'],
                summary: 'Create a new page',
                security: auth,
            },
        }, pagesController.create);

        adminRoutes.put('/pages/:id', {
            schema: {
                tags: ['Pages'],
                summary: 'Update a page',
                security: auth,
            },
        }, pagesController.update);

        adminRoutes.delete('/pages/:id', {
            schema: {
                tags: ['Pages'],
                summary: 'Delete a page',
                security: auth,
            },
        }, pagesController.delete);

        adminRoutes.patch('/pages/:id/auto-reply', {
            schema: {
                tags: ['Pages'],
                summary: 'Toggle auto-reply for a page',
                security: auth,
            },
        }, pagesController.toggleAutoReply);

        adminRoutes.post('/pages/sync', {
            schema: {
                tags: ['Pages'],
                summary: 'Sync pages from Facebook',
                security: auth,
            },
        }, pagesController.sync);

        adminRoutes.post('/pages/:id/kb-gaps/:gapId/dismiss', {
            schema: {
                tags: ['Pages'],
                summary: 'Dismiss a KB gap (mark as resolved)',
                security: auth,
            },
        }, pagesController.dismissGap);
    });
}
