import { FastifyInstance } from 'fastify';
import { templatesController } from '../controllers/templates';
import { authenticate } from '../middleware/auth';

export default async function templatesRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        protectedRoutes.post('/templates', templatesController.create);
        protectedRoutes.get('/templates', templatesController.getAll);
        protectedRoutes.get('/templates/:id', templatesController.getOne);
        protectedRoutes.put('/templates/:id', templatesController.update);
        protectedRoutes.delete('/templates/:id', templatesController.delete);
    });
}

