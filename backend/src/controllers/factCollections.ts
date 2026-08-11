import { FastifyReply, FastifyRequest } from 'fastify';
import { factCollectionsService, FactCollectionLimitError, type FactCollectionErrorCode } from '../services/factCollections';
import { pagesService } from '../services/pages';
import {
    FactRowSchema, FactRowUpdateSchema, FactCompletenessSchema, FactEntitySaveSchema,
    FactCollectionCreateSchema, FactCollectionRenameSchema, formatValidationErrors,
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
 * Creating collections (the merchant's «add list», G1b) POSTs here too — but
 * through a deliberately narrower schema than the seeder's service input:
 * no keyAttr (reply-time gating stays an admin/seeder concern) and the source
 * is pinned to 'editor'. Completeness still starts un-asked (D-038).
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
    DUPLICATE_LABEL: 409,
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

    /** POST /fact-collections — create a collection with its first rows in one
     *  transaction (a half-written collection would assert a wrong coverage
     *  boundary — worse than none). 201 with the bare collection; the client
     *  refetches the list for the rows. */
    async createCollection(
        request: FastifyRequest<{ Params: { pageId: string }; Body: unknown }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const page = await pagesService.getPage(req.workspaceId, request.params.pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found', code: 'PAGE_NOT_FOUND' });

        wireLogger(request);
        const parsed = FactCollectionCreateSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Validation failed', code: 'VALIDATION', details: formatValidationErrors(parsed.error) });
        }
        try {
            const collection = await factCollectionsService.createCollection(request.params.pageId, {
                label: parsed.data.label,
                source: 'editor',
                rows: parsed.data.rows.map(({ price, ...r }) => ({ ...r, price: toPrice(price) })),
            });
            return reply.status(201).send({ data: collection });
        } catch (err) {
            if (err instanceof FactCollectionLimitError) {
                return reply.status(statusForCode(err.code)).send({ error: err.message, code: err.code });
            }
            throw err;
        }
    }

    /** PATCH /fact-collections/:collectionId — rename the list. The label is the
     *  prompt block's header, so this is a reply-affecting edit, not cosmetic. */
    /**
     * DELETE /fact-collections/:collectionId — remove a list and its rows.
     *
     * Deliberately unbuilt until 2026-08-10, when the reason arrived: a
     * merchant created a list from the editor, could not undo it, and left a
     * duplicate in production that had to be removed over SSH. A door that
     * creates without a matching door that undoes is not a finished feature.
     *
     * The service cascades the rows and invalidates the page's reply caches,
     * so a deleted list stops being quoted on the next question. The blast
     * radius (a directory can hold hundreds of rows) is answered in the UI by
     * a two-step confirm that names the row count — never here: an endpoint
     * that second-guesses an authorized, explicit request is a worse contract
     * than one that does what it is told.
     */
    async deleteCollection(
        request: FastifyRequest<{ Params: { pageId: string; collectionId: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const page = await pagesService.getPage(req.workspaceId, request.params.pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found', code: 'PAGE_NOT_FOUND' });

        wireLogger(request);
        const deleted = await factCollectionsService.deleteCollection(
            request.params.pageId,
            request.params.collectionId,
        );
        if (!deleted) return reply.status(404).send({ error: 'Collection not found', code: 'COLLECTION_NOT_FOUND' });
        return reply.send({ data: deleted });
    }

    async renameCollection(
        request: FastifyRequest<{ Params: { pageId: string; collectionId: string }; Body: unknown }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const page = await pagesService.getPage(req.workspaceId, request.params.pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found', code: 'PAGE_NOT_FOUND' });

        wireLogger(request);
        const parsed = FactCollectionRenameSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Validation failed', code: 'VALIDATION', details: formatValidationErrors(parsed.error) });
        }
        try {
            const collection = await factCollectionsService.renameCollection(
                request.params.pageId,
                request.params.collectionId,
                parsed.data.label,
            );
            if (!collection) return reply.status(404).send({ error: 'Collection not found', code: 'COLLECTION_NOT_FOUND' });
            return reply.send({ data: collection });
        } catch (err) {
            if (err instanceof FactCollectionLimitError) {
                return reply.status(statusForCode(err.code)).send({ error: err.message, code: err.code });
            }
            throw err;
        }
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
     *  upserts + deletes across the page's collections, all-or-nothing.
     *  rowId upserts MERGE (omitted = unchanged, null = clear — issue #671),
     *  so `price` must stay ABSENT when it was not sent. */
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
                upserts: parsed.data.upserts.map(({ price, ...u }) => ({
                    ...u,
                    ...(price !== undefined ? { price: toPrice(price) } : {}),
                })),
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
