import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import leadsRoutes from '../../src/routes/leads';
import { leadExtractorService } from '../../src/services/leadExtractor';
import { pagesService } from '../../src/services/pages';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';

vi.mock('../../src/services/leadExtractor', () => ({
    leadExtractorService: {
        getLeadsByPage: vi.fn(),
        getLeadById: vi.fn(),
        getAllLeadsForExport: vi.fn(),
        updateLeadStatus: vi.fn(),
        updateLeadCustomFields: vi.fn(),
        deleteLead: vi.fn(),
        getNewLeadsCount: vi.fn(),
        getNewLeadsSummaryForWorkspace: vi.fn(),
    },
}));

vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPage: vi.fn().mockResolvedValue({ id: 'page_1', name: 'Test Page' }),
    },
}));

// The leads controller validates subStage ids / field keys against the page's
// EFFECTIVE config (page override ?? workspace default), resolved by
// getEffectiveLeadConfig. By default it returns the workspace-level config; a
// test can override the mock per-case to simulate a per-page override.
vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        getEffectiveLeadConfig: vi.fn().mockResolvedValue({
            leadStages: {
                converted: [
                    { id: 'sub_delivered', label: 'تم التسليم', color: 'emerald' },
                    { id: 'sub_cancelled', label: 'إلغاء', color: 'rose' },
                ],
            },
            leadFields: [
                { id: 'field_paid', label: 'المبلغ المدفوع' },
                { id: 'field_discount', label: 'الخصم' },
            ],
        }),
    },
}));

vi.mock('../../src/middleware/auth', () => ({
    authenticate: async (req: any) => {
        req.user = { userId: 'user_1' };
    },
}));

vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: async (req: any) => {
        req.workspaceId = 'workspace_1';
        req.workspaceOwnerId = 'user_1';
    },
}));

const MOCK_LEAD = {
    id: 'lead_1',
    pageId: 'page_1',
    senderId: 'sender_1',
    senderName: 'Ali',
    phone: '0501234567',
    status: 'new' as const,
    subStage: null,
    customFields: null,
    sourceType: 'message' as const,
    sourceId: 'msg_1',
    extractedData: { summary: 'Interested in course', fields: [] },
    extractionStatus: 'completed',
    extractionAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
};

describe('Leads Routes', () => {
    let app: any;

    beforeEach(async () => {
        app = fastify();
        app.register(leadsRoutes);
        await app.ready();
        vi.clearAllMocks();
    });

    describe('GET /leads', () => {
        it('returns paginated leads for a page', async () => {
            vi.mocked(leadExtractorService.getLeadsByPage).mockResolvedValue({
                data: [MOCK_LEAD],
                total: 1,
            } as any);

            const res = await app.inject({ method: 'GET', url: '/leads?pageId=page_1' });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.total).toBe(1);
            expect(body.data[0].id).toBe('lead_1');
            expect(leadExtractorService.getLeadsByPage).toHaveBeenCalledWith(
                'page_1',
                expect.objectContaining({ limit: 50, offset: 0 }),
            );
        });

        it('returns 400 when pageId is missing', async () => {
            const res = await app.inject({ method: 'GET', url: '/leads' });
            expect(res.statusCode).toBe(400);
        });

        it('filters by status when provided', async () => {
            vi.mocked(leadExtractorService.getLeadsByPage).mockResolvedValue({ data: [], total: 0 } as any);

            await app.inject({ method: 'GET', url: '/leads?pageId=page_1&status=new' });

            expect(leadExtractorService.getLeadsByPage).toHaveBeenCalledWith(
                'page_1',
                expect.objectContaining({ status: 'new' }),
            );
        });

        it('ignores invalid status values', async () => {
            vi.mocked(leadExtractorService.getLeadsByPage).mockResolvedValue({ data: [], total: 0 } as any);

            await app.inject({ method: 'GET', url: '/leads?pageId=page_1&status=invalid' });

            expect(leadExtractorService.getLeadsByPage).toHaveBeenCalledWith(
                'page_1',
                expect.objectContaining({ status: undefined }),
            );
        });

        it('passes the search term through trimmed', async () => {
            vi.mocked(leadExtractorService.getLeadsByPage).mockResolvedValue({ data: [], total: 0 } as any);

            await app.inject({ method: 'GET', url: `/leads?pageId=page_1&search=${encodeURIComponent('  Mona ')}` });

            expect(leadExtractorService.getLeadsByPage).toHaveBeenCalledWith(
                'page_1',
                expect.objectContaining({ search: 'Mona' }),
            );
        });

        it('caps the search term at 100 chars', async () => {
            vi.mocked(leadExtractorService.getLeadsByPage).mockResolvedValue({ data: [], total: 0 } as any);
            const long = 'a'.repeat(250);

            await app.inject({ method: 'GET', url: `/leads?pageId=page_1&search=${long}` });

            expect(leadExtractorService.getLeadsByPage).toHaveBeenCalledWith(
                'page_1',
                expect.objectContaining({ search: 'a'.repeat(100) }),
            );
        });

        it('omits search entirely when blank', async () => {
            vi.mocked(leadExtractorService.getLeadsByPage).mockResolvedValue({ data: [], total: 0 } as any);

            await app.inject({ method: 'GET', url: '/leads?pageId=page_1&search=%20%20' });

            expect(leadExtractorService.getLeadsByPage).toHaveBeenCalledWith(
                'page_1',
                expect.objectContaining({ search: undefined }),
            );
        });
    });

    describe('GET /leads/:id', () => {
        it('returns the lead when it belongs to the caller workspace', async () => {
            vi.mocked(leadExtractorService.getLeadById).mockResolvedValue(MOCK_LEAD as any);

            const res = await app.inject({ method: 'GET', url: '/leads/lead_1' });

            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.body).id).toBe('lead_1');
            expect(leadExtractorService.getLeadById).toHaveBeenCalledWith('lead_1');
        });

        it('returns 404 when the lead does not exist', async () => {
            vi.mocked(leadExtractorService.getLeadById).mockResolvedValue(null);

            const res = await app.inject({ method: 'GET', url: '/leads/nonexistent' });

            expect(res.statusCode).toBe(404);
        });

        it("returns 404 (not 403) when the lead's page is outside the caller workspace", async () => {
            vi.mocked(leadExtractorService.getLeadById).mockResolvedValue(MOCK_LEAD as any);
            // Lead exists, but its page resolves to nothing for this workspace.
            vi.mocked(pagesService.getPage).mockResolvedValueOnce(null as any);

            const res = await app.inject({ method: 'GET', url: '/leads/lead_1' });

            expect(res.statusCode).toBe(404);
        });
    });

    describe('GET /leads/export', () => {
        it('returns every lead (no 200 cap) for a page', async () => {
            const manyLeads = Array.from({ length: 250 }, (_, i) => ({ ...MOCK_LEAD, id: `lead_${i}` }));
            vi.mocked(leadExtractorService.getAllLeadsForExport).mockResolvedValue(manyLeads as any);

            const res = await app.inject({ method: 'GET', url: '/leads/export?pageId=page_1' });

            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.data).toHaveLength(250);
            expect(leadExtractorService.getAllLeadsForExport).toHaveBeenCalledWith(
                'page_1',
                expect.objectContaining({ status: undefined }),
            );
        });

        it('forwards a valid status filter to the service', async () => {
            vi.mocked(leadExtractorService.getAllLeadsForExport).mockResolvedValue([]);

            await app.inject({ method: 'GET', url: '/leads/export?pageId=page_1&status=new' });

            expect(leadExtractorService.getAllLeadsForExport).toHaveBeenCalledWith(
                'page_1',
                expect.objectContaining({ status: 'new' }),
            );
        });

        it('drops invalid status values rather than rejecting', async () => {
            vi.mocked(leadExtractorService.getAllLeadsForExport).mockResolvedValue([]);

            await app.inject({ method: 'GET', url: '/leads/export?pageId=page_1&status=bogus' });

            expect(leadExtractorService.getAllLeadsForExport).toHaveBeenCalledWith(
                'page_1',
                expect.objectContaining({ status: undefined }),
            );
        });

        it('returns 400 when pageId is missing', async () => {
            const res = await app.inject({ method: 'GET', url: '/leads/export' });
            expect(res.statusCode).toBe(400);
        });
    });

    describe('GET /leads/count', () => {
        it('returns new leads count for a page', async () => {
            vi.mocked(leadExtractorService.getNewLeadsCount).mockResolvedValue(5);

            const res = await app.inject({ method: 'GET', url: '/leads/count?pageId=page_1' });

            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.body)).toEqual({ count: 5 });
        });

        // No pageId = the workspace-wide summary the dashboard/nav badge needs.
        // The dashboard is workspace-scoped (commentsApi.getStats takes no
        // pageId), so a per-page count could never drive it: a 2-page merchant
        // would see one page's queue and miss the other's.
        it('returns the workspace-wide summary when pageId is omitted', async () => {
            const latestAt = new Date('2026-08-04T13:22:00Z');
            const oldestAt = new Date('2026-07-25T09:21:00Z');
            vi.mocked(leadExtractorService.getNewLeadsSummaryForWorkspace).mockResolvedValue({
                count: 19, latestName: 'عبدالخالق عامر', latestAt, oldestAt,
                byPage: [{ pageId: 'page_2', count: 12, oldestAt }, { pageId: 'page_1', count: 7, oldestAt: latestAt }],
            });

            const res = await app.inject({ method: 'GET', url: '/leads/count' });

            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.body)).toEqual({
                count: 19, latestName: 'عبدالخالق عامر',
                latestAt: latestAt.toISOString(), oldestAt: oldestAt.toISOString(),
                // Reaches the client intact: the nav badge's deep link picks the
                // page it opens from this, so dropping it in the response layer
                // would land a badge of 19 on whatever page was stored last.
                byPage: [
                    { pageId: 'page_2', count: 12, oldestAt: oldestAt.toISOString() },
                    { pageId: 'page_1', count: 7, oldestAt: latestAt.toISOString() },
                ],
            });
            // Must NOT fall back to the per-page path.
            expect(leadExtractorService.getNewLeadsCount).not.toHaveBeenCalled();
        });

        it('workspace summary is scoped to the caller workspace', async () => {
            vi.mocked(leadExtractorService.getNewLeadsSummaryForWorkspace).mockResolvedValue({
                count: 0, latestName: null, latestAt: null, oldestAt: null, byPage: [],
            });

            await app.inject({ method: 'GET', url: '/leads/count' });

            expect(leadExtractorService.getNewLeadsSummaryForWorkspace).toHaveBeenCalledWith('workspace_1');
        });
    });

    describe('PATCH /leads/:id/status', () => {
        it('updates lead status successfully', async () => {
            vi.mocked(leadExtractorService.updateLeadStatus).mockResolvedValue({
                ...MOCK_LEAD,
                status: 'contacted',
            } as any);

            const res = await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/status',
                payload: { pageId: 'page_1', status: 'contacted' },
            });

            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.body).status).toBe('contacted');
        });

        it('returns 400 for invalid status', async () => {
            const res = await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/status',
                payload: { pageId: 'page_1', status: 'invalid' },
            });
            expect(res.statusCode).toBe(400);
        });

        it('returns 400 when pageId is missing', async () => {
            const res = await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/status',
                payload: { status: 'contacted' },
            });
            expect(res.statusCode).toBe(400);
        });

        it('returns 404 when lead not found', async () => {
            vi.mocked(leadExtractorService.updateLeadStatus).mockResolvedValue(null as any);

            const res = await app.inject({
                method: 'PATCH',
                url: '/leads/nonexistent/status',
                payload: { pageId: 'page_1', status: 'contacted' },
            });
            expect(res.statusCode).toBe(404);
        });

        // ── Custom sub-stages (workspace-defined, free-text labels) ──────────

        it('accepts a sub-stage defined for the target status', async () => {
            vi.mocked(leadExtractorService.updateLeadStatus).mockResolvedValue({
                ...MOCK_LEAD,
                status: 'converted',
                subStage: 'sub_delivered',
            } as any);

            const res = await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/status',
                payload: { pageId: 'page_1', status: 'converted', subStage: 'sub_delivered' },
            });

            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.body).subStage).toBe('sub_delivered');
            expect(leadExtractorService.updateLeadStatus).toHaveBeenCalledWith(
                'lead_1', 'page_1', 'converted', 'sub_delivered',
            );
        });

        it('rejects a sub-stage id the workspace never defined', async () => {
            const res = await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/status',
                payload: { pageId: 'page_1', status: 'converted', subStage: 'sub_foreign' },
            });
            expect(res.statusCode).toBe(400);
            expect(leadExtractorService.updateLeadStatus).not.toHaveBeenCalled();
        });

        it('rejects a sub-stage defined under a DIFFERENT main status', async () => {
            // sub_delivered exists, but only under "converted" — not "contacted".
            const res = await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/status',
                payload: { pageId: 'page_1', status: 'contacted', subStage: 'sub_delivered' },
            });
            expect(res.statusCode).toBe(400);
        });

        it('clears the sub-stage when only the main status is sent', async () => {
            vi.mocked(leadExtractorService.updateLeadStatus).mockResolvedValue({
                ...MOCK_LEAD,
                status: 'contacted',
                subStage: null,
            } as any);

            await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/status',
                payload: { pageId: 'page_1', status: 'contacted' },
            });

            expect(leadExtractorService.updateLeadStatus).toHaveBeenCalledWith(
                'lead_1', 'page_1', 'contacted', null,
            );
        });
    });

    describe('PATCH /leads/:id/fields', () => {
        it('writes values for workspace-defined fields', async () => {
            vi.mocked(leadExtractorService.updateLeadCustomFields).mockResolvedValue({
                ...MOCK_LEAD,
                customFields: { field_paid: '500 ر.س', field_discount: '10%' },
            } as any);

            const res = await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/fields',
                payload: { pageId: 'page_1', fields: { field_paid: '500 ر.س', field_discount: '10%' } },
            });

            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.body).customFields).toEqual({ field_paid: '500 ر.س', field_discount: '10%' });
            expect(leadExtractorService.updateLeadCustomFields).toHaveBeenCalledWith(
                'lead_1', 'page_1', { field_paid: '500 ر.س', field_discount: '10%' },
            );
        });

        it('rejects a field id the workspace never defined', async () => {
            const res = await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/fields',
                payload: { pageId: 'page_1', fields: { field_foreign: 'x' } },
            });
            expect(res.statusCode).toBe(400);
            expect(leadExtractorService.updateLeadCustomFields).not.toHaveBeenCalled();
        });

        it('rejects non-string values', async () => {
            const res = await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/fields',
                payload: { pageId: 'page_1', fields: { field_paid: 500 } },
            });
            expect(res.statusCode).toBe(400);
            expect(leadExtractorService.updateLeadCustomFields).not.toHaveBeenCalled();
        });

        it('stores null when every value is cleared (empty strings dropped)', async () => {
            vi.mocked(leadExtractorService.updateLeadCustomFields).mockResolvedValue({
                ...MOCK_LEAD,
                customFields: null,
            } as any);

            const res = await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/fields',
                payload: { pageId: 'page_1', fields: { field_paid: '  ', field_discount: '' } },
            });

            expect(res.statusCode).toBe(200);
            expect(leadExtractorService.updateLeadCustomFields).toHaveBeenCalledWith(
                'lead_1', 'page_1', null,
            );
        });

        it('returns 400 when pageId is missing', async () => {
            const res = await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/fields',
                payload: { fields: { field_paid: '500' } },
            });
            expect(res.statusCode).toBe(400);
        });

        it('returns 404 when lead not found', async () => {
            vi.mocked(leadExtractorService.updateLeadCustomFields).mockResolvedValue(null);
            const res = await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/fields',
                payload: { pageId: 'page_1', fields: { field_paid: '500' } },
            });
            expect(res.statusCode).toBe(404);
        });
    });

    // ── Per-page effective config (page override ?? workspace default) ───────
    describe('per-page effective config threading', () => {
        it('passes the fetched page row to the resolver so validation is page-aware', async () => {
            vi.mocked(leadExtractorService.updateLeadStatus).mockResolvedValue({
                ...MOCK_LEAD, status: 'converted', subStage: 'sub_delivered',
            } as any);

            await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/status',
                payload: { pageId: 'page_1', status: 'converted', subStage: 'sub_delivered' },
            });

            expect(workspaceSettingsService.getEffectiveLeadConfig).toHaveBeenCalledWith(
                'workspace_1', expect.objectContaining({ id: 'page_1' }),
            );
        });

        it('accepts a sub-stage that exists only in the PAGE override', async () => {
            vi.mocked(workspaceSettingsService.getEffectiveLeadConfig).mockResolvedValueOnce({
                leadStages: { converted: [{ id: 'sub_page_only', label: 'تم الشحن', color: 'cyan' }] },
                leadFields: [],
            } as any);
            vi.mocked(leadExtractorService.updateLeadStatus).mockResolvedValue({
                ...MOCK_LEAD, status: 'converted', subStage: 'sub_page_only',
            } as any);

            const res = await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/status',
                payload: { pageId: 'page_1', status: 'converted', subStage: 'sub_page_only' },
            });
            expect(res.statusCode).toBe(200);
        });

        it('rejects a workspace-only sub-stage once the page overrides that slice (replace, not merge)', async () => {
            vi.mocked(workspaceSettingsService.getEffectiveLeadConfig).mockResolvedValueOnce({
                leadStages: { converted: [{ id: 'sub_page_only', label: 'تم الشحن', color: 'cyan' }] },
                leadFields: [],
            } as any);

            const res = await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/status',
                payload: { pageId: 'page_1', status: 'converted', subStage: 'sub_delivered' },
            });
            expect(res.statusCode).toBe(400);
            expect(leadExtractorService.updateLeadStatus).not.toHaveBeenCalled();
        });

        it('validates field keys against the PAGE effective fields', async () => {
            vi.mocked(workspaceSettingsService.getEffectiveLeadConfig).mockResolvedValueOnce({
                leadStages: {},
                leadFields: [{ id: 'field_page_only', label: 'رقم الطلب' }],
            } as any);

            const rejected = await app.inject({
                method: 'PATCH',
                url: '/leads/lead_1/fields',
                payload: { pageId: 'page_1', fields: { field_paid: '500' } },
            });
            expect(rejected.statusCode).toBe(400);
            expect(leadExtractorService.updateLeadCustomFields).not.toHaveBeenCalled();
        });
    });

    describe('DELETE /leads/:id', () => {
        it('deletes a lead successfully', async () => {
            vi.mocked(leadExtractorService.deleteLead).mockResolvedValue(true as any);

            const res = await app.inject({
                method: 'DELETE',
                url: '/leads/lead_1?pageId=page_1',
            });
            expect(res.statusCode).toBe(204);
        });

        it('returns 400 when pageId is missing', async () => {
            const res = await app.inject({ method: 'DELETE', url: '/leads/lead_1' });
            expect(res.statusCode).toBe(400);
        });

        it('returns 404 when lead not found', async () => {
            vi.mocked(leadExtractorService.deleteLead).mockResolvedValue(false as any);

            const res = await app.inject({
                method: 'DELETE',
                url: '/leads/nonexistent?pageId=page_1',
            });
            expect(res.statusCode).toBe(404);
        });
    });
});
