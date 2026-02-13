import { FastifyReply, FastifyRequest } from 'fastify';
import { templatesService } from '../services/templates';
import { subscriptionsService } from '../services/subscriptions';
import { CreateTemplateDTO, UpdateTemplateDTO } from '../types';
import { AuthenticatedRequest } from '../middleware/auth';
import { autoTranslateTranslations } from '../utils/translate';

export class TemplatesController {
    /**
     * Create a new template
     * POST /templates
     */
    async create(request: FastifyRequest<{ Body: CreateTemplateDTO }>, reply: FastifyReply) {
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        
        try {
            // Check template limit before creating
            const limitCheck = await subscriptionsService.canAddTemplate(userId);
            if (!limitCheck.allowed) {
                return reply.status(403).send({ 
                    error: limitCheck.reason || 'Template limit reached',
                    limit: limitCheck.limit,
                    used: limitCheck.used,
                });
            }
            
            // Auto-translate missing language
            if (request.body.translations) {
                try {
                    request.body.translations = await autoTranslateTranslations(request.body.translations);
                } catch { /* graceful degradation */ }
            }

            const template = await templatesService.createTemplate(userId, request.body);
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
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        
        try {
            const templates = await templatesService.getTemplates(userId);
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
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        const { id } = request.params;
        
        try {
            const template = await templatesService.getTemplate(userId, id);
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
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        const { id } = request.params;
        
        try {
            // Auto-translate missing language
            if (request.body.translations) {
                try {
                    request.body.translations = await autoTranslateTranslations(request.body.translations);
                } catch { /* graceful degradation */ }
            }

            const template = await templatesService.updateTemplate(userId, id, request.body);
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
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        const { id } = request.params;
        
        try {
            await templatesService.deleteTemplate(userId, id);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to delete template' });
        }
    }
}

export const templatesController = new TemplatesController();

