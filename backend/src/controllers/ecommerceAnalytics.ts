import { FastifyReply } from 'fastify';
import { getStoreAnalytics, type AnalyticsRange } from '../services/ecommerceAnalytics';
import { captureError } from '../utils/sentryHelpers';
import type { StoreRequest, ResolvedStoreRequest } from '../middleware/storeOwnership';

const VALID_RANGES: ReadonlySet<AnalyticsRange> = new Set(['30d', '90d']);

/**
 * GET /api/ecommerce-analytics/:storeId?range=30d|90d
 * Workspace resolution and store ownership are enforced by the route's
 * preHandlers (`resolveWorkspace`, `requireOwnedStore`); by the time this
 * runs, `request.store` is loaded and proven to belong to the caller.
 */
export async function getAnalytics(request: StoreRequest, reply: FastifyReply) {
    const storeId = (request as ResolvedStoreRequest).store.id;
    const { range: rawRange } = request.query as { range?: string };

    const range: AnalyticsRange = VALID_RANGES.has(rawRange as AnalyticsRange)
        ? (rawRange as AnalyticsRange)
        : '30d';

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
