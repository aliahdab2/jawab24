import { FastifyReply, FastifyRequest } from 'fastify';
import { rulesService } from '../services/rules';
import { CreateRuleDTO, UpdateRuleDTO } from '../types';
import { AuthenticatedRequest } from '../middleware/auth';

export class RulesController {
    /**
     * Create a new rule
     * POST /rules
     */
    async create(request: FastifyRequest<{ Body: CreateRuleDTO }>, reply: FastifyReply) {
        const { userId } = (request as AuthenticatedRequest).user!;
        
        try {
            const rule = await rulesService.createRule(userId, request.body);
            return reply.status(201).send(rule);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to create rule' });
        }
    }

    /**
     * Get all rules
     * GET /rules
     */
    async getAll(request: FastifyRequest, reply: FastifyReply) {
        const { userId } = (request as AuthenticatedRequest).user!;
        
        try {
            const rules = await rulesService.getRules(userId);
            return reply.send(rules);
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
        const { userId } = (request as AuthenticatedRequest).user!;
        const { id } = request.params;
        
        try {
            const rule = await rulesService.getRule(userId, id);
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
    async update(request: FastifyRequest<{ Params: { id: string }; Body: UpdateRuleDTO }>, reply: FastifyReply) {
        const { userId } = (request as AuthenticatedRequest).user!;
        const { id } = request.params;
        
        try {
            const rule = await rulesService.updateRule(userId, id, request.body);
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
        const { userId } = (request as AuthenticatedRequest).user!;
        const { id } = request.params;
        
        try {
            await rulesService.deleteRule(userId, id);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to delete rule' });
        }
    }
}

export const rulesController = new RulesController();

