import { FastifyInstance } from 'fastify';
import { aiController } from '../controllers/ai';
import { authenticate } from '../middleware/auth';

export default async function aiRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        // Generate AI reply
        protectedRoutes.post('/ai/generate', aiController.generate);

        // Cache management
        protectedRoutes.get('/ai/cache/stats', aiController.getCacheStats);
        protectedRoutes.delete('/ai/cache', aiController.clearCache);
    });
}

