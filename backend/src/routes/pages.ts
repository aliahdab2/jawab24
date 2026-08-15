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

        readRoutes.post('/pages/:id/test-reply', {
            schema: {
                tags: ['Pages'],
                summary: 'Test smart reply generation for a page',
                security: auth,
            },
            config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        }, pagesController.testReply);
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

        adminRoutes.post('/pages/:id/archive', {
            schema: {
                tags: ['Pages'],
                summary: 'Archive (soft-hide) a disconnected page — data is kept and restored on reconnect',
                security: auth,
            },
        }, pagesController.archive);

        adminRoutes.patch('/pages/:id/auto-reply', {
            schema: {
                tags: ['Pages'],
                summary: 'Toggle auto-reply for a page',
                security: auth,
            },
        }, pagesController.toggleAutoReply);

        adminRoutes.patch('/pages/:id/lead-config', {
            schema: {
                tags: ['Pages'],
                summary: 'Set per-page lead sub-stages / custom fields (null reverts to workspace default)',
                security: auth,
            },
        }, pagesController.updateLeadConfig);

        adminRoutes.patch('/pages/:id/reply-mode', {
            schema: {
                tags: ['Pages'],
                summary: 'Set per-page reply mode override (null reverts to workspace default)',
                security: auth,
            },
        }, pagesController.updateReplyMode);

        adminRoutes.post('/pages/:id/kb-gaps/:gapId/dismiss', {
            schema: {
                tags: ['Pages'],
                summary: 'Dismiss a KB gap (mark as resolved)',
                security: auth,
            },
        }, pagesController.dismissGap);

        adminRoutes.post('/pages/:id/kb/cleanup', {
            schema: {
                tags: ['Pages'],
                summary: 'Remove merchant-confirmed KB lines after a catalog import (preserves gaps)',
                security: auth,
            },
        }, pagesController.cleanupKb);
    });

    // --- Owner only: connecting pages uses the caller's Facebook token and sets
    //     pages.userId to the caller. Only owners should connect pages so that
    //     token ownership stays with the workspace owner, not a team member who
    //     may later leave or lose Facebook page access. ---
    fastify.register(async (ownerRoutes) => {
        ownerRoutes.addHook('preHandler', authenticate);
        ownerRoutes.addHook('preHandler', resolveWorkspace);
        ownerRoutes.addHook('preHandler', requireRole('owner'));

        ownerRoutes.post('/pages/sync', {
            schema: {
                tags: ['Pages'],
                summary: 'Sync pages from Facebook (owner only)',
                security: auth,
            },
        }, pagesController.sync);
    });
}
