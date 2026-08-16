import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { auth } from '../utils/swagger';
import { partnerController } from '../controllers/partner';

/**
 * Partner Portal routes — read-only surface for resellers / country reps.
 *
 * Access model: any authenticated user may call; the controller resolves
 * whether the caller is a registered partner (via partners.user_id, or a
 * `users.phone` match on first visit — never email, see the anchor rationale
 * on resolvePartnerForUser) and returns 403 otherwise. The session's
 * `isPartner` flag only decides whether the nav entry renders; the partners
 * table is the authority for access, re-read on every call.
 */
export default async function partnerRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        protectedRoutes.get(
            '/overview',
            { schema: { tags: ['Partner'], summary: 'Partner profile + attributed merchants (read-only)', security: auth } },
            partnerController.getOverview,
        );

        protectedRoutes.get(
            '/merchants/:userId',
            {
                schema: {
                    tags: ['Partner'],
                    summary: 'One attributed merchant\'s detail (read-only; 404 if not attributed to the caller)',
                    security: auth,
                    params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] },
                },
            },
            partnerController.getMerchant,
        );
    });
}
