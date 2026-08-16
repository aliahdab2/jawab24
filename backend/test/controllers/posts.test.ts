import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { WorkspaceRequest } from '../../src/middleware/workspace';

// Mock dependencies before imports
vi.mock('../../src/services/posts', () => ({
    postsService: {
        listPublishedPosts: vi.fn(),
        getPostsByWorkspace: vi.fn(),
        getPostsByPage: vi.fn(),
        getPost: vi.fn(),
        updatePost: vi.fn(),
        updatePostByWorkspace: vi.fn(),
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

    // ---- getPublishedPosts (Post Reply picker) ----
    describe('getPublishedPosts', () => {
        // H2 regression (PR #772 review): the guard read `!page.accessToken`, which is
        // the '' sentinel on EVERY Instagram-direct row, so the picker returned a
        // confidently empty list and the service's Instagram-direct branch was dead
        // code. The guard must ask about the token the requested source sends with.
        it('serves the picker for an Instagram-DIRECT page (empty FB token, Instagram credential set)', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({
                id: 'page-ig',
                facebookPageId: null,
                accessToken: '',
                instagramAccountId: 'ig-9',
                instagramAccessToken: 'ig-direct-token',
            } as any);
            const picker = { posts: [{ platformPostId: 'm1', source: 'instagram' }], nextCursor: null, partial: false };
            vi.mocked(postsService.listPublishedPosts).mockResolvedValue(picker as any);

            mockRequest.params = { pageId: 'page-ig' };
            mockRequest.query = { source: 'instagram' };
            await postsController.getPublishedPosts(mockRequest as any, mockReply as FastifyReply);

            // The service runs — and receives the Instagram token the resolver needs.
            expect(postsService.listPublishedPosts).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'page-ig', instagramAccessToken: 'ig-direct-token' }),
                expect.objectContaining({ source: 'instagram' }),
            );
            expect(mockReply.send).toHaveBeenCalledWith(picker);
        });

        // The 2026-08-14 contract this guard exists for must survive the H2 fix: a
        // Facebook page whose token was revoked still gets the honest partial-empty.
        it('still answers partial-empty for a Facebook page with a blanked token', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({
                id: 'page-fb',
                facebookPageId: 'fb-1',
                accessToken: '',
                instagramAccountId: null,
                instagramAccessToken: null,
            } as any);

            mockRequest.params = { pageId: 'page-fb' };
            mockRequest.query = { source: 'facebook' };
            await postsController.getPublishedPosts(mockRequest as any, mockReply as FastifyReply);

            expect(postsService.listPublishedPosts).not.toHaveBeenCalled();
            expect(mockReply.send).toHaveBeenCalledWith({ posts: [], nextCursor: null, partial: true });
        });
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

            expect(postsService.getPost).toHaveBeenCalledWith('post-1', 'test_workspace_id');
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
            vi.mocked(postsService.updatePostByWorkspace).mockResolvedValue(updated as any);
            mockRequest.params = { id: 'post-1' };
            mockRequest.body = { message: 'Updated' };

            await postsController.update(mockRequest as any, mockReply as FastifyReply);

            expect(postsService.updatePostByWorkspace).toHaveBeenCalledWith('post-1', { message: 'Updated' }, 'test_workspace_id');
            expect(mockReply.send).toHaveBeenCalledWith(updated);
        });

        it('should return 404 when updating a non-existent post', async () => {
            vi.mocked(postsService.updatePostByWorkspace).mockResolvedValue(null as any);
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
            vi.mocked(postsService.deletePost).mockResolvedValue(true as any);
            mockRequest.params = { id: 'post-1' };

            await postsController.delete(mockRequest as any, mockReply as FastifyReply);

            expect(postsService.deletePost).toHaveBeenCalledWith('post-1', 'test_workspace_id');
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

            expect(postsService.toggleAutoReply).toHaveBeenCalledWith('post-1', false, 'test_workspace_id');
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
