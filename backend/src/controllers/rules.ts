import { FastifyReply, FastifyRequest } from 'fastify';
import { rulesService } from '../services/rules';
import { subscriptionsService } from '../services/subscriptions';
import { CreateRuleDTO, UpdateRuleDTO } from '../types';
import type { WorkspaceRequest } from '../middleware/workspace';
import { PaginationSchema, CreateRuleSchema, UpdateRuleSchema, UUIDSchema, validateSchema } from '../utils/validation';

interface PaginationQuery {
    page?: string;
    limit?: string;
}

export class RulesController {
    /**
     * Create a new rule
     * POST /rules
     */
    async create(request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = req.user;
        const { workspaceId } = req;

        // Validate request body
        const validation = validateSchema(CreateRuleSchema, request.body);
        if (!validation.success) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: validation.errors,
            });
        }

        try {
            // Check rule limit (billing stays per-user)
            const limitCheck = await subscriptionsService.canAddRule(userId, workspaceId);
            if (!limitCheck.allowed) {
                return reply.status(403).send({
                    error: limitCheck.reason || 'Rule limit reached',
                    limit: limitCheck.limit,
                    used: limitCheck.used,
                });
            }

            const rule = await rulesService.createRule(workspaceId, validation.data as CreateRuleDTO);
            return reply.status(201).send(rule);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to create rule' });
        }
    }

    /**
     * Get all rules with pagination
     * GET /rules?page=1&limit=20
     */
    async getAll(request: FastifyRequest<{ Querystring: PaginationQuery }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        // Validate pagination params
        const paginationResult = PaginationSchema.safeParse(request.query);
        const page = paginationResult.success ? paginationResult.data.page : 1;
        const limit = paginationResult.success ? paginationResult.data.limit : 20;

        try {
            const result = await rulesService.getRules(req.workspaceId, { page, limit });
            return reply.send(result);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch rules' });
        }
    }

    /**
     * Get a single rule
     * GET /rules/:id
     */
    async getOne(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        // Validate UUID
        const idValidation = UUIDSchema.safeParse(id);
        if (!idValidation.success) {
            return reply.status(400).send({ error: 'Invalid rule ID format' });
        }

        try {
            const rule = await rulesService.getRule(req.workspaceId, id);
            if (!rule) {
                return reply.status(404).send({ error: 'Rule not found' });
            }
            return reply.send(rule);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch rule' });
        }
    }

    /**
     * Update a rule
     * PUT /rules/:id
     */
    async update(request: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        // Validate UUID
        const idValidation = UUIDSchema.safeParse(id);
        if (!idValidation.success) {
            return reply.status(400).send({ error: 'Invalid rule ID format' });
        }

        // Validate request body
        const validation = validateSchema(UpdateRuleSchema, request.body);
        if (!validation.success) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: validation.errors,
            });
        }

        try {
            const rule = await rulesService.updateRule(req.workspaceId, id, validation.data as UpdateRuleDTO);
            if (!rule) {
                return reply.status(404).send({ error: 'Rule not found' });
            }
            return reply.send(rule);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to update rule' });
        }
    }

    /**
     * Delete a rule
     * DELETE /rules/:id
     */
    async delete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        // Validate UUID
        const idValidation = UUIDSchema.safeParse(id);
        if (!idValidation.success) {
            return reply.status(400).send({ error: 'Invalid rule ID format' });
        }

        try {
            await rulesService.deleteRule(req.workspaceId, id);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to delete rule' });
        }
    }
}

export const rulesController = new RulesController();
