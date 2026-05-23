import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { catalogService, CATALOG_ITEM_TYPES, CatalogItemType } from '../services/catalog';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';

function formatZodErrors(err: z.ZodError): { field: string; message: string }[] {
    return err.errors.map(e => ({ field: e.path.join('.'), message: e.message }));
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const TypeEnum = z.enum(CATALOG_ITEM_TYPES as unknown as [CatalogItemType, ...CatalogItemType[]]);

// Accepts either a full ISO datetime (`2026-06-01T00:00:00Z`) or a date-only
// string (`2026-06-01`) from native `<input type="date">`. z.coerce.date()
// invokes `new Date(...)`; date-only inputs are interpreted as UTC midnight,
// which is the correct read for course/event start dates.
const isoDate = z.coerce.date();

interface DatedItem {
    startsAt?: Date | null;
    endsAt?: Date | null;
    enrollmentClosesAt?: Date | null;
}

function applyDateOrderingRules(val: DatedItem, ctx: z.RefinementCtx) {
    if (val.startsAt && val.endsAt && val.endsAt < val.startsAt) {
        ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'endsAt must be on or after startsAt' });
    }
    if (val.enrollmentClosesAt && val.startsAt && val.enrollmentClosesAt > val.startsAt) {
        ctx.addIssue({ code: 'custom', path: ['enrollmentClosesAt'], message: 'enrollmentClosesAt must be on or before startsAt' });
    }
}

const CreateCatalogItemSchema = z.object({
    type: TypeEnum,
    name: z.string().min(1).max(200),
    description: z.string().max(4000).nullable().optional(),
    priceMinor: z.number().int().min(0).nullable().optional(),
    currency: z.string().min(2).max(8).nullable().optional(),
    startsAt: isoDate.nullable().optional(),
    endsAt: isoDate.nullable().optional(),
    enrollmentClosesAt: isoDate.nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
}).superRefine((val, ctx) => {
    applyDateOrderingRules(val, ctx);
    if (val.priceMinor !== null && val.priceMinor !== undefined && (val.currency === null || val.currency === undefined)) {
        ctx.addIssue({ code: 'custom', path: ['currency'], message: 'currency is required when priceMinor is set' });
    }
});

// Update accepts the create fields PLUS `archivedAt`. Setting `archivedAt: null`
// is how the merchant restores an archived item (see catalogApi.restore on the
// frontend); setting it to a Date is technically possible but the canonical
// archive path is DELETE /catalog-items/:id so leave that as the discoverable
// action.
const UpdateCatalogItemSchema = CreateCatalogItemSchema.innerType()
    .extend({ archivedAt: isoDate.nullable().optional() })
    .partial()
    .superRefine(applyDateOrderingRules);

const ListQuerySchema = z.object({
    pageId: z.string().uuid(),
    type: TypeEnum.optional(),
    status: z.enum(['active', 'expired', 'archived', 'all']).optional(),
});

const CreateBodySchema = z.object({ pageId: z.string().uuid() }).and(CreateCatalogItemSchema);

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class CatalogController {
    /** GET /catalog-items?pageId=...&type=...&status=... */
    async list(request: FastifyRequest, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });

        const parsed = ListQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Invalid query', errors: formatZodErrors(parsed.error) });
        }

        try {
            const items = await catalogService.list(req.workspaceId, parsed.data.pageId, {
                type: parsed.data.type,
                status: parsed.data.status,
            });
            if (items === null) return reply.status(404).send({ error: 'Page not found' });
            return reply.send({ data: items });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to list catalog items' });
        }
    }

    /** GET /catalog-items/:id */
    async getOne(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });

        try {
            const item = await catalogService.get(req.workspaceId, request.params.id);
            if (!item) return reply.status(404).send({ error: 'Catalog item not found' });
            return reply.send({ data: item });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch catalog item' });
        }
    }

    /** POST /catalog-items */
    async create(request: FastifyRequest, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });

        const parsed = CreateBodySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Invalid catalog item', errors: formatZodErrors(parsed.error) });
        }
        const { pageId, ...input } = parsed.data;

        try {
            const item = await catalogService.create(req.workspaceId, pageId, input);
            if (!item) return reply.status(404).send({ error: 'Page not found' });
            return reply.status(201).send({ data: item });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to create catalog item' });
        }
    }

    /** PATCH /catalog-items/:id */
    async update(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });

        const parsed = UpdateCatalogItemSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Invalid catalog item', errors: formatZodErrors(parsed.error) });
        }

        try {
            const item = await catalogService.update(req.workspaceId, request.params.id, parsed.data);
            if (!item) return reply.status(404).send({ error: 'Catalog item not found' });
            return reply.send({ data: item });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to update catalog item' });
        }
    }

    /** DELETE /catalog-items/:id — soft-delete via archivedAt. */
    async archive(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });

        try {
            const item = await catalogService.archive(req.workspaceId, request.params.id);
            if (!item) return reply.status(404).send({ error: 'Catalog item not found' });
            return reply.send({ data: item });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to archive catalog item' });
        }
    }

    /**
     * DELETE /catalog-items/:id/permanent — hard-delete.
     * Two-step gate: only works on already-archived items. Caller archives first,
     * then permanently deletes from the Archived view. Returns 409 if attempted
     * on an active item to make the gate clear from the API surface.
     */
    async deletePermanent(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });

        try {
            const result = await catalogService.deletePermanent(req.workspaceId, request.params.id);
            if (result === null) return reply.status(404).send({ error: 'Catalog item not found' });
            if (result === 'not_archived') {
                return reply.status(409).send({ error: 'Item must be archived before permanent deletion', code: 'not_archived' });
            }
            return reply.send({ data: result });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to delete catalog item' });
        }
    }
}

export const catalogController = new CatalogController();
