import { FastifyInstance } from 'fastify';
import { rulesController } from '../controllers/rules';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function rulesRoutes(fastify: FastifyInstance) {
    // --- Read: all workspace members ---
    fastify.register(async (readRoutes) => {
        readRoutes.addHook('preHandler', authenticate);
        readRoutes.addHook('preHandler', resolveWorkspace);

        readRoutes.get('/rules', {
            schema: {
                tags: ['Rules'],
                summary: 'List all rules',
                security: auth,
            },
        }, rulesController.getAll);

        readRoutes.get('/rules/:id', {
            schema: {
                tags: ['Rules'],
                summary: 'Get a single rule by ID',
                security: auth,
            },
        }, rulesController.getOne);
    });

    // --- Write: admin+ only ---
    fastify.register(async (adminRoutes) => {
        adminRoutes.addHook('preHandler', authenticate);
        adminRoutes.addHook('preHandler', resolveWorkspace);
        adminRoutes.addHook('preHandler', requireRole('admin'));

        adminRoutes.post('/rules', {
            schema: {
                tags: ['Rules'],
                summary: 'Create a new rule',
                security: auth,
            },
        }, rulesController.create);

        adminRoutes.put('/rules/:id', {
            schema: {
                tags: ['Rules'],
                summary: 'Update a rule',
                security: auth,
            },
        }, rulesController.update);

        adminRoutes.delete('/rules/:id', {
            schema: {
                tags: ['Rules'],
                summary: 'Delete a rule',
                security: auth,
            },
        }, rulesController.delete);
    });
}
