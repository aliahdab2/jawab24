import { FastifyReply, FastifyRequest } from 'fastify';
import { leadExtractorService } from '../services/leadExtractor';
import { pagesService } from '../services/pages';
import { workspaceSettingsService } from '../services/workspaceSettings';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';
import type { LeadStatus } from '@jawab24/shared';
import { MAX_LEAD_FIELD_VALUE_LENGTH } from '@jawab24/shared';

const VALID_STATUSES: LeadStatus[] = ['new', 'contacted', 'converted'];

export class LeadsController {
    /** GET /leads?pageId=&status=&needsFollowUp=&search=&limit=&offset= */
    async getLeads(
        request: FastifyRequest<{
            Querystring: { pageId: string; status?: string; needsFollowUp?: string; search?: string; limit?: string; offset?: string };
        }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId, status, needsFollowUp: needsFollowUpStr, search: searchStr, limit: limitStr, offset: offsetStr } = request.query;

        if (!pageId) return reply.status(400).send({ error: 'pageId is required' });

        const page = await pagesService.getPage(req.workspaceId, pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found' });

        const validStatus = status && (VALID_STATUSES as string[]).includes(status)
            ? (status as LeadStatus)
            : undefined;
        // Filter for re-engaged leads ("returning" tab). Only the explicit 'true'
        // narrows the list; absent/other values leave it unfiltered.
        const needsFollowUp = needsFollowUpStr === 'true' ? true : undefined;

        // Server-side search over name/phone/extracted data. The list paginates,
        // so client-side filtering can only see loaded rows — a lead beyond the
        // first page was unfindable by name (2026-07-02 prod complaint).
        const search = typeof searchStr === 'string' && searchStr.trim().length > 0
            ? searchStr.trim().slice(0, 100)
            : undefined;

        const limit = Math.min(Number(limitStr) || 50, 200);
        const offset = Math.max(Number(offsetStr) || 0, 0);

        const result = await leadExtractorService.getLeadsByPage(pageId, { status: validStatus, needsFollowUp, search, limit, offset });
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

    /** GET /leads/:id — fetch a single lead (used by the notification deep-link). */
    async getLeadById(
        request: FastifyRequest<{ Params: { id: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const lead = await leadExtractorService.getLeadById(request.params.id);
        if (!lead) return reply.status(404).send({ error: 'Lead not found' });

        // Authorize: the lead's page must belong to the caller's workspace. Return
        // 404 (not 403) on a cross-workspace id so we don't leak lead existence.
        const page = await pagesService.getPage(req.workspaceId, lead.pageId);
        if (!page) return reply.status(404).send({ error: 'Lead not found' });

        return reply.send(lead);
    }

    /** PATCH /leads/:id/status */
    async updateStatus(
        request: FastifyRequest<{
            Params: { id: string };
            Body: { status: LeadStatus; pageId: string; subStage?: string | null };
        }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { status, pageId, subStage } = request.body;

        if (!pageId) return reply.status(400).send({ error: 'pageId is required' });
        if (!VALID_STATUSES.includes(status)) {
            return reply.status(400).send({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
        }

        const page = await pagesService.getPage(req.workspaceId, pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found' });

        // A sub-stage must be one the workspace actually defined under this main
        // status. Labels are merchant free text (works for any business type);
        // ids are validated so stale or foreign ids can't be written. Changing
        // the main status without picking a sub-stage clears the old one (it
        // belonged to the previous status).
        let validSubStage: string | null = null;
        if (subStage !== null && subStage !== undefined && subStage !== '') {
            if (typeof subStage !== 'string' || subStage.length > 64) {
                return reply.status(400).send({ error: 'invalid subStage' });
            }
            // Effective config = this page's override ?? workspace default, so a
            // page-scoped sub-stage validates here exactly as the UI shows it.
            const { leadStages } = await workspaceSettingsService.getEffectiveLeadConfig(req.workspaceId, page);
            const configured = leadStages?.[status] ?? [];
            if (!configured.some((s) => s.id === subStage)) {
                return reply.status(400).send({ error: 'subStage is not defined for this status' });
            }
            validSubStage = subStage;
        }

        const updated = await leadExtractorService.updateLeadStatus(request.params.id, pageId, status, validSubStage);
        if (!updated) return reply.status(404).send({ error: 'Lead not found' });
        return reply.send(updated);
    }

    /**
     * PATCH /leads/:id/fields — replace the lead's custom field values.
     * Full replacement (not a merge): the detail panel sends every field it
     * shows, so clearing an input genuinely deletes the value.
     */
    async updateCustomFields(
        request: FastifyRequest<{
            Params: { id: string };
            Body: { pageId: string; fields: Record<string, string> };
        }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId, fields } = request.body;

        if (!pageId) return reply.status(400).send({ error: 'pageId is required' });
        if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
            return reply.status(400).send({ error: 'fields must be an object' });
        }

        const page = await pagesService.getPage(req.workspaceId, pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found' });

        // Only keys the workspace actually defined can be written — a stale or
        // foreign field id is rejected so deleted fields can't accumulate data.
        const { leadFields } = await workspaceSettingsService.getEffectiveLeadConfig(req.workspaceId, page);
        const defined = new Set(leadFields.map((f) => f.id));
        const clean: Record<string, string> = {};
        for (const [key, value] of Object.entries(fields)) {
            if (!defined.has(key)) {
                return reply.status(400).send({ error: 'field is not defined for this workspace' });
            }
            if (typeof value !== 'string') {
                return reply.status(400).send({ error: 'field values must be strings' });
            }
            const trimmed = value.trim().slice(0, MAX_LEAD_FIELD_VALUE_LENGTH);
            if (trimmed) clean[key] = trimmed;
        }

        const updated = await leadExtractorService.updateLeadCustomFields(
            request.params.id,
            pageId,
            Object.keys(clean).length ? clean : null,
        );
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

    /**
     * GET /leads/count?pageId=
     * With pageId: that page's `new` count (legacy per-page shape).
     * Without: workspace-wide summary { count, latestName, latestAt, oldestAt,
     * byPage } — feeds the dashboard attention row + the nav badge, and
     * `byPage` (longest-waiting page first) tells the badge's deep link which
     * page to open so it never lands on an empty list.
     */
    async getCount(
        request: FastifyRequest<{
            Querystring: { pageId?: string; status?: string };
        }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId } = request.query;

        if (!pageId) {
            const summary = await leadExtractorService.getNewLeadsSummaryForWorkspace(req.workspaceId);
            return reply.send(summary);
        }

        const page = await pagesService.getPage(req.workspaceId, pageId);
        if (!page) return reply.status(404).send({ error: 'Page not found' });

        const count = await leadExtractorService.getNewLeadsCount(pageId);
        return reply.send({ count });
    }
}

export const leadsController = new LeadsController();
