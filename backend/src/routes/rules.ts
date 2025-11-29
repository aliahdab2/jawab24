import { FastifyInstance } from 'fastify';
import { rulesController } from '../controllers/rules';
import { authenticate } from '../middleware/auth';

export default async function rulesRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        protectedRoutes.post('/rules', rulesController.create);
        protectedRoutes.get('/rules', rulesController.getAll);
        protectedRoutes.get('/rules/:id', rulesController.getOne);
        protectedRoutes.put('/rules/:id', rulesController.update);
        protectedRoutes.delete('/rules/:id', rulesController.delete);
    });
}

