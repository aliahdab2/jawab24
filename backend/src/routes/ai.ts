import { FastifyInstance } from 'fastify';
import { aiController } from '../controllers/ai';
import { authenticate } from '../middleware/auth';
import { auth } from '../utils/swagger';

export default async function aiRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        // Generate AI reply (stricter rate limit — calls OpenAI, costs money)
        const aiRateLimit = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

        // DEPRECATED: orphan endpoint, no known callers. Gated with the same cap
        // check as /ai/generate-async until we're confident it can be deleted.
        // See plan task 1.5 + JSDoc on aiController.generate.
        protectedRoutes.post('/ai/generate', {
            ...aiRateLimit,
            schema: {
                tags: ['AI'],
                summary: 'Generate an AI reply synchronously (DEPRECATED — scheduled for removal)',
                description: 'Deprecated. Use POST /ai/generate-async instead. Kept temporarily for backward safety; will be deleted once we confirm no integrations depend on it.',
                security: auth,
            },
        }, aiController.generate);

        protectedRoutes.post('/ai/generate-async', {
            ...aiRateLimit,
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
