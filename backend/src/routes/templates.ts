import { FastifyInstance } from 'fastify';
import { templatesController } from '../controllers/templates';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function templatesRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);
        protectedRoutes.addHook('preHandler', resolveWorkspace);

        protectedRoutes.post('/templates', {
            schema: {
                tags: ['Templates'],
                summary: 'Create a new template',
                security: auth,
            },
        }, templatesController.create);

        protectedRoutes.get('/templates', {
            schema: {
                tags: ['Templates'],
                summary: 'List all templates',
                security: auth,
            },
        }, templatesController.getAll);

        protectedRoutes.get('/templates/:id', {
            schema: {
                tags: ['Templates'],
                summary: 'Get a single template by ID',
                security: auth,
            },
        }, templatesController.getOne);

        protectedRoutes.put('/templates/:id', {
            schema: {
                tags: ['Templates'],
                summary: 'Update a template',
                security: auth,
            },
        }, templatesController.update);

        protectedRoutes.delete('/templates/:id', {
            schema: {
                tags: ['Templates'],
                summary: 'Delete a template',
                security: auth,
            },
        }, templatesController.delete);
    });
}
