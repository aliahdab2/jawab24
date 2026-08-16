import { FastifyInstance } from 'fastify';
import { instagramConnectController } from '../controllers/instagramConnect';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function instagramConnectRoutes(fastify: FastifyInstance) {
    // Owner only — same rationale as page connect: the channel credential must
    // belong to the workspace owner, not a member who may later leave.
    fastify.register(async (ownerRoutes) => {
        ownerRoutes.addHook('preHandler', authenticate);
        ownerRoutes.addHook('preHandler', resolveWorkspace);
        ownerRoutes.addHook('preHandler', requireRole('owner'));

        ownerRoutes.post('/auth/instagram/start', {
            schema: {
                tags: ['Instagram'],
                summary: 'Mint single-use state and return the Instagram Login authorize URL (owner only)',
                security: auth,
            },
        }, instagramConnectController.start);
    });

    // PUBLIC: instagram.com navigates the merchant's browser here. Replay
    // defence is the single-use state consumed inside the handler.
    fastify.get('/auth/instagram/callback', {
        schema: {
            tags: ['Instagram'],
            summary: 'Instagram Login OAuth callback (public, serves the app-return page)',
        },
    }, instagramConnectController.callback);
}
