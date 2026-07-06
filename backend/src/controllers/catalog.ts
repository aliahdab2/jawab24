import { FastifyReply, FastifyRequest } from 'fastify';
import { catalogService, CatalogLimitError, CatalogStoreConflictError } from '../services/catalog';
import { CatalogItemSchema, CatalogItemUpdateSchema, formatValidationErrors } from '../utils/validation';
import { recordActivationEvent } from '../services/activation';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';

/**
 * Native catalog CRUD — /pages/:pageId/catalog.
 * Ownership: every service call is scoped by (workspaceId, pageId); a foreign or
 * unknown page returns 404 (never 403 — don't leak existence). Writes require
 * workspace admin (route-level requireRole), mirroring who may edit the KB.
 * Store-linked pages reject writes with 409 PAGE_HAS_STORE — their catalog
 * comes from the store sync, and a manual write would orphan their RAG chunks
 * (see CatalogStoreConflictError).
 */
function sendStoreConflict(reply: FastifyReply, err: CatalogStoreConflictError) {
    return reply.status(409).send({ error: err.message, code: 'PAGE_HAS_STORE' });
}

export class CatalogController {
    /** GET /pages/:pageId/catalog */
    async list(
        request: FastifyRequest<{ Params: { pageId: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const items = await catalogService.listCatalogItems(req.workspaceId, request.params.pageId);
        if (items === null) return reply.status(404).send({ error: 'Page not found' });
        return reply.send({ data: items });
    }

    /** POST /pages/:pageId/catalog */
    async create(
        request: FastifyRequest<{ Params: { pageId: string }; Body: unknown }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const parsed = CatalogItemSchema.safeParse(request.body);
        if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: formatValidationErrors(parsed.error) });

        try {
            const created = await catalogService.createCatalogItem(req.workspaceId, request.params.pageId, parsed.data);
            if (!created) return reply.status(404).send({ error: 'Page not found' });
            // A catalog item is a valid answer source, so it satisfies the same
            // "kb_filled" activation milestone as filling the free-text KB (the
            // dashboard checklist treats them equivalently — keep the funnel in
            // step). Fire-and-forget telemetry: it must never fail the 201 (a
            // throw here after the committed insert would make client retries
            // create duplicates). onConflictDoNothing dedupes repeat adds.
            if (created.pageUserId) void recordActivationEvent(created.pageUserId, 'kb_filled', { source: 'catalog' });
            return reply.status(201).send(created.item);
        } catch (err) {
            if (err instanceof CatalogLimitError) {
                return reply.status(403).send({ error: err.message, code: 'CATALOG_LIMIT_REACHED' });
            }
            if (err instanceof CatalogStoreConflictError) return sendStoreConflict(reply, err);
            throw err;
        }
    }

    /** PATCH /pages/:pageId/catalog/:itemId */
    async update(
        request: FastifyRequest<{ Params: { pageId: string; itemId: string }; Body: unknown }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const parsed = CatalogItemUpdateSchema.safeParse(request.body);
        if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: formatValidationErrors(parsed.error) });

        try {
            const item = await catalogService.updateCatalogItem(
                req.workspaceId, request.params.pageId, request.params.itemId, parsed.data,
            );
            if (!item) return reply.status(404).send({ error: 'Item not found' });
            return reply.send(item);
        } catch (err) {
            if (err instanceof CatalogStoreConflictError) return sendStoreConflict(reply, err);
            throw err;
        }
    }

    /** DELETE /pages/:pageId/catalog/:itemId */
    async remove(
        request: FastifyRequest<{ Params: { pageId: string; itemId: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        try {
            const deleted = await catalogService.deleteCatalogItem(
                req.workspaceId, request.params.pageId, request.params.itemId,
            );
            if (!deleted) return reply.status(404).send({ error: 'Item not found' });
            return reply.status(204).send();
        } catch (err) {
            if (err instanceof CatalogStoreConflictError) return sendStoreConflict(reply, err);
            throw err;
        }
    }
}

export const catalogController = new CatalogController();
