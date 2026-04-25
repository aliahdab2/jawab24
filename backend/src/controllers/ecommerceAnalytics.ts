import { FastifyReply } from 'fastify';
import { getStoreById } from '../services/ecommerce';
import { getStoreAnalytics, type AnalyticsRange } from '../services/ecommerceAnalytics';
import { captureError } from '../utils/sentryHelpers';
import type { WorkspaceRequest } from '../middleware/workspace';

const VALID_RANGES: ReadonlySet<AnalyticsRange> = new Set(['30d', '90d']);

/** GET /api/ecommerce-analytics/:storeId?range=30d|90d */
export async function getAnalytics(request: WorkspaceRequest, reply: FastifyReply) {
    const { storeId } = request.params as { storeId: string };
    const { range: rawRange } = request.query as { range?: string };

    const range: AnalyticsRange = VALID_RANGES.has(rawRange as AnalyticsRange)
        ? (rawRange as AnalyticsRange)
        : '30d';

    if (!request.workspaceId) {
        return reply.status(401).send({ error: 'Workspace context required' });
    }

    const store = await getStoreById(storeId);
    if (!store) {
        return reply.status(404).send({ error: 'Store not found' });
    }
    if (store.workspaceId !== request.workspaceId) {
        return reply.status(403).send({ error: 'Store does not belong to this workspace' });
    }

    try {
        const overview = await getStoreAnalytics(storeId, range);
        return reply.send(overview);
    } catch (error) {
        captureError(error, 'Failed to load ecommerce analytics', {
            tags: { service: 'ecommerce-analytics', storeId },
        });
        return reply.status(500).send({ error: 'Failed to load analytics' });
    }
}
