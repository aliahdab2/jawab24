import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { WorkspaceRequest } from '../../src/middleware/workspace';

// Mock dependencies before imports
vi.mock('../../src/services/posts', () => ({
    postsService: {
        getPostsByWorkspace: vi.fn(),
        getPostsByPage: vi.fn(),
        getPost: vi.fn(),
        updatePost: vi.fn(),
        deletePost: vi.fn(),
        toggleAutoReply: vi.fn(),
    },
}));

vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPage: vi.fn(),
    },
}));

// Import after mocks
import { postsController } from '../../src/controllers/posts';
import { postsService } from '../../src/services/posts';
import { pagesService } from '../../src/services/pages';

describe('Posts Controller', () => {
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
            workspaceRole: 'owner',
            query: {},
            params: {},
            body: {},
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as any,
        };
    });

    // ---- getAll ----
    describe('getAll', () => {
        it('should return all posts for the user', async () => {
            const posts = [{ id: 'post-1' }, { id: 'post-2' }];
            vi.mocked(postsService.getPostsByWorkspace).mockResolvedValue(posts as any);

            await postsController.getAll(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(postsService.getPostsByWorkspace).toHaveBeenCalledWith('test_workspace_id');
            expect(mockReply.send).toHaveBeenCalledWith(posts);
        });
    });

    // ---- getByPage ----
    describe('getByPage', () => {
        it('should return posts for a specific page', async () => {
            const page = { id: 'page-1', name: 'My Page' };
            const posts = [{ id: 'post-1', pageId: 'page-1' }];
            vi.mocked(pagesService.getPage).mockResolvedValue(page as any);
            vi.mocked(postsService.getPostsByPage).mockResolvedValue(posts as any);
            mockRequest.params = { pageId: 'page-1' };

            await postsController.getByPage(mockRequest as any, mockReply as FastifyReply);

            expect(pagesService.getPage).toHaveBeenCalledWith('test_workspace_id', 'page-1');
            expect(postsService.getPostsByPage).toHaveBeenCalledWith('page-1');
            expect(mockReply.send).toHaveBeenCalledWith(posts);
        });

        it('should return 404 when page not found', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);
            mockRequest.params = { pageId: 'nonexistent' };

            await postsController.getByPage(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Page not found' });
        });
    });

    // ---- getOne ----
    describe('getOne', () => {
        it('should return a single post', async () => {
            const post = { id: 'post-1', message: 'Hello' };
            vi.mocked(postsService.getPost).mockResolvedValue(post as any);
            mockRequest.params = { id: 'post-1' };

            await postsController.getOne(mockRequest as any, mockReply as FastifyReply);

            expect(postsService.getPost).toHaveBeenCalledWith('post-1');
            expect(mockReply.send).toHaveBeenCalledWith(post);
        });

        it('should return 404 when post not found', async () => {
            vi.mocked(postsService.getPost).mockResolvedValue(null as any);
            mockRequest.params = { id: 'nonexistent' };

            await postsController.getOne(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Post not found' });
        });
    });

    // ---- update ----
    describe('update', () => {
        it('should update a post successfully', async () => {
            const updated = { id: 'post-1', message: 'Updated' };
            vi.mocked(postsService.updatePost).mockResolvedValue(updated as any);
            mockRequest.params = { id: 'post-1' };
            mockRequest.body = { message: 'Updated' };

            await postsController.update(mockRequest as any, mockReply as FastifyReply);

            expect(postsService.updatePost).toHaveBeenCalledWith('post-1', { message: 'Updated' });
            expect(mockReply.send).toHaveBeenCalledWith(updated);
        });

        it('should return 404 when updating a non-existent post', async () => {
            vi.mocked(postsService.updatePost).mockResolvedValue(null as any);
            mockRequest.params = { id: 'nonexistent' };
            mockRequest.body = { message: 'Updated' };

            await postsController.update(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Post not found' });
        });
    });

    // ---- delete ----
    describe('delete', () => {
        it('should delete a post and return 204', async () => {
            vi.mocked(postsService.deletePost).mockResolvedValue(undefined as any);
            mockRequest.params = { id: 'post-1' };

            await postsController.delete(mockRequest as any, mockReply as FastifyReply);

            expect(postsService.deletePost).toHaveBeenCalledWith('post-1');
            expect(mockReply.status).toHaveBeenCalledWith(204);
        });
    });

    // ---- toggleAutoReply ----
    describe('toggleAutoReply', () => {
        it('should toggle auto-reply successfully', async () => {
            const toggled = { id: 'post-1', autoReplyEnabled: false };
            vi.mocked(postsService.toggleAutoReply).mockResolvedValue(toggled as any);
            mockRequest.params = { id: 'post-1' };
            mockRequest.body = { enabled: false };

            await postsController.toggleAutoReply(mockRequest as any, mockReply as FastifyReply);

            expect(postsService.toggleAutoReply).toHaveBeenCalledWith('post-1', false);
            expect(mockReply.send).toHaveBeenCalledWith(toggled);
        });

        it('should return 404 when toggling a non-existent post', async () => {
            vi.mocked(postsService.toggleAutoReply).mockResolvedValue(null as any);
            mockRequest.params = { id: 'nonexistent' };
            mockRequest.body = { enabled: true };

            await postsController.toggleAutoReply(mockRequest as any, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Post not found' });
        });
    });
});
