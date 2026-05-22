import { FastifyInstance } from 'fastify';
import { catalogController } from '../controllers/catalog';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function catalogRoutes(fastify: FastifyInstance) {
    // --- Read: all workspace members ---
    fastify.register(async (readRoutes) => {
        readRoutes.addHook('preHandler', authenticate);
        readRoutes.addHook('preHandler', resolveWorkspace);

        readRoutes.get('/catalog-items', {
            schema: {
                tags: ['Catalog'],
                summary: 'List catalog items for a page',
                security: auth,
            },
        }, catalogController.list);

        readRoutes.get('/catalog-items/:id', {
            schema: {
                tags: ['Catalog'],
                summary: 'Get a single catalog item',
                security: auth,
            },
        }, catalogController.getOne);
    });

    // --- Write: admin+ only ---
    fastify.register(async (adminRoutes) => {
        adminRoutes.addHook('preHandler', authenticate);
        adminRoutes.addHook('preHandler', resolveWorkspace);
        adminRoutes.addHook('preHandler', requireRole('admin'));

        adminRoutes.post('/catalog-items', {
            schema: {
                tags: ['Catalog'],
                summary: 'Create a catalog item',
                security: auth,
            },
        }, catalogController.create);

        adminRoutes.patch('/catalog-items/:id', {
            schema: {
                tags: ['Catalog'],
                summary: 'Update a catalog item',
                security: auth,
            },
        }, catalogController.update);

        adminRoutes.delete('/catalog-items/:id', {
            schema: {
                tags: ['Catalog'],
                summary: 'Archive (soft-delete) a catalog item',
                security: auth,
            },
        }, catalogController.archive);
    });
}
