import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import leadsRoutes from '../../src/routes/leads';
import { leadExtractorService } from '../../src/services/leadExtractor';

vi.mock('../../src/services/leadExtractor', () => ({
    leadExtractorService: {
        getLeadsByPage: vi.fn(),
        getAllLeadsForExport: vi.fn(),
        updateLeadStatus: vi.fn(),
        deleteLead: vi.fn(),
        getNewLeadsCount: vi.fn(),
    },
}));

vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPage: vi.fn().mockResolvedValue({ id: 'page_1', name: 'Test Page' }),
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

        it('returns 400 when pageId is missing', async () => {
            const res = await app.inject({ method: 'GET', url: '/leads/count' });
            expect(res.statusCode).toBe(400);
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
