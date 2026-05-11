import { FastifyReply, FastifyRequest } from 'fastify';
import { analyticsService } from '../services/analytics';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';

export class AnalyticsController {
    async getAiUsage(request: FastifyRequest<{
        Querystring: { days?: string }
    }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const days = Math.min(Math.max(Number(request.query.days) || 30, 1), 365);
            // AI usage is billing/cost tracking — stays per-user
            const report = await analyticsService.getAiUsage(req.user.userId, days);
            return reply.send(report);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch AI usage' });
        }
    }

    async getAiUsageGlobal(request: FastifyRequest<{
        Querystring: { days?: string }
    }>, reply: FastifyReply) {
        try {
            const days = Math.min(Math.max(Number(request.query.days) || 30, 1), 365);
            const report = await analyticsService.getAiUsageGlobal(days);
            return reply.send(report);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch global AI usage' });
        }
    }

    async getOverview(request: FastifyRequest<{
        Querystring: {
            days?: string;
            pageId?: string;
        }
    }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;

        try {
            const days = Math.min(Math.max(Number(request.query.days) || 30, 1), 365);
            const overview = await analyticsService.getOverview(req.workspaceId, days, request.query.pageId);
            return reply.send(overview);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch analytics' });
        }
    }
}

export const analyticsController = new AnalyticsController();
