import { FastifyInstance } from 'fastify';
import { settingsController } from '../controllers/settings';
import { authenticate } from '../middleware/auth';

export default async function settingsRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        protectedRoutes.get('/settings', settingsController.get);
        protectedRoutes.put('/settings', settingsController.update);
    });
}



