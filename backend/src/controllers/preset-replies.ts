import { FastifyReply, FastifyRequest } from 'fastify';
import presetRepliesService, { CreatePresetReplyDTO, UpdatePresetReplyDTO } from '../services/preset-replies';
import type { WorkspaceRequest } from '../middleware/workspace';

export class PresetRepliesController {
    /**
     * GET /preset-replies
     */
    async getAll(request: FastifyRequest, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        try {
            const data = await presetRepliesService.getAll(req.workspaceId);
            return reply.send(data);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch preset replies' });
        }
    }

    /**
     * POST /preset-replies
     */
    async create(request: FastifyRequest<{ Body: CreatePresetReplyDTO }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { keywords, message } = request.body;
        if (!keywords?.length || !message?.trim()) {
            return reply.status(400).send({ error: 'keywords and message are required' });
        }
        try {
            const data = await presetRepliesService.create(req.workspaceId, { keywords, message });
            return reply.status(201).send(data);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to create preset reply' });
        }
    }

    /**
     * PUT /preset-replies/:id
     */
    async update(request: FastifyRequest<{ Params: { id: string }; Body: UpdatePresetReplyDTO }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;
        try {
            await presetRepliesService.update(req.workspaceId, id, request.body);
            return reply.status(200).send({ success: true });
        } catch (error) {
            if (error instanceof Error && error.message === 'Not found') {
                return reply.status(404).send({ error: 'Preset reply not found' });
            }
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to update preset reply' });
        }
    }

    /**
     * DELETE /preset-replies/:id
     */
    async delete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;
        try {
            await presetRepliesService.delete(req.workspaceId, id);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to delete preset reply' });
        }
    }
}

export const presetRepliesController = new PresetRepliesController();
