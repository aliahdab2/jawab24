import { FastifyInstance } from 'fastify';
import { templatesController } from '../controllers/templates';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function templatesRoutes(fastify: FastifyInstance) {
    // --- Read: all workspace members ---
    fastify.register(async (readRoutes) => {
        readRoutes.addHook('preHandler', authenticate);
        readRoutes.addHook('preHandler', resolveWorkspace);

        readRoutes.get('/templates', {
            schema: {
                tags: ['Templates'],
                summary: 'List all templates',
                security: auth,
            },
        }, templatesController.getAll);

        readRoutes.get('/templates/:id', {
            schema: {
                tags: ['Templates'],
                summary: 'Get a single template by ID',
                security: auth,
            },
        }, templatesController.getOne);
    });

    // --- Write: admin+ only ---
    fastify.register(async (adminRoutes) => {
        adminRoutes.addHook('preHandler', authenticate);
        adminRoutes.addHook('preHandler', resolveWorkspace);
        adminRoutes.addHook('preHandler', requireRole('admin'));

        adminRoutes.post('/templates', {
            schema: {
                tags: ['Templates'],
                summary: 'Create a new template',
                security: auth,
            },
        }, templatesController.create);

        adminRoutes.put('/templates/:id', {
            schema: {
                tags: ['Templates'],
                summary: 'Update a template',
                security: auth,
            },
        }, templatesController.update);

        adminRoutes.delete('/templates/:id', {
            schema: {
                tags: ['Templates'],
                summary: 'Delete a template',
                security: auth,
            },
        }, templatesController.delete);
    });
}
