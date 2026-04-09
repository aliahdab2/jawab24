import { FastifyInstance } from 'fastify';
import { presetRepliesController } from '../controllers/preset-replies';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function presetRepliesRoutes(fastify: FastifyInstance) {
    // --- Read: all workspace members ---
    fastify.register(async (readRoutes) => {
        readRoutes.addHook('preHandler', authenticate);
        readRoutes.addHook('preHandler', resolveWorkspace);

        readRoutes.get('/preset-replies', {
            schema: {
                tags: ['Preset Replies'],
                summary: 'List all preset replies',
                security: auth,
            },
        }, presetRepliesController.getAll);
    });

    // --- Write: admin+ only ---
    fastify.register(async (adminRoutes) => {
        adminRoutes.addHook('preHandler', authenticate);
        adminRoutes.addHook('preHandler', resolveWorkspace);
        adminRoutes.addHook('preHandler', requireRole('admin'));

        adminRoutes.post('/preset-replies', {
            schema: {
                tags: ['Preset Replies'],
                summary: 'Create a preset reply',
                security: auth,
            },
        }, presetRepliesController.create);

        adminRoutes.put('/preset-replies/:id', {
            schema: {
                tags: ['Preset Replies'],
                summary: 'Update a preset reply',
                security: auth,
            },
        }, presetRepliesController.update);

        adminRoutes.delete('/preset-replies/:id', {
            schema: {
                tags: ['Preset Replies'],
                summary: 'Delete a preset reply',
                security: auth,
            },
        }, presetRepliesController.delete);
    });
}
