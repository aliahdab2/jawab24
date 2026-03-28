import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { subscriptionsService } from '../services/subscriptions';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace } from '../middleware/workspace';
import type { WorkspaceRequest } from '../middleware/workspace';
import { auth } from '../utils/swagger';
import { config } from '../config';
import { authService } from '../services/auth';

interface ChangePlanBody {
    planId: string;
}

interface CancelBody {
    reason?: string;
}

/**
 * Subscriptions Routes - User subscription management
 */
export default async function subscriptionsRoutes(fastify: FastifyInstance) {
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
            const user = (request as WorkspaceRequest).user;
            if (!user) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            const { userId } = user;

            // Demo users always have unlimited AI access
            const dbUser = config.demo.enabled ? await authService.getUserById(userId) : null;
            if (dbUser?.facebookId === config.demo.userFacebookId) {
                return reply.send({ success: true, data: { allowed: true } });
            }

            try {
                const result = await subscriptionsService.canUseAiReplies(userId);

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

        /**
         * GET /subscription/limits/templates - Check template limits
         */
        protectedRoutes.get('/limits/templates', { schema: { tags: ['Subscriptions'], summary: 'Check template limits', security: auth } }, async (request: FastifyRequest, reply: FastifyReply) => {
            const req = request as WorkspaceRequest;
            if (!req.user || !req.workspaceId) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            const { userId } = req.user;

            try {
                const result = await subscriptionsService.canAddTemplate(userId, req.workspaceId);

                return reply.send({
                    success: true,
                    data: result,
                });
            } catch (error) {
                request.log.error(error, 'Failed to check template limits');
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to check limits',
                });
            }
        });

        /**
         * GET /subscription/limits/rules - Check rule limits
         */
        protectedRoutes.get('/limits/rules', { schema: { tags: ['Subscriptions'], summary: 'Check rule limits', security: auth } }, async (request: FastifyRequest, reply: FastifyReply) => {
            const req = request as WorkspaceRequest;
            if (!req.user || !req.workspaceId) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            const { userId } = req.user;

            try {
                const result = await subscriptionsService.canAddRule(userId, req.workspaceId);

                return reply.send({
                    success: true,
                    data: result,
                });
            } catch (error) {
                request.log.error(error, 'Failed to check rule limits');
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to check limits',
                });
            }
        });

        /**
         * POST /subscription/change-plan - Change subscription plan
         */
        protectedRoutes.post<{ Body: ChangePlanBody }>(
            '/change-plan',
            { schema: { tags: ['Subscriptions'], summary: 'Change subscription plan', security: auth } },
            async (request, reply) => {
                const user = (request as WorkspaceRequest).user;
                if (!user) {
                    return reply.status(401).send({ error: 'Unauthorized' });
                }
                const { userId } = user;
                const { planId } = request.body;
                
                try {
                    if (!planId) {
                        return reply.status(400).send({
                            success: false,
                            error: 'Plan ID is required',
                        });
                    }

                    const subscription = await subscriptionsService.changePlan(userId, planId);

                    if (!subscription) {
                        return reply.status(400).send({
                            success: false,
                            error: 'Failed to change plan',
                        });
                    }

                    return reply.send({
                        success: true,
                        data: subscription,
                        message: 'Plan changed successfully',
                    });
                } catch (error) {
                    request.log.error(error, 'Failed to change plan');
                    return reply.status(500).send({
                        success: false,
                        error: error instanceof Error ? error.message : 'Failed to change plan',
                    });
                }
            }
        );

        /**
         * POST /subscription/cancel - Cancel subscription
         */
        protectedRoutes.post<{ Body: CancelBody }>(
            '/cancel',
            { schema: { tags: ['Subscriptions'], summary: 'Cancel subscription', security: auth } },
            async (request, reply) => {
                const user = (request as WorkspaceRequest).user;
                if (!user) {
                    return reply.status(401).send({ error: 'Unauthorized' });
                }
                const { userId } = user;
                
                try {
                    const subscription = await subscriptionsService.cancelSubscription(
                        userId,
                        request.body.reason
                    );

                    if (!subscription) {
                        return reply.status(400).send({
                            success: false,
                            error: 'Failed to cancel subscription',
                        });
                    }

                    return reply.send({
                        success: true,
                        data: subscription,
                        message: 'Subscription canceled',
                    });
                } catch (error) {
                    request.log.error(error, 'Failed to cancel subscription');
                    return reply.status(500).send({
                        success: false,
                        error: 'Failed to cancel subscription',
                    });
                }
            }
        );

        /**
         * POST /subscription/pause - Pause subscription
         */
        protectedRoutes.post('/pause', { schema: { tags: ['Subscriptions'], summary: 'Pause subscription', security: auth } }, async (request: FastifyRequest, reply: FastifyReply) => {
            const user = (request as WorkspaceRequest).user;
            if (!user) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            const { userId } = user;
            
            try {
                const subscription = await subscriptionsService.pauseSubscription(userId);

                if (!subscription) {
                    return reply.status(400).send({
                        success: false,
                        error: 'Failed to pause subscription',
                    });
                }

                return reply.send({
                    success: true,
                    data: subscription,
                    message: 'Subscription paused',
                });
            } catch (error) {
                request.log.error(error, 'Failed to pause subscription');
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to pause subscription',
                });
            }
        });

        /**
         * POST /subscription/resume - Resume subscription
         */
        protectedRoutes.post('/resume', { schema: { tags: ['Subscriptions'], summary: 'Resume subscription', security: auth } }, async (request: FastifyRequest, reply: FastifyReply) => {
            const user = (request as WorkspaceRequest).user;
            if (!user) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            const { userId } = user;
            
            try {
                const subscription = await subscriptionsService.resumeSubscription(userId);

                if (!subscription) {
                    return reply.status(400).send({
                        success: false,
                        error: 'Failed to resume subscription',
                    });
                }

                return reply.send({
                    success: true,
                    data: subscription,
                    message: 'Subscription resumed',
                });
            } catch (error) {
                request.log.error(error, 'Failed to resume subscription');
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to resume subscription',
                });
            }
        });
    });
}
