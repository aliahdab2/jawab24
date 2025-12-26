import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { subscriptionsService } from '../services/subscriptions';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

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

        /**
         * GET /subscription - Get current user's subscription
         */
        protectedRoutes.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
            const { userId } = (request as AuthenticatedRequest).user!;
            
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
        protectedRoutes.get('/usage', async (request: FastifyRequest, reply: FastifyReply) => {
            const { userId } = (request as AuthenticatedRequest).user!;
            
            try {
                const usage = await subscriptionsService.getUsageSummary(userId);
                
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
        protectedRoutes.get('/limits/ai', async (request: FastifyRequest, reply: FastifyReply) => {
            const { userId } = (request as AuthenticatedRequest).user!;
            
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
        protectedRoutes.get('/limits/pages', async (request: FastifyRequest, reply: FastifyReply) => {
            const { userId } = (request as AuthenticatedRequest).user!;
            
            try {
                const result = await subscriptionsService.canAddPage(userId);

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
        protectedRoutes.get('/limits/templates', async (request: FastifyRequest, reply: FastifyReply) => {
            const { userId } = (request as AuthenticatedRequest).user!;
            
            try {
                const result = await subscriptionsService.canAddTemplate(userId);

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
        protectedRoutes.get('/limits/rules', async (request: FastifyRequest, reply: FastifyReply) => {
            const { userId } = (request as AuthenticatedRequest).user!;
            
            try {
                const result = await subscriptionsService.canAddRule(userId);

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
            async (request, reply) => {
                const { userId } = (request as AuthenticatedRequest).user!;
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
            async (request, reply) => {
                const { userId } = (request as AuthenticatedRequest).user!;
                
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
        protectedRoutes.post('/pause', async (request: FastifyRequest, reply: FastifyReply) => {
            const { userId } = (request as AuthenticatedRequest).user!;
            
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
        protectedRoutes.post('/resume', async (request: FastifyRequest, reply: FastifyReply) => {
            const { userId } = (request as AuthenticatedRequest).user!;
            
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
