import { FastifyReply, FastifyRequest } from 'fastify';
import { factCollectionsService, FactCollectionLimitError } from '../services/factCollections';
import { pagesService } from '../services/pages';
import {
    FactRowSchema, FactRowUpdateSchema, FactCompletenessSchema, formatValidationErrors,
} from '../utils/validation';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';

/**
 * Fact-collections editing API (G1b list editor) — /pages/:pageId/fact-collections.
 *
 * Ownership: the page is resolved against the caller's workspace on every
 * request; a foreign or unknown page returns 404 (never 403 — don't leak
 * existence), and the service re-checks collection→page ownership so a row id
 * can never authorize a cross-page write. Writes require workspace admin
 * (route-level requireRole), mirroring who may edit the KB.
 *
 * Deliberately NOT here (slice 1): creating collections. Collections are born
 * from reviewed extraction (D-038) — the editor maintains rows of lists that
 * already exist. A page without collections simply doesn't render the section.
 *
 * PriceInput yields number|null; the service's numeric column takes a string —
 * same toFixed(2) boundary conversion the catalog controller uses.
 */
const toPrice = (v: number | null): string | null => (typeof v === 'number' ? v.toFixed(2) : null);

class FactCollectionsController {
    /** GET — collections WITH their rows: the editor's one read. */
    async list(
        request: FastifyRequest<{ Params: { pageId: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const page = await pagesService.getPage(req.workspaceId, request.params.pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found' });

        const withRows = await factCollectionsService.listCollectionsWithRows(request.params.pageId);
        return reply.send({ data: withRows });
    }

    async addRow(
        request: FastifyRequest<{ Params: { pageId: string; collectionId: string }; Body: unknown }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const page = await pagesService.getPage(req.workspaceId, request.params.pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found' });

        const parsed = FactRowSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: formatValidationErrors(parsed.error) });
        }
        try {
            const row = await factCollectionsService.addRow(
                request.params.pageId,
                request.params.collectionId,
                { ...parsed.data, price: toPrice(parsed.data.price) },
            );
            if (!row) return reply.status(404).send({ error: 'Collection not found' });
            return reply.status(201).send({ data: row });
        } catch (err) {
            if (err instanceof FactCollectionLimitError) {
                return reply.status(409).send({ error: err.message, code: 'LIMIT' });
            }
            throw err;
        }
    }

    async updateRow(
        request: FastifyRequest<{ Params: { pageId: string; collectionId: string; rowId: string }; Body: unknown }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const page = await pagesService.getPage(req.workspaceId, request.params.pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found' });

        const parsed = FactRowUpdateSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: formatValidationErrors(parsed.error) });
        }
        const { price, ...rest } = parsed.data;
        const patch = {
            ...rest,
            ...(price !== undefined ? { price: toPrice(price) } : {}),
        };
        const row = await factCollectionsService.updateRow(
            request.params.pageId,
            request.params.collectionId,
            request.params.rowId,
            patch,
        );
        if (!row) return reply.status(404).send({ error: 'Row not found' });
        return reply.send({ data: row });
    }

    async deleteRow(
        request: FastifyRequest<{ Params: { pageId: string; collectionId: string; rowId: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const page = await pagesService.getPage(req.workspaceId, request.params.pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found' });

        try {
            const deleted = await factCollectionsService.deleteRow(
                request.params.pageId,
                request.params.collectionId,
                request.params.rowId,
            );
            if (!deleted) return reply.status(404).send({ error: 'Row not found' });
            return reply.send({ data: { id: deleted.id } });
        } catch (err) {
            if (err instanceof FactCollectionLimitError) {
                return reply.status(409).send({ error: err.message, code: 'LAST_ROW' });
            }
            throw err;
        }
    }

    /** PATCH completeness — the merchant's word (D-038), tri-state. */
    async setCompleteness(
        request: FastifyRequest<{ Params: { pageId: string; collectionId: string }; Body: unknown }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const page = await pagesService.getPage(req.workspaceId, request.params.pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found' });

        const parsed = FactCompletenessSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: formatValidationErrors(parsed.error) });
        }
        const updated = await factCollectionsService.setCompleteness(
            request.params.pageId,
            request.params.collectionId,
            parsed.data.isComplete,
        );
        if (!updated) return reply.status(404).send({ error: 'Collection not found' });
        return reply.send({ data: updated });
    }
}

export const factCollectionsController = new FactCollectionsController();
