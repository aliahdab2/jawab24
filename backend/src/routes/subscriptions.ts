import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { subscriptionsService } from '../services/subscriptions';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace } from '../middleware/workspace';
import type { WorkspaceRequest } from '../middleware/workspace';
import { auth } from '../utils/swagger';
import { config } from '../config';

/**
 * Subscriptions Routes - User subscription read endpoints.
 *
 * Mutations (cancel, change plan) live under /payment/* so they always go
 * through Stripe. The DB-only helpers that used to back /subscription/cancel,
 * /subscription/pause, /subscription/resume, /subscription/change-plan were
 * removed because they silently desynced from Stripe (customer kept being
 * billed). All cancel/change-plan flows now route to /payment/cancel-subscription
 * and /payment/change-plan.
 */
export default async function subscriptionsRoutes(fastify: FastifyInstance) {
    /**
     * GET /subscription/topup/config - Return packs + WhatsApp contact for the
     * top-up purchase UI (modal pack picker + the /checkout?topup= page).
     *
     * PUBLIC (no auth) — mirrors the public /plans/:id endpoint. It returns only
     * static pack pricing + the public support WhatsApp number, no user data. It
     * must be reachable unauthenticated so /checkout?topup= can render its order
     * summary + in-page login gate for a logged-out visitor (deep link, expired
     * session, the iOS→web bounce), exactly like the subscription checkout does.
     *
     * Empty whatsappNumber means the manual path is disabled in the UI.
     */
    fastify.get(
        '/topup/config',
        { schema: { tags: ['Subscriptions'], summary: 'Get top-up packs and contact channels' } },
        async (_request: FastifyRequest, reply: FastifyReply) => {
            return reply.send({
                success: true,
                data: {
                    // Card top-up kill-switch — the UI uses this to hide the
                    // "Pay with card" path and gate the /checkout?topup= page.
                    // The manual WhatsApp path stays available independently.
                    enabled: config.topup.enabled,
                    packs: config.topup.packs,
                    currency: config.topup.currency,
                    whatsappNumber: config.topup.whatsappNumber,
                },
            });
        }
    );

    // All routes require authentication
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);
        protectedRoutes.addHook('preHandler', resolveWorkspace);

        /**
         * GET /subscription - Get current user's subscription
         */
        protectedRoutes.get('/', { schema: { tags: ['Subscriptions'], summary: 'Get current user subscription', security: auth } }, async (request: FastifyRequest, reply: FastifyReply) => {
            const user = (request as WorkspaceRequest).user;
            if (!user) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            const { userId } = user;
            
            try {
                const subscription = await subscriptionsService.getUserSubscription(userId);
                
                if (!subscription) {
                    return reply.status(404).send({
                        success: false,
                        error: 'No subscription found',
                    });
                }

                return reply.send({
                    success: true,
                    data: subscription,
                });
            } catch (error) {
                request.log.error(error, 'Failed to get subscription');
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to fetch subscription',
                });
            }
        });

        /**
         * GET /subscription/usage - Get current usage summary
         */
        protectedRoutes.get('/usage', { schema: { tags: ['Subscriptions'], summary: 'Get current usage summary', security: auth } }, async (request: FastifyRequest, reply: FastifyReply) => {
            const req = request as WorkspaceRequest;
            if (!req.user || !req.workspaceId) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            const { userId } = req.user;

            try {
                const usage = await subscriptionsService.getUsageSummary(userId, req.workspaceId);
                
                if (!usage) {
                    return reply.status(404).send({
                        success: false,
                        error: 'No usage data found',
                    });
                }

                return reply.send({
                    success: true,
                    data: usage,
                });
            } catch (error) {
                request.log.error(error, 'Failed to get usage');
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to fetch usage',
                });
            }
        });

        /**
         * GET /subscription/limits/ai - Check AI reply limits
         */
        protectedRoutes.get('/limits/ai', { schema: { tags: ['Subscriptions'], summary: 'Check AI reply limits', security: auth } }, async (request: FastifyRequest, reply: FastifyReply) => {
            const req = request as WorkspaceRequest;
            const user = req.user;
            if (!user) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            const { userId } = user;

            try {
                // Demo accounts are exempted inside canUseAiReplies (the single
                // choke point), so this UI-facing check agrees with enforcement.
                // Workspace-scoped: quota belongs to the workspace, not to
                // whoever is logged in. The resolution lives in the service so
                // this and /usage cannot drift apart (see
                // canUseAiRepliesForWorkspace).
                const result = req.workspaceId
                    ? await subscriptionsService.canUseAiRepliesForWorkspace(userId, req.workspaceId)
                    : await subscriptionsService.canUseAiReplies(userId);

                return reply.send({
                    success: true,
                    data: result,
                });
            } catch (error) {
                request.log.error(error, 'Failed to check AI limits');
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to check limits',
                });
            }
        });

        /**
         * GET /subscription/limits/pages - Check page limits
         */
        protectedRoutes.get('/limits/pages', { schema: { tags: ['Subscriptions'], summary: 'Check page limits', security: auth } }, async (request: FastifyRequest, reply: FastifyReply) => {
            const req = request as WorkspaceRequest;
            if (!req.user || !req.workspaceId) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            const { userId } = req.user;

            try {
                const result = await subscriptionsService.canAddPage(userId, req.workspaceId);

                return reply.send({
                    success: true,
                    data: result,
                });
            } catch (error) {
                request.log.error(error, 'Failed to check page limits');
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to check limits',
                });
            }
        });

    });
}
