import { FastifyReply, FastifyRequest } from 'fastify';
import { catalogService, CatalogLimitError, CatalogStoreConflictError } from '../services/catalog';
import {
    CatalogBatchSchema, CatalogExtractSchema, CatalogItemSchema, CatalogItemUpdateSchema,
    formatValidationErrors,
} from '../utils/validation';
import { catalogExtractor } from '../services/catalogExtractor';
import { checkDailyCap, dailyCapKey, incrementDailyCap } from '../lib/dailyCap';
import { recordActivationEvent } from '../services/activation';
import { captureError } from '../utils/sentryHelpers';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';

/** Daily bound on the import extract endpoint — the only real cost vector this
 *  controller owns (each call is one LLM request). 30/day covers any honest
 *  import session (retries, split lists) while capping abuse at pennies. */
const EXTRACT_DAILY_LIMIT = 30;

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

    /**
     * POST /pages/:pageId/catalog/extract — free text → PROPOSED items.
     * Persists nothing (merchant-in-the-loop: the review sheet decides what to
     * save via /batch). Ordered so nothing costs money until every free check
     * passed: validation → capacity → daily cap → LLM.
     */
    async extract(
        request: FastifyRequest<{ Params: { pageId: string }; Body: unknown }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const parsed = CatalogExtractSchema.safeParse(request.body);
        if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: formatValidationErrors(parsed.error) });

        let capacity;
        try {
            capacity = await catalogService.getCatalogCapacity(req.workspaceId, request.params.pageId);
        } catch (err) {
            if (err instanceof CatalogStoreConflictError) return sendStoreConflict(reply, err);
            throw err;
        }
        if (!capacity) return reply.status(404).send({ error: 'Page not found' });
        if (capacity.remaining <= 0) {
            return reply.status(403).send({ error: 'Catalog is full', code: 'CATALOG_LIMIT_REACHED' });
        }

        // authenticate ran (route preHandler) so user is set; the optional type
        // still needs narrowing (same guard as the KB Vision endpoint).
        const userId = req.user?.userId;
        if (!userId) return reply.status(401).send({ error: 'Authentication required' });

        // Fail closed: the daily cap is the only bound on a paid call, so an
        // unreachable Redis means "don't proceed", not "proceed uncounted"
        // (same policy as the KB Vision quota).
        const capKey = dailyCapKey('catalog_extract', userId);
        try {
            const cap = await checkDailyCap(capKey, EXTRACT_DAILY_LIMIT);
            if (!cap.allowed) {
                return reply.status(429).send({ error: 'Daily import limit reached. Try again tomorrow.', code: 'daily_limit_reached' });
            }
        } catch (err) {
            captureError(err, 'Catalog extract quota check unavailable', {
                level: 'warning', tags: { service: 'catalog-extraction' },
            });
            return reply.status(503).send({ error: 'Quota check unavailable. Try again shortly.', code: 'quota_check_unavailable' });
        }

        const result = await catalogExtractor.extract(parsed.data.text, {
            userId,
            pageId: request.params.pageId,
        });
        void incrementDailyCap(capKey);

        // More proposals than free slots: keep what fits, report the cut.
        const items = result.items.slice(0, capacity.remaining);
        return reply.send({
            items,
            dropped: result.dropped,
            overflow: result.items.length - items.length,
            remainingCapacity: capacity.remaining,
            truncated: result.truncated,
        });
    }

    /** POST /pages/:pageId/catalog/batch — save the reviewed import rows in one
     *  all-or-nothing transaction (one cache bump, one activation event). */
    async batchCreate(
        request: FastifyRequest<{ Params: { pageId: string }; Body: unknown }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const parsed = CatalogBatchSchema.safeParse(request.body);
        if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: formatValidationErrors(parsed.error) });

        try {
            const created = await catalogService.createCatalogItemsBatch(req.workspaceId, request.params.pageId, parsed.data.items);
            if (!created) return reply.status(404).send({ error: 'Page not found' });
            // Same milestone semantics as single create (see comment there);
            // one event for the whole batch, never fails the 201.
            if (created.pageUserId) void recordActivationEvent(created.pageUserId, 'kb_filled', { source: 'catalog' });
            return reply.status(201).send({ data: created.items });
        } catch (err) {
            if (err instanceof CatalogLimitError) {
                return reply.status(403).send({ error: err.message, code: 'CATALOG_LIMIT_REACHED' });
            }
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
