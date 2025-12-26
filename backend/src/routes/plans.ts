import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { plansService } from '../services/plans';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

interface PlanParams {
    planId: string;
}

interface CreatePlanBody {
    name: string;
    slug: string;
    description?: string;
    price: number;
    currency?: string;
    interval?: 'month' | 'year';
    maxPages?: number | null;
    maxAiRepliesPerMonth?: number | null;
    maxTemplates?: number | null;
    maxRules?: number | null;
    facebookEnabled?: boolean;
    instagramEnabled?: boolean;
    whatsappEnabled?: boolean;
    showBranding?: boolean;
    prioritySupport?: boolean;
    trialDays?: number;
    regionalPricing?: Record<string, number>;
    isActive?: boolean;
    isDefault?: boolean;
    sortOrder?: number;
}

/**
 * Plans Routes - Public and Admin endpoints
 */
export default async function plansRoutes(fastify: FastifyInstance) {
    // ==========================================
    // PUBLIC ROUTES (for pricing page)
    // ==========================================

    /**
     * GET /plans - Get all active plans (public)
     */
    fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const plans = await plansService.getActivePlans();
            return reply.send({
                success: true,
                data: plans,
            });
        } catch (error) {
            request.log.error(error, 'Failed to get plans');
            return reply.status(500).send({
                success: false,
                error: 'Failed to fetch plans',
            });
        }
    });

    /**
     * GET /plans/:planId - Get plan details
     */
    fastify.get<{ Params: PlanParams }>(
        '/:planId',
        async (request, reply) => {
            try {
                const plan = await plansService.getPlanById(request.params.planId);
                
                if (!plan) {
                    return reply.status(404).send({
                        success: false,
                        error: 'Plan not found',
                    });
                }
                
                return reply.send({
                    success: true,
                    data: plan,
                });
            } catch (error) {
                request.log.error(error, 'Failed to get plan');
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to fetch plan',
                });
            }
        }
    );

    // ==========================================
    // ADMIN ROUTES (require authentication + admin role)
    // ==========================================

    // Register protected admin routes
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        /**
         * GET /plans/admin/all - Get all plans including inactive (admin only)
         */
        protectedRoutes.get('/admin/all', async (request: FastifyRequest, reply: FastifyReply) => {
            try {
                // TODO: Add admin role check
                const plans = await plansService.getAllPlans();
                return reply.send({
                    success: true,
                    data: plans,
                });
            } catch (error) {
                request.log.error(error, 'Failed to get all plans');
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to fetch plans',
                });
            }
        });

        /**
         * POST /plans/admin - Create a new plan (admin only)
         */
        protectedRoutes.post<{ Body: CreatePlanBody }>(
            '/admin',
            async (request, reply) => {
                try {
                    // TODO: Add admin role check
                    const plan = await plansService.createPlan(request.body);
                    return reply.status(201).send({
                        success: true,
                        data: plan,
                    });
                } catch (error) {
                    request.log.error(error, 'Failed to create plan');
                    return reply.status(500).send({
                        success: false,
                        error: 'Failed to create plan',
                    });
                }
            }
        );

        /**
         * PUT /plans/admin/:planId - Update a plan (admin only)
         */
        protectedRoutes.put<{ Params: PlanParams; Body: Partial<CreatePlanBody> }>(
            '/admin/:planId',
            async (request, reply) => {
                try {
                    // TODO: Add admin role check
                    const plan = await plansService.updatePlan(
                        request.params.planId,
                        request.body
                    );
                    
                    if (!plan) {
                        return reply.status(404).send({
                            success: false,
                            error: 'Plan not found',
                        });
                    }
                    
                    return reply.send({
                        success: true,
                        data: plan,
                    });
                } catch (error) {
                    request.log.error(error, 'Failed to update plan');
                    return reply.status(500).send({
                        success: false,
                        error: 'Failed to update plan',
                    });
                }
            }
        );

        /**
         * DELETE /plans/admin/:planId - Soft delete a plan (admin only)
         */
        protectedRoutes.delete<{ Params: PlanParams }>(
            '/admin/:planId',
            async (request, reply) => {
                try {
                    // TODO: Add admin role check
                    const success = await plansService.deletePlan(request.params.planId);
                    
                    if (!success) {
                        return reply.status(404).send({
                            success: false,
                            error: 'Plan not found',
                        });
                    }
                    
                    return reply.send({
                        success: true,
                        message: 'Plan deleted successfully',
                    });
                } catch (error) {
                    request.log.error(error, 'Failed to delete plan');
                    return reply.status(500).send({
                        success: false,
                        error: 'Failed to delete plan',
                    });
                }
            }
        );

        /**
         * POST /plans/admin/:planId/set-default - Set plan as default (admin only)
         */
        protectedRoutes.post<{ Params: PlanParams }>(
            '/admin/:planId/set-default',
            async (request, reply) => {
                try {
                    // TODO: Add admin role check
                    const success = await plansService.setDefaultPlan(request.params.planId);
                    
                    if (!success) {
                        return reply.status(404).send({
                            success: false,
                            error: 'Plan not found',
                        });
                    }
                    
                    return reply.send({
                        success: true,
                        message: 'Default plan updated',
                    });
                } catch (error) {
                    request.log.error(error, 'Failed to set default plan');
                    return reply.status(500).send({
                        success: false,
                        error: 'Failed to set default plan',
                    });
                }
            }
        );
    });
}
