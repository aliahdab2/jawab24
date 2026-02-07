import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from '../../src/middleware/auth';

// Mock dependencies before imports
vi.mock('../../src/services/pages', () => ({
    pagesService: {
        createPage: vi.fn(),
        getPages: vi.fn(),
        getPage: vi.fn(),
        updatePage: vi.fn(),
        deletePage: vi.fn(),
        toggleAutoReply: vi.fn(),
        syncFromFacebook: vi.fn(),
    },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canAddPage: vi.fn(),
    },
}));

// Import after mocks
import { pagesController } from '../../src/controllers/pages';
import { pagesService } from '../../src/services/pages';
import { subscriptionsService } from '../../src/services/subscriptions';

describe('Pages Controller', () => {
    let mockRequest: Partial<AuthenticatedRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
        mockRequest = {
            user: { userId: 'user-123', facebookId: 'fb-123' },
            query: {},
            params: {},
            body: {},
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as any,
        };
    });

    // ---- create ----
    describe('create', () => {
        it('should create a page successfully', async () => {
            const newPage = { id: 'page-1', name: 'Test Page' };
            vi.mocked(subscriptionsService.canAddPage).mockResolvedValue({ allowed: true, limit: 5, used: 1 } as any);
            vi.mocked(pagesService.createPage).mockResolvedValue(newPage as any);
            mockRequest.body = { facebookPageId: 'fb-page-1', name: 'Test Page', accessToken: 'tok' };

            await pagesController.create(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(201);
            expect(mockReply.send).toHaveBeenCalledWith(newPage);
        });

        it('should return 403 when subscription limit reached', async () => {
            vi.mocked(subscriptionsService.canAddPage).mockResolvedValue({
                allowed: false,
                reason: 'Page limit reached',
                limit: 3,
                used: 3,
            } as any);

            await pagesController.create(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Page limit reached' }));
        });
    });

    // ---- getAll ----
    describe('getAll', () => {
        it('should return all pages for the user', async () => {
            const pages = [{ id: 'page-1' }, { id: 'page-2' }];
            vi.mocked(pagesService.getPages).mockResolvedValue(pages as any);

            await pagesController.getAll(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(pagesService.getPages).toHaveBeenCalledWith('user-123');
            expect(mockReply.send).toHaveBeenCalledWith(pages);
        });
    });

    // ---- getOne ----
    describe('getOne', () => {
        it('should return a single page', async () => {
            const page = { id: 'page-1', name: 'My Page' };
            vi.mocked(pagesService.getPage).mockResolvedValue(page as any);
            mockRequest.params = { id: 'page-1' };

            await pagesController.getOne(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.getPage).toHaveBeenCalledWith('user-123', 'page-1');
            expect(mockReply.send).toHaveBeenCalledWith(page);
        });

        it('should return 404 when page not found', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);
            mockRequest.params = { id: 'nonexistent' };

            await pagesController.getOne(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Page not found' });
        });
    });

    // ---- update ----
    describe('update', () => {
        it('should update a page successfully', async () => {
            const updated = { id: 'page-1', name: 'Updated' };
            vi.mocked(pagesService.updatePage).mockResolvedValue(updated as any);
            mockRequest.params = { id: 'page-1' };
            mockRequest.body = { name: 'Updated' };

            await pagesController.update(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.updatePage).toHaveBeenCalledWith('user-123', 'page-1', { name: 'Updated' });
            expect(mockReply.send).toHaveBeenCalledWith(updated);
        });
    });

    // ---- delete ----
    describe('delete', () => {
        it('should delete a page and return 204', async () => {
            vi.mocked(pagesService.deletePage).mockResolvedValue(undefined as any);
            mockRequest.params = { id: 'page-1' };

            await pagesController.delete(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.deletePage).toHaveBeenCalledWith('user-123', 'page-1');
            expect(mockReply.status).toHaveBeenCalledWith(204);
        });
    });

    // ---- toggleAutoReply ----
    describe('toggleAutoReply', () => {
        it('should toggle auto-reply successfully', async () => {
            const toggled = { id: 'page-1', autoReplyEnabled: true };
            vi.mocked(pagesService.toggleAutoReply).mockResolvedValue(toggled as any);
            mockRequest.params = { id: 'page-1' };
            mockRequest.body = { enabled: true };

            await pagesController.toggleAutoReply(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.toggleAutoReply).toHaveBeenCalledWith('user-123', 'page-1', true);
            expect(mockReply.send).toHaveBeenCalledWith(toggled);
        });
    });

    // ---- sync ----
    describe('sync', () => {
        it('should sync pages from Facebook successfully', async () => {
            const syncedPages = [{ id: 'page-1' }];
            vi.mocked(subscriptionsService.canAddPage).mockResolvedValue({ allowed: true, limit: 5, used: 1 } as any);
            vi.mocked(pagesService.syncFromFacebook).mockResolvedValue(syncedPages as any);
            mockRequest.body = { accessToken: 'fb-token-abc' };

            await pagesController.sync(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.syncFromFacebook).toHaveBeenCalledWith('user-123', 'fb-token-abc');
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ synced: 1, pages: syncedPages }));
        });

        it('should return 400 when accessToken is missing', async () => {
            mockRequest.body = {};

            await pagesController.sync(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Access token is required' }));
        });
    });
});
