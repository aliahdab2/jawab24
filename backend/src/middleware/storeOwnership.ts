import { FastifyReply } from 'fastify';
import { getStoreById } from '../services/ecommerce';
import type { WorkspaceRequest } from './workspace';

type EcommerceStore = NonNullable<Awaited<ReturnType<typeof getStoreById>>>;

export interface StoreRequest extends WorkspaceRequest {
    store?: EcommerceStore;
}

/**
 * Narrowed type used inside controllers — `store` is guaranteed because
 * `requireOwnedStore` always sets it before any handler runs. Cast to this
 * type inside the handler (same convention as `ResolvedWorkspaceRequest`):
 * Fastify's handler signature does not accept a request type with a required
 * extra property, so the base interface keeps it optional.
 */
export type ResolvedStoreRequest = StoreRequest & { store: EcommerceStore };

/**
 * Fastify preHandler for every route that takes a client-supplied `:storeId`.
 *
 * A `storeId` in the URL is untrusted input. Without this guard any
 * authenticated user could read or edit another merchant's store-scoped data
 * simply by guessing a UUID — which is exactly what the customer-notification
 * routes allowed until 2026-08-23 (the notification log carries customer phone
 * numbers and message bodies). Enforced as middleware rather than per handler
 * so a new route cannot forget it, mirroring `resolveWorkspace` / `requireRole`.
 *
 * Must run AFTER `authenticate` and `resolveWorkspace`. On success the store is
 * attached as `request.store` so handlers need not reload it.
 *
 * Responses deliberately match the pre-existing contract of the analytics
 * controller (401 / 404 / 403) so its consumers see no change.
 */
export async function requireOwnedStore(request: WorkspaceRequest, reply: FastifyReply) {
    const { storeId } = request.params as { storeId?: string };

    if (!request.workspaceId) {
        return reply.status(401).send({ error: 'Workspace context required' });
    }
    if (!storeId) {
        return reply.status(400).send({ error: 'storeId is required' });
    }

    const store = await getStoreById(storeId);
    if (!store) {
        return reply.status(404).send({ error: 'Store not found' });
    }
    if (store.workspaceId !== request.workspaceId) {
        // Logged so a probing client is visible, like the workspace-scope denial
        // in resolveWorkspace. The storeId is the attacker's guess, not a secret.
        request.log.warn(
            { userId: request.user?.userId, workspaceId: request.workspaceId, storeId, route: request.url },
            'Store access denied: store belongs to a different workspace',
        );
        return reply.status(403).send({ error: 'Store does not belong to this workspace' });
    }

    (request as StoreRequest).store = store;
}
