import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { auth } from '../utils/swagger';
import { integrationRegistry } from '../integrations';

/**
 * GET /api/integrations/status
 * Returns which e-commerce integrations are currently enabled.
 * Frontend uses this to show "Coming soon" badges for disabled platforms.
 */
export default async function integrationsRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        protectedRoutes.get('/status', {
            schema: {
                tags: ['Integrations'],
                summary: 'Get e-commerce integration status',
                security: auth,
                response: {
                    200: {
                        type: 'object',
                        description: 'Map of integration name to enabled status',
                        additionalProperties: { type: 'boolean' },
                    },
                },
            },
        }, async (_request, reply) => {
            const status: Record<string, boolean> = {};
            for (const integration of integrationRegistry.getAll()) {
                status[integration.name] = integration.isEnabled();
            }
            reply.send(status);
        });
    });
}
