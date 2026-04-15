import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { WorkspaceRequest } from '../../src/middleware/workspace';

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
    isPageDisconnected: vi.fn((page: any) => !!page && page.accessToken === ''),
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canAddPage: vi.fn(),
        canEnablePage: vi.fn(),
    },
}));

vi.mock('../../src/services/facebook', () => ({
    facebookService: {
        subscribePageToWebhooks: vi.fn(),
        unsubscribePageFromWebhooks: vi.fn(),
    },
}));

vi.mock('../../src/services/auth', () => ({
    authService: {
        getUserById: vi.fn().mockResolvedValue(null),
    },
}));

// Import after mocks
import { pagesController } from '../../src/controllers/pages';
import { pagesService } from '../../src/services/pages';
import { subscriptionsService } from '../../src/services/subscriptions';

describe('Pages Controller', () => {
    let mockRequest: Partial<WorkspaceRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
        mockRequest = {
            user: { userId: 'user-123', facebookId: 'fb-123' },
            workspaceId: 'test_workspace_id',
            workspaceOwnerId: 'user-123',
            workspaceRole: 'owner',
            query: {},
            params: {},
            body: {},
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as any,
        };
    });

    // ---- create ----
    describe('create', () => {
        it('should create a page successfully', async () => {
            const newPage = { id: 'page-1', name: 'Test Page', accessToken: 'tok' };
            vi.mocked(subscriptionsService.canEnablePage).mockResolvedValue({ allowed: true, limit: 5, used: 1 } as any);
            vi.mocked(pagesService.createPage).mockResolvedValue(newPage as any);
            mockRequest.body = { facebookPageId: 'fb-page-1', name: 'Test Page', accessToken: 'tok' };

            await pagesController.create(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(201);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ id: 'page-1', isConnected: true }));
        });

        it('should return 403 when subscription limit reached', async () => {
            vi.mocked(subscriptionsService.canEnablePage).mockResolvedValue({
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
        it('should return all pages for the user with isConnected flag', async () => {
            const pages = [{ id: 'page-1', accessToken: 'tok' }, { id: 'page-2', accessToken: '' }];
            vi.mocked(pagesService.getPages).mockResolvedValue(pages as any);

            await pagesController.getAll(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(pagesService.getPages).toHaveBeenCalledWith('test_workspace_id');
            const sent = (mockReply.send as any).mock.calls[0][0];
            expect(sent[0]).toEqual(expect.objectContaining({ id: 'page-1', isConnected: true }));
            expect(sent[1]).toEqual(expect.objectContaining({ id: 'page-2', isConnected: false }));
            // accessToken should be stripped
            expect(sent[0].accessToken).toBeUndefined();
        });
    });

    // ---- getOne ----
    describe('getOne', () => {
        it('should return a single page with isConnected flag', async () => {
            const page = { id: 'page-1', name: 'My Page', accessToken: 'tok' };
            vi.mocked(pagesService.getPage).mockResolvedValue(page as any);
            mockRequest.params = { id: 'page-1' };

            await pagesController.getOne(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.getPage).toHaveBeenCalledWith('test_workspace_id', 'page-1');
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ id: 'page-1', isConnected: true }));
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
            const updated = { id: 'page-1', name: 'Updated', accessToken: 'tok' };
            vi.mocked(pagesService.updatePage).mockResolvedValue(updated as any);
            mockRequest.params = { id: 'page-1' };
            mockRequest.body = { name: 'Updated' };

            await pagesController.update(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.updatePage).toHaveBeenCalledWith('test_workspace_id', 'page-1', { name: 'Updated' });
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ id: 'page-1', isConnected: true }));
        });
    });

    // ---- delete ----
    describe('delete', () => {
        it('should delete a page and return 204', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-1', facebookPageId: 'fb-page-1', accessToken: 'tok' } as any);
            vi.mocked(pagesService.deletePage).mockResolvedValue(undefined as any);
            mockRequest.params = { id: 'page-1' };

            await pagesController.delete(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.deletePage).toHaveBeenCalledWith('test_workspace_id', 'page-1');
            expect(mockReply.status).toHaveBeenCalledWith(204);
        });
    });

    // ---- toggleAutoReply ----
    describe('toggleAutoReply', () => {
        it('should toggle auto-reply successfully', async () => {
            const toggled = { id: 'page-1', autoReplyEnabled: true, accessToken: 'tok' };
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-1', accessToken: 'tok' } as any);
            vi.mocked(subscriptionsService.canEnablePage).mockResolvedValue({ allowed: true, limit: 5, used: 0, remaining: 5 } as any);
            vi.mocked(pagesService.toggleAutoReply).mockResolvedValue(toggled as any);
            mockRequest.params = { id: 'page-1' };
            mockRequest.body = { enabled: true };

            await pagesController.toggleAutoReply(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.toggleAutoReply).toHaveBeenCalledWith('test_workspace_id', 'page-1', true);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ id: 'page-1', isConnected: true }));
        });

        it('should return 400 when page is disconnected', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-1', accessToken: '' } as any);
            mockRequest.params = { id: 'page-1' };
            mockRequest.body = { enabled: true };

            await pagesController.toggleAutoReply(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAGE_DISCONNECTED' }));
        });
    });

    // ---- sync ----
    describe('sync', () => {
        it('should sync pages from Facebook successfully', async () => {
            const syncedPages = [{ id: 'page-1', accessToken: 'tok' }];
            vi.mocked(subscriptionsService.canEnablePage).mockResolvedValue({ allowed: true, limit: 5, used: 1, remaining: 4 } as any);
            vi.mocked(pagesService.syncFromFacebook).mockResolvedValue({ syncedPages, skippedCount: 0, takenCount: 0, revokedCount: 0 } as any);
            mockRequest.body = { accessToken: 'fb-token-abc' };

            await pagesController.sync(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.syncFromFacebook).toHaveBeenCalledWith(
                'test_workspace_id',
                'user-123',
                'fb-token-abc',
                'user-123',
                expect.objectContaining({ info: expect.any(Function) }),
            );
            const sent = (mockReply.send as any).mock.calls[0][0];
            expect(sent.synced).toBe(1);
            expect(sent.pages[0]).toEqual(expect.objectContaining({ id: 'page-1', isConnected: true }));
            expect(sent.pages[0].accessToken).toBeUndefined();
        });

        it('should return 400 when accessToken is missing', async () => {
            mockRequest.body = {};

            await pagesController.sync(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Access token is required' }));
        });
    });
});
