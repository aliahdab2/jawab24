import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { auth } from '../utils/swagger';
import { partnerController } from '../controllers/partner';

/**
 * Partner Portal routes — read-only surface for resellers / country reps.
 *
 * Access model: any authenticated user may call; the controller resolves
 * whether the caller is a registered partner (via partners.user_id, or a
 * lower(email) match on first visit) and returns 403 otherwise. There is no
 * partner "role" flag on the session — the partners table is the authority.
 */
export default async function partnerRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        protectedRoutes.get(
            '/overview',
            { schema: { tags: ['Partner'], summary: 'Partner profile + attributed merchants (read-only)', security: auth } },
            partnerController.getOverview,
        );
    });
}
