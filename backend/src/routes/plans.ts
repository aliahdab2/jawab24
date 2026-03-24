import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { plansService } from '../services/plans';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { CreatePlanSchema, UpdatePlanSchema, UUIDSchema, validateSchema } from '../utils/validation';
import { auth } from '../utils/swagger';

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
    fastify.get('/', { schema: { tags: ['Plans'], summary: 'Get all active plans (public)' } }, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const plans = await plansService.getActivePlans();
            return reply
                .header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
                .send({
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
     * GET /plans/:planId - Get plan details by ID or slug (public)
     */
    fastify.get<{ Params: PlanParams }>(
        '/:planId',
        { schema: { tags: ['Plans'], summary: 'Get plan details by ID or slug (public)', params: { type: 'object', properties: { planId: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['planId'] } } },
        async (request, reply) => {
            try {
                const { planId } = request.params;

                // Try UUID lookup first, fall back to slug lookup
                const plan = UUIDSchema.safeParse(planId).success
                    ? await plansService.getPlanById(planId)
                    : await plansService.getPlanBySlug(planId);

                if (!plan) {
                    return reply.status(404).send({
                        success: false,
                        error: 'Plan not found',
                    });
                }

                return reply
                    .header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
                    .send({
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
        protectedRoutes.get('/admin/all', { schema: { tags: ['Plans'], summary: 'Get all plans including inactive (admin)', security: auth } }, async (request: FastifyRequest, reply: FastifyReply) => {
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
            { schema: { tags: ['Plans'], summary: 'Create a new plan (admin)', security: auth } },
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
            { schema: { tags: ['Plans'], summary: 'Update a plan (admin)', security: auth, params: { type: 'object', properties: { planId: { type: 'string', format: 'uuid' } }, required: ['planId'] } } },
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
            { schema: { tags: ['Plans'], summary: 'Soft delete a plan (admin)', security: auth, params: { type: 'object', properties: { planId: { type: 'string', format: 'uuid' } }, required: ['planId'] } } },
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
            { schema: { tags: ['Plans'], summary: 'Set plan as default (admin)', security: auth, params: { type: 'object', properties: { planId: { type: 'string', format: 'uuid' } }, required: ['planId'] } } },
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
