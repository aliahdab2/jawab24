import { FastifyReply, FastifyRequest } from 'fastify';
import { leadExtractorService } from '../services/leadExtractor';
import { pagesService } from '../services/pages';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';
import type { LeadStatus } from '@jawab24/shared';

const VALID_STATUSES: LeadStatus[] = ['new', 'contacted', 'converted'];

export class LeadsController {
    /** GET /leads?pageId=&status=&limit=&offset= */
    async getLeads(
        request: FastifyRequest<{
            Querystring: { pageId: string; status?: string; limit?: string; offset?: string };
        }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId, status, limit: limitStr, offset: offsetStr } = request.query;

        if (!pageId) return reply.status(400).send({ error: 'pageId is required' });

        const page = await pagesService.getPage(req.workspaceId, pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found' });

        const validStatus = status && (VALID_STATUSES as string[]).includes(status)
            ? (status as LeadStatus)
            : undefined;

        const limit = Math.min(Number(limitStr) || 50, 200);
        const offset = Math.max(Number(offsetStr) || 0, 0);

        const result = await leadExtractorService.getLeadsByPage(pageId, { status: validStatus, limit, offset });
        return reply.send(result);
    }

    /**
     * GET /leads/export?pageId=&status=
     * Returns every lead for the page so CSV export isn't capped by the
     * paginated list endpoint. No `limit` — server iterates internally.
     */
    async exportLeads(
        request: FastifyRequest<{
            Querystring: { pageId: string; status?: string };
        }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId, status } = request.query;

        if (!pageId) return reply.status(400).send({ error: 'pageId is required' });

        const page = await pagesService.getPage(req.workspaceId, pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found' });

        const validStatus = status && (VALID_STATUSES as string[]).includes(status)
            ? (status as LeadStatus)
            : undefined;

        const data = await leadExtractorService.getAllLeadsForExport(pageId, { status: validStatus });
        return reply.send({ data });
    }

    /** PATCH /leads/:id/status */
    async updateStatus(
        request: FastifyRequest<{
            Params: { id: string };
            Body: { status: LeadStatus; pageId: string };
        }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { status, pageId } = request.body;

        if (!pageId) return reply.status(400).send({ error: 'pageId is required' });
        if (!VALID_STATUSES.includes(status)) {
            return reply.status(400).send({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
        }

        const page = await pagesService.getPage(req.workspaceId, pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found' });

        const updated = await leadExtractorService.updateLeadStatus(request.params.id, pageId, status);
        if (!updated) return reply.status(404).send({ error: 'Lead not found' });
        return reply.send(updated);
    }

    /** DELETE /leads/:id?pageId= */
    async deleteLead(
        request: FastifyRequest<{
            Params: { id: string };
            Querystring: { pageId: string };
        }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId } = request.query;

        if (!pageId) return reply.status(400).send({ error: 'pageId is required' });

        const page = await pagesService.getPage(req.workspaceId, pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found' });

        const deleted = await leadExtractorService.deleteLead(request.params.id, pageId);
        if (!deleted) return reply.status(404).send({ error: 'Lead not found' });
        return reply.status(204).send();
    }

    /** GET /leads/count?pageId=&status= */
    async getCount(
        request: FastifyRequest<{
            Querystring: { pageId: string; status?: string };
        }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId } = request.query;

        if (!pageId) return reply.status(400).send({ error: 'pageId is required' });

        const page = await pagesService.getPage(req.workspaceId, pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found' });

        const count = await leadExtractorService.getNewLeadsCount(pageId);
        return reply.send({ count });
    }
}

export const leadsController = new LeadsController();
