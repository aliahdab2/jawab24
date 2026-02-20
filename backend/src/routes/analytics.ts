import { FastifyInstance } from 'fastify';
import { analyticsController } from '../controllers/analytics';
import { authenticate } from '../middleware/auth';
import { auth } from '../utils/swagger';

export default async function analyticsRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        protectedRoutes.get('/ai-usage', {
            schema: {
                tags: ['Analytics'],
                summary: 'Get AI token usage and cost breakdown',
                security: auth,
                querystring: {
                    type: 'object',
                    properties: {
                        days: { type: 'number', default: 30, description: 'Lookback window in days (1-365)' },
                    },
                },
            },
        }, analyticsController.getAiUsage);

        protectedRoutes.get('/overview', {
            schema: {
                tags: ['Analytics'],
                summary: 'Get analytics overview',
                security: auth,
                querystring: {
                    type: 'object',
                    properties: {
                        days: { type: 'number', default: 30, description: 'Lookback window in days (1-365)' },
                        pageId: { type: 'string', description: 'Filter by page UUID' },
                    },
                },
            },
        }, analyticsController.getOverview);
    });
}
