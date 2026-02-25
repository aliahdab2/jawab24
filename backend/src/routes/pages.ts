import { FastifyInstance } from 'fastify';
import { pagesController } from '../controllers/pages';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function pagesRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);
        protectedRoutes.addHook('preHandler', resolveWorkspace);

        // Pages CRUD
        protectedRoutes.post('/pages', {
            schema: {
                tags: ['Pages'],
                summary: 'Create a new page',
                security: auth,
            },
        }, pagesController.create);

        protectedRoutes.get('/pages', {
            schema: {
                tags: ['Pages'],
                summary: 'List all pages',
                security: auth,
            },
        }, pagesController.getAll);

        protectedRoutes.get('/pages/:id', {
            schema: {
                tags: ['Pages'],
                summary: 'Get a single page by ID',
                security: auth,
            },
        }, pagesController.getOne);

        protectedRoutes.put('/pages/:id', {
            schema: {
                tags: ['Pages'],
                summary: 'Update a page',
                security: auth,
            },
        }, pagesController.update);

        protectedRoutes.delete('/pages/:id', {
            schema: {
                tags: ['Pages'],
                summary: 'Delete a page',
                security: auth,
            },
        }, pagesController.delete);

        // Special actions
        protectedRoutes.patch('/pages/:id/auto-reply', {
            schema: {
                tags: ['Pages'],
                summary: 'Toggle auto-reply for a page',
                security: auth,
            },
        }, pagesController.toggleAutoReply);

        protectedRoutes.post('/pages/sync', {
            schema: {
                tags: ['Pages'],
                summary: 'Sync pages from Facebook',
                security: auth,
            },
        }, pagesController.sync);

        protectedRoutes.get('/pages/:id/kb-gaps', {
            schema: {
                tags: ['Pages'],
                summary: 'Get unresolved KB gaps for a page',
                security: auth,
            },
        }, pagesController.getKbGaps);
    });
}
