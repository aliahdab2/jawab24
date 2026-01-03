import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { plansService } from '../services/plans';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { CreatePlanSchema, UpdatePlanSchema, UUIDSchema, validateSchema, formatValidationErrors } from '../utils/validation';

interface PlanParams {
    planId: string;
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
        // Add authentication and admin role check to all routes in this context
        protectedRoutes.addHook('preHandler', authenticate);
        protectedRoutes.addHook('preHandler', requireAdmin);

        /**
         * GET /plans/admin/all - Get all plans including inactive (admin only)
         */
        protectedRoutes.get('/admin/all', async (request: FastifyRequest, reply: FastifyReply) => {
            try {
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
        protectedRoutes.post<{ Body: unknown }>(
            '/admin',
            async (request, reply) => {
                // Validate request body
                const validation = validateSchema(CreatePlanSchema, request.body);
                if (!validation.success) {
                    return reply.status(400).send({
                        success: false,
                        error: 'Validation failed',
                        details: validation.errors,
                    });
                }

                try {
                    const plan = await plansService.createPlan(validation.data);
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
        protectedRoutes.put<{ Params: PlanParams; Body: unknown }>(
            '/admin/:planId',
            async (request, reply) => {
                // Validate plan ID
                const idValidation = UUIDSchema.safeParse(request.params.planId);
                if (!idValidation.success) {
                    return reply.status(400).send({
                        success: false,
                        error: 'Invalid plan ID format',
                    });
                }

                // Validate request body
                const validation = validateSchema(UpdatePlanSchema, request.body);
                if (!validation.success) {
                    return reply.status(400).send({
                        success: false,
                        error: 'Validation failed',
                        details: validation.errors,
                    });
                }

                try {
                    const plan = await plansService.updatePlan(
                        request.params.planId,
                        validation.data
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
                // Validate plan ID
                const idValidation = UUIDSchema.safeParse(request.params.planId);
                if (!idValidation.success) {
                    return reply.status(400).send({
                        success: false,
                        error: 'Invalid plan ID format',
                    });
                }

                try {
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
                // Validate plan ID
                const idValidation = UUIDSchema.safeParse(request.params.planId);
                if (!idValidation.success) {
                    return reply.status(400).send({
                        success: false,
                        error: 'Invalid plan ID format',
                    });
                }

                try {
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
