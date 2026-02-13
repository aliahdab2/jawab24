import { FastifyInstance } from 'fastify';
import { settingsController } from '../controllers/settings';
import { authenticate } from '../middleware/auth';
import { auth } from '../utils/swagger';

export default async function settingsRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        protectedRoutes.get('/settings', {
            schema: {
                tags: ['Settings'],
                summary: 'Get user settings',
                security: auth,
            },
        }, settingsController.get);

        protectedRoutes.put('/settings', {
            schema: {
                tags: ['Settings'],
                summary: 'Update user settings',
                security: auth,
            },
        }, settingsController.update);
    });
}
