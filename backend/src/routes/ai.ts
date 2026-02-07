import { FastifyInstance } from 'fastify';
import { aiController } from '../controllers/ai';
import { authenticate } from '../middleware/auth';
import { auth } from '../utils/swagger';

export default async function aiRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        // Generate AI reply
        protectedRoutes.post('/ai/generate', {
            schema: {
                tags: ['AI'],
                summary: 'Generate an AI reply synchronously',
                security: auth,
            },
        }, aiController.generate);

        protectedRoutes.post('/ai/generate-async', {
            schema: {
                tags: ['AI'],
                summary: 'Generate an AI reply asynchronously',
                security: auth,
            },
        }, aiController.generateAsync);

        // Job status polling (for async generation)
        protectedRoutes.get('/ai/jobs/:jobId', {
            schema: {
                tags: ['AI'],
                summary: 'Get async AI generation job status',
                security: auth,
            },
        }, aiController.getJobStatus);

        // Cache management
        protectedRoutes.get('/ai/cache/stats', {
            schema: {
                tags: ['AI'],
                summary: 'Get AI response cache statistics',
                security: auth,
            },
        }, aiController.getCacheStats);

        protectedRoutes.delete('/ai/cache', {
            schema: {
                tags: ['AI'],
                summary: 'Clear AI response cache',
                security: auth,
            },
        }, aiController.clearCache);
    });
}
