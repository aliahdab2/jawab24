import { FastifyReply, FastifyRequest } from 'fastify';
import { aiService } from '../services/ai';
import { AiGenerateRequest } from '../types';
import { AuthenticatedRequest } from '../middleware/auth';

export class AiController {
    /**
     * Generate AI reply for a comment
     * POST /ai/generate
     */
    async generate(request: FastifyRequest<{ Body: AiGenerateRequest }>, reply: FastifyReply) {
        const { comment, language, context } = request.body;

        if (!comment || comment.trim().length === 0) {
            return reply.status(400).send({ error: 'Comment is required' });
        }

        try {
            const result = await aiService.generateReply({ comment, language, context });
            return reply.send(result);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to generate AI reply' });
        }
    }

    /**
     * Enqueue AI reply generation (Async)
     * POST /ai/generate-async
     */
    async generateAsync(request: FastifyRequest<{ Body: AiGenerateRequest }>, reply: FastifyReply) {
        const user = (request as AuthenticatedRequest).user;
        const { comment } = request.body;

        if (!comment || comment.trim().length === 0) {
            return reply.status(400).send({ error: 'Comment is required' });
        }

        if (user) {
            // canUseAiReplies self-exempts demo accounts (shared fixtures with
            // no real billing) at the single choke point — no local demo check.
            const { subscriptionsService } = await import('../services/subscriptions');
            const limitCheck = await subscriptionsService.canUseAiReplies(user.userId);

            if (!limitCheck.allowed) {
                return reply.status(403).send({
                    error: limitCheck.reason || 'AI reply limit reached',
                    code: limitCheck.code,
                    limit: limitCheck.limit,
                    used: limitCheck.used,
                    resetsAt: limitCheck.resetsAt,
                });
            }
        }

        try {
            const result = await aiService.enqueueReply(request.body);
            return reply.send(result);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to enqueue AI reply' });
        }
    }

    /**
     * Get cache statistics
     * GET /ai/cache/stats
     */
    async getCacheStats(request: FastifyRequest, reply: FastifyReply) {
        try {
            const stats = await aiService.getCacheStats();
            return reply.send(stats);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to get cache stats' });
        }
    }

    /**
     * Clear cache (admin only)
     * DELETE /ai/cache
     */
    async clearCache(request: FastifyRequest, reply: FastifyReply) {
        try {
            await aiService.clearCache();
            return reply.send({ message: 'Cache cleared successfully' });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to clear cache' });
        }
    }

    /**
     * Get job status for async AI generation
     * GET /ai/jobs/:jobId
     */
    async getJobStatus(request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) {
        const { jobId } = request.params;

        if (!jobId) {
            return reply.status(400).send({ error: 'Job ID is required' });
        }

        try {
            const status = await aiService.getJobStatus(jobId);
            
            if (status.status === 'not_found') {
                return reply.status(404).send({ error: 'Job not found', jobId });
            }
            
            return reply.send(status);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to get job status' });
        }
    }
}

export const aiController = new AiController();

