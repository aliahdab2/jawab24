import { FastifyReply, FastifyRequest } from 'fastify';
import { analyticsService } from '../services/analytics';
import { AuthenticatedRequest } from '../middleware/auth';

export class AnalyticsController {
    async getAiUsage(request: FastifyRequest<{
        Querystring: { days?: string }
    }>, reply: FastifyReply) {
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const days = Math.min(Math.max(Number(request.query.days) || 30, 1), 365);
            const report = await analyticsService.getAiUsage(user.userId, days);
            return reply.send(report);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch AI usage' });
        }
    }

    async getOverview(request: FastifyRequest<{
        Querystring: {
            days?: string;
            pageId?: string;
        }
    }>, reply: FastifyReply) {
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const days = Math.min(Math.max(Number(request.query.days) || 30, 1), 365);
            const overview = await analyticsService.getOverview(user.userId, days, request.query.pageId);
            return reply.send(overview);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch analytics' });
        }
    }
}

export const analyticsController = new AnalyticsController();
