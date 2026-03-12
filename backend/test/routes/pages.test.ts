import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import pagesRoutes from '../../src/routes/pages';
import { pagesService } from '../../src/services/pages';

// Mock services
vi.mock('../../src/services/pages');
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canAddPage: vi.fn().mockResolvedValue({ allowed: true, limit: 10, used: 1, remaining: 9 }),
        canEnablePage: vi.fn().mockResolvedValue({ allowed: true, limit: 10, used: 1, remaining: 9 }),
    }
}));
vi.mock('../../src/middleware/auth', () => ({
    authenticate: async (req: any) => {
        req.user = { userId: 'test_user_id', facebookId: 'test_fb_id' };
    }
}));
vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: async (req: any) => {
        req.workspaceId = 'test_workspace_id';
        req.workspaceRole = 'owner';
    }
}));

describe('Pages Routes', () => {
    let app: any;

    beforeEach(async () => {
        app = fastify();
        app.register(pagesRoutes);
        await app.ready();
        vi.clearAllMocks();
    });

    describe('POST /pages', () => {
        it('should create a new page', { timeout: 10_000 }, async () => {
            const newPageData = {
                facebookPageId: 'fb_page_123',
                name: 'My Store',
                accessToken: 'access_token_123'
            };
            const createdPage = {
                ...newPageData,
                id: 'page_1',
                userId: 'test_user_id',
                autoReplyEnabled: true,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            vi.mocked(pagesService.createPage).mockResolvedValue(createdPage);

            const response = await app.inject({
                method: 'POST',
                url: '/pages',
                payload: newPageData
            });

            expect(response.statusCode).toBe(201);
            expect(pagesService.createPage).toHaveBeenCalledWith('test_workspace_id', 'test_user_id', newPageData);
        });
    });

    describe('GET /pages', () => {
        it('should get all pages for user', async () => {
            const pagesList = [{ id: 'page_1', name: 'My Store', accessToken: 'tok' }];
            vi.mocked(pagesService.getPages).mockResolvedValue(pagesList as any);

            const response = await app.inject({
                method: 'GET',
                url: '/pages'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual([expect.objectContaining({ id: 'page_1', name: 'My Store', isConnected: true })]);
            expect(pagesService.getPages).toHaveBeenCalledWith('test_workspace_id');
        });
    });

    describe('GET /pages/:id', () => {
        it('should get a single page', async () => {
            const page = { id: 'page_1', name: 'My Store', accessToken: 'tok' };
            vi.mocked(pagesService.getPage).mockResolvedValue(page as any);

            const response = await app.inject({
                method: 'GET',
                url: '/pages/page_1'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(expect.objectContaining({ id: 'page_1', name: 'My Store', isConnected: true }));
        });

        it('should return 404 if page not found', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/pages/non_existent'
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('DELETE /pages/:id', () => {
        it('should delete a page', async () => {
            vi.mocked(pagesService.deletePage).mockResolvedValue(undefined);

            const response = await app.inject({
                method: 'DELETE',
                url: '/pages/page_1'
            });

            expect(response.statusCode).toBe(204);
            expect(pagesService.deletePage).toHaveBeenCalledWith('test_workspace_id', 'page_1');
        });
    });

    describe('PATCH /pages/:id/auto-reply', () => {
        it('should toggle auto-reply', async () => {
            const updatedPage = { id: 'page_1', autoReplyEnabled: false };
            vi.mocked(pagesService.toggleAutoReply).mockResolvedValue(updatedPage as any);

            const response = await app.inject({
                method: 'PATCH',
                url: '/pages/page_1/auto-reply',
                payload: { enabled: false }
            });

            expect(response.statusCode).toBe(200);
            expect(pagesService.toggleAutoReply).toHaveBeenCalledWith('test_workspace_id', 'page_1', false);
        });
    });
});

