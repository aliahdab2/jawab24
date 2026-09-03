import type { FastifyRequest, FastifyReply } from 'fastify';
import type { WorkspaceRequest } from '../middleware/workspace';
import {
    getStoreByWorkspaceAny,
    registerWebhooksWithPersist,
    type EcommercePlatform,
} from '../services/ecommerce';
import { integrationRegistry, toStoreForWebhooks } from '../integrations/registry';

/**
 * Factory for the shared "Re-register webhooks" handler.
 *
 * Mounted under each platform's route prefix (e.g. POST /shopify/store/webhooks/reregister,
 * POST /salla/store/webhooks/reregister) so existing client URLs keep working,
 * while the implementation is one platform-agnostic function. The frontend
 * calls `ecommerceApi.reregisterWebhooks(platform)` which hits the right URL.
 *
 * Behavior mirrors the install path: persist-on-throw, retry queue enqueue
 * on partial failure, response shape `{ ok, webhookStatus }`.
 */
export function createReregisterHandler(platform: EcommercePlatform) {
    return async function reregister(request: FastifyRequest, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });

        const adapter = integrationRegistry.get(platform);
        if (!adapter) {
            return reply.status(404).send({ error: `Platform ${platform} is not registered` });
        }

        const store = await getStoreByWorkspaceAny(platform, req.workspaceId);
        if (!store) {
            return reply.status(404).send({ error: `No ${platform} store connected` });
        }
        if (!store.isActive) {
            return reply.status(409).send({ error: 'Store is disconnected — reconnect first' });
        }

        const status = await registerWebhooksWithPersist(
            store.id,
            platform,
            () => adapter.registerWebhooks(toStoreForWebhooks(store)),
        );
        return reply.send({ ok: status.failed.length === 0, webhookStatus: status });
    };
}
