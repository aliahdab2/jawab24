import { FastifyReply, FastifyRequest } from 'fastify';
import { factCollectionsService, FactCollectionLimitError, type FactCollectionErrorCode } from '../services/factCollections';
import { pagesService } from '../services/pages';
import {
    FactRowSchema, FactRowUpdateSchema, FactCompletenessSchema, FactEntitySaveSchema, formatValidationErrors,
} from '../utils/validation';
import { createRequestLogger } from '../types';
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

/**
 * Give the service a REQUEST-SCOPED logger before every write.
 *
 * The service holds `logger = noopLogger` and exposes `setLogger`, but nothing
 * in the app ever called it — so every `this.logger.*` line in the fact engine
 * was a no-op in production, including three whose own comments record that
 * their silence had already been flagged in review. Wiring it here (the house
 * pattern from controllers/webhook.ts) also gives each line the `requestId`, so
 * a service log and the access-log entry for the same save can be joined.
 *
 * Writes only: two of the service's lines sit on the reply path and would spam
 * once per collection per inbound message — those emit counters instead.
 */
const wireLogger = (request: FastifyRequest): void => {
    factCollectionsService.setLogger(createRequestLogger(request.log));
};

/**
 * One status per refusal reason, exhaustively — a Record (not a ternary with a
 * default) so adding a code to `FactCollectionErrorCode` fails to compile until
 * its status is chosen here, instead of silently defaulting to 409.
 *
 * 404 a resource that is gone, 409 a state conflict, 400 a malformed body. The
 * stale-row rule in particular MUST agree with the direct `!row` returns below,
 * which answer 404 — the whole point of carrying the code on the error is that
 * one rule cannot end up with two answers.
 */
const STATUS_BY_CODE: Record<FactCollectionErrorCode, number> = {
    STALE_ROW: 404,
    ROW_LIMIT: 409,
    COLLECTION_LIMIT: 409,
    LAST_ROW: 409,
    DATE_ORDER: 400,
};

const statusForCode = (code: FactCollectionErrorCode): number => STATUS_BY_CODE[code];

class FactCollectionsController {
    /** GET — collections WITH their rows: the editor's one read. */
    async list(
        request: FastifyRequest<{ Params: { pageId: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const page = await pagesService.getPage(req.workspaceId, request.params.pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found', code: 'PAGE_NOT_FOUND' });

        const withRows = await factCollectionsService.listCollectionsWithRows(request.params.pageId);
        return reply.send({ data: withRows });
    }

    async addRow(
        request: FastifyRequest<{ Params: { pageId: string; collectionId: string }; Body: unknown }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const page = await pagesService.getPage(req.workspaceId, request.params.pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found', code: 'PAGE_NOT_FOUND' });

        wireLogger(request);
        const parsed = FactRowSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Validation failed', code: 'VALIDATION', details: formatValidationErrors(parsed.error) });
        }
        try {
            const row = await factCollectionsService.addRow(
                request.params.pageId,
                request.params.collectionId,
                { ...parsed.data, price: toPrice(parsed.data.price) },
            );
            if (!row) return reply.status(404).send({ error: 'Collection not found', code: 'COLLECTION_NOT_FOUND' });
            return reply.status(201).send({ data: row });
        } catch (err) {
            if (err instanceof FactCollectionLimitError) {
                return reply.status(statusForCode(err.code)).send({ error: err.message, code: err.code });
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
        if (!page) return reply.status(404).send({ error: 'Page not found', code: 'PAGE_NOT_FOUND' });

        wireLogger(request);
        const parsed = FactRowUpdateSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Validation failed', code: 'VALIDATION', details: formatValidationErrors(parsed.error) });
        }
        const { price, ...rest } = parsed.data;
        const patch = {
            ...rest,
            ...(price !== undefined ? { price: toPrice(price) } : {}),
        };
        try {
            const row = await factCollectionsService.updateRow(
                request.params.pageId,
                request.params.collectionId,
                request.params.rowId,
                patch,
            );
            if (!row) return reply.status(404).send({ error: 'Row not found', code: 'STALE_ROW' });
            return reply.send({ data: row });
        } catch (err) {
            // The merged-date guard (endsAt < startsAt after applying a PARTIAL
            // patch) lives in the service and used to escape uncaught — a client
            // input error surfacing as a 500 that pages on-call and tells the
            // caller to retry a request that can never succeed.
            if (err instanceof FactCollectionLimitError) {
                return reply.status(statusForCode(err.code)).send({ error: err.message, code: err.code });
            }
            throw err;
        }
    }

    async deleteRow(
        request: FastifyRequest<{ Params: { pageId: string; collectionId: string; rowId: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const page = await pagesService.getPage(req.workspaceId, request.params.pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found', code: 'PAGE_NOT_FOUND' });

        wireLogger(request);
        try {
            const deleted = await factCollectionsService.deleteRow(
                request.params.pageId,
                request.params.collectionId,
                request.params.rowId,
            );
            if (!deleted) return reply.status(404).send({ error: 'Row not found', code: 'STALE_ROW' });
            return reply.send({ data: { id: deleted.id } });
        } catch (err) {
            if (err instanceof FactCollectionLimitError) {
                return reply.status(statusForCode(err.code)).send({ error: err.message, code: err.code });
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
        if (!page) return reply.status(404).send({ error: 'Page not found', code: 'PAGE_NOT_FOUND' });

        wireLogger(request);
        const parsed = FactCompletenessSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Validation failed', code: 'VALIDATION', details: formatValidationErrors(parsed.error) });
        }
        const updated = await factCollectionsService.setCompleteness(
            request.params.pageId,
            request.params.collectionId,
            parsed.data.isComplete,
        );
        if (!updated) return reply.status(404).send({ error: 'Collection not found', code: 'COLLECTION_NOT_FOUND' });
        return reply.send({ data: updated });
    }

    /** PUT /fact-entity — one atomic save for the single-form editor:
     *  upserts + deletes across the page's collections, all-or-nothing. */
    async saveEntity(
        request: FastifyRequest<{ Params: { pageId: string }; Body: unknown }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const page = await pagesService.getPage(req.workspaceId, request.params.pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found', code: 'PAGE_NOT_FOUND' });

        wireLogger(request);
        const parsed = FactEntitySaveSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Validation failed', code: 'VALIDATION', details: formatValidationErrors(parsed.error) });
        }
        try {
            const result = await factCollectionsService.saveEntityRows(request.params.pageId, {
                upserts: parsed.data.upserts.map(u => ({ ...u, price: toPrice(u.price) })),
                deletes: parsed.data.deletes,
            });
            if (!result) return reply.status(404).send({ error: 'Collection not found', code: 'COLLECTION_NOT_FOUND' });
            return reply.send({ data: result });
        } catch (err) {
            if (err instanceof FactCollectionLimitError) {
                return reply.status(statusForCode(err.code)).send({ error: err.message, code: err.code });
            }
            throw err;
        }
    }
}

export const factCollectionsController = new FactCollectionsController();
