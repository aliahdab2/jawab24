import { FastifyReply, FastifyRequest } from 'fastify';
import { templatesService } from '../services/templates';
import { subscriptionsService } from '../services/subscriptions';
import { CreateTemplateDTO, UpdateTemplateDTO } from '../types';
import type { WorkspaceRequest } from '../middleware/workspace';

export class TemplatesController {
    /**
     * Create a new template
     * POST /templates
     */
    async create(request: FastifyRequest<{ Body: CreateTemplateDTO }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = req.user;
        const { workspaceId } = req;

        try {
            // Check template limit (billing stays per-user)
            const limitCheck = await subscriptionsService.canAddTemplate(userId, workspaceId);
            if (!limitCheck.allowed) {
                return reply.status(403).send({
                    error: limitCheck.reason || 'Template limit reached',
                    limit: limitCheck.limit,
                    used: limitCheck.used,
                });
            }

            const template = await templatesService.createTemplate(workspaceId, request.body);
            return reply.status(201).send(template);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to create template' });
        }
    }

    /**
     * Get all templates
     * GET /templates
     */
    async getAll(request: FastifyRequest, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const templates = await templatesService.getTemplates(req.workspaceId);
            return reply.send(templates);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch templates' });
        }
    }

    /**
     * Get a single template
     * GET /templates/:id
     */
    async getOne(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        try {
            const template = await templatesService.getTemplate(req.workspaceId, id);
            if (!template) {
                return reply.status(404).send({ error: 'Template not found' });
            }
            return reply.send(template);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch template' });
        }
    }

    /**
     * Update a template
     * PUT /templates/:id
     */
    async update(request: FastifyRequest<{ Params: { id: string }; Body: UpdateTemplateDTO }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        try {
            const template = await templatesService.updateTemplate(req.workspaceId, id, request.body);
            if (!template) {
                return reply.status(404).send({ error: 'Template not found' });
            }
            return reply.send(template);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to update template' });
        }
    }

    /**
     * Delete a template
     * DELETE /templates/:id
     */
    async delete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        try {
            await templatesService.deleteTemplate(req.workspaceId, id);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to delete template' });
        }
    }
}

export const templatesController = new TemplatesController();
