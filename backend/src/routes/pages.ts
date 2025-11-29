import { FastifyInstance } from 'fastify';
import { pagesController } from '../controllers/pages';
import { authenticate } from '../middleware/auth';

export default async function pagesRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        // Pages CRUD
        protectedRoutes.post('/pages', pagesController.create);
        protectedRoutes.get('/pages', pagesController.getAll);
        protectedRoutes.get('/pages/:id', pagesController.getOne);
        protectedRoutes.put('/pages/:id', pagesController.update);
        protectedRoutes.delete('/pages/:id', pagesController.delete);

        // Special actions
        protectedRoutes.patch('/pages/:id/auto-reply', pagesController.toggleAutoReply);
        protectedRoutes.post('/pages/sync', pagesController.sync);
    });
}

