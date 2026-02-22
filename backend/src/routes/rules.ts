import { FastifyInstance } from 'fastify';
import { rulesController } from '../controllers/rules';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function rulesRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);
        protectedRoutes.addHook('preHandler', resolveWorkspace);

        protectedRoutes.post('/rules', {
            schema: {
                tags: ['Rules'],
                summary: 'Create a new rule',
                security: auth,
            },
        }, rulesController.create);

        protectedRoutes.get('/rules', {
            schema: {
                tags: ['Rules'],
                summary: 'List all rules',
                security: auth,
            },
        }, rulesController.getAll);

        protectedRoutes.get('/rules/:id', {
            schema: {
                tags: ['Rules'],
                summary: 'Get a single rule by ID',
                security: auth,
            },
        }, rulesController.getOne);

        protectedRoutes.put('/rules/:id', {
            schema: {
                tags: ['Rules'],
                summary: 'Update a rule',
                security: auth,
            },
        }, rulesController.update);

        protectedRoutes.delete('/rules/:id', {
            schema: {
                tags: ['Rules'],
                summary: 'Delete a rule',
                security: auth,
            },
        }, rulesController.delete);
    });
}
