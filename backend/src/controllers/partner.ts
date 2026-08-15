import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthenticatedRequest } from '../middleware/auth';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { partnerPortalService } from '../services/partnerPortal';

/**
 * Partner Portal controller — HTTP concerns for the reseller-facing surface.
 * Read-only: the portal exposes no mutations.
 */
export class PartnerController {
    /** GET /partner/overview — the partner's profile + their attributed merchants. */
    async getOverview(request: FastifyRequest, reply: FastifyReply) {
        const authReq = request as AuthenticatedRequest;
        const auth = authReq.user;
        // Embedded platform sessions prove a store, not a person — same
        // rejection requireAdmin applies.
        if (!auth?.userId || auth.embeddedPlatform) {
            return reply.status(401).send({ success: false, error: 'Authentication required' });
        }

        try {
            const [user] = await db
                .select({ id: users.id, email: users.email })
                .from(users)
                .where(eq(users.id, auth.userId))
                .limit(1);
            if (!user) {
                return reply.status(401).send({ success: false, error: 'Authentication required' });
            }

            const partner = await partnerPortalService.resolvePartnerForUser(user);
            if (!partner) {
                // Not a partner — the frontend redirects to the dashboard.
                return reply.status(403).send({ success: false, error: 'Not a partner account', code: 'NOT_A_PARTNER' });
            }

            const data = await partnerPortalService.getOverview(partner);
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Partner overview failed');
            return reply.status(500).send({ success: false, error: 'Failed to load partner overview' });
        }
    }
}

export const partnerController = new PartnerController();
