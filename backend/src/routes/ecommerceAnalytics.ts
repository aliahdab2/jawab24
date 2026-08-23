import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace } from '../middleware/workspace';
import { requireOwnedStore } from '../middleware/storeOwnership';
import * as controller from '../controllers/ecommerceAnalytics';
import { auth } from '../utils/swagger';

export default async function ecommerceAnalyticsRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);
        protectedRoutes.addHook('preHandler', resolveWorkspace);
        protectedRoutes.addHook('preHandler', requireOwnedStore);

        protectedRoutes.get('/:storeId', {
            schema: {
                tags: ['Analytics'],
                summary: 'Get e-commerce analytics overview for a store',
                security: auth,
                params: {
                    type: 'object',
                    properties: {
                        storeId: { type: 'string', format: 'uuid' },
                    },
                    required: ['storeId'],
                },
                querystring: {
                    type: 'object',
                    properties: {
                        range: { type: 'string', enum: ['30d', '90d'], default: '30d' },
                    },
                },
            },
        }, controller.getAnalytics);
    });
}
