import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import postsRoutes from '../../src/routes/posts';
import { postsService } from '../../src/services/posts';
import { pagesService } from '../../src/services/pages';

// Mock services
vi.mock('../../src/services/posts');
vi.mock('../../src/services/pages');
vi.mock('../../src/services/comments');
vi.mock('../../src/middleware/auth', () => ({
    authenticate: async (req: any) => {
        req.user = { userId: 'test_user_id', facebookId: 'test_fb_id' };
    }
}));
vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: async (req: any) => {
        req.workspaceId = 'test_workspace_id';
        req.workspaceRole = 'owner';
    },
    requireRole: () => async () => {},
}));

describe('Posts Routes', () => {
    let app: any;

    beforeEach(async () => {
        app = fastify();
        app.register(postsRoutes);
        await app.ready();
        vi.clearAllMocks();
    });

    describe('GET /posts', () => {
        it('should get all posts for user', async () => {
            const postsList = [{ id: 'post_1', message: 'Hello World' }];
            vi.mocked(postsService.getPostsByWorkspace).mockResolvedValue(postsList as any);

            const response = await app.inject({
                method: 'GET',
                url: '/posts'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(postsList);
            expect(postsService.getPostsByWorkspace).toHaveBeenCalledWith('test_workspace_id');
        });
    });

    describe('GET /posts/:id', () => {
        it('should get a single post', async () => {
            const post = { id: 'post_1', message: 'Hello World' };
            vi.mocked(postsService.getPost).mockResolvedValue(post as any);

            const response = await app.inject({
                method: 'GET',
                url: '/posts/post_1'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(post);
        });

        it('should return 404 if post not found', async () => {
            vi.mocked(postsService.getPost).mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/posts/non_existent'
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('GET /pages/:pageId/posts', () => {
        it('should get posts for a specific page', async () => {
            const page = { id: 'page_1', name: 'My Store' };
            const postsList = [{ id: 'post_1', message: 'Hello' }];
            
            vi.mocked(pagesService.getPage).mockResolvedValue(page as any);
            vi.mocked(postsService.getPostsByPage).mockResolvedValue(postsList as any);

            const response = await app.inject({
                method: 'GET',
                url: '/pages/page_1/posts'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(postsList);
        });

        it('should return 404 if page not found', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/pages/non_existent/posts'
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('DELETE /posts/:id', () => {
        it('should delete a post', async () => {
            vi.mocked(postsService.deletePost).mockResolvedValue(true as any);

            const response = await app.inject({
                method: 'DELETE',
                url: '/posts/post_1'
            });

            expect(response.statusCode).toBe(204);
            expect(postsService.deletePost).toHaveBeenCalledWith('post_1', 'test_workspace_id');
        });
    });

    describe('PATCH /posts/:id/auto-reply', () => {
        it('should toggle auto-reply', async () => {
            const updatedPost = { id: 'post_1', autoReplyEnabled: false };
            vi.mocked(postsService.toggleAutoReply).mockResolvedValue(updatedPost as any);

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/auto-reply',
                payload: { enabled: false }
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.toggleAutoReply).toHaveBeenCalledWith('post_1', false, 'test_workspace_id');
        });
    });

    describe('PATCH /posts/:id/trigger', () => {
        it('should set trigger keyword and reply', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue(true);

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Here are the details!' },
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.updateTrigger).toHaveBeenCalledWith('post_1', 'facebook', '.', 'Here are the details!', 'test_workspace_id', 'keyword');
        });

        it('should clear trigger when both values are null', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue(true);

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'instagram', triggerKeyword: null, triggerReply: null },
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.updateTrigger).toHaveBeenCalledWith('post_1', 'instagram', null, null, 'test_workspace_id', 'keyword');
        });

        it('should return 400 for invalid source', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'twitter', triggerKeyword: '.', triggerReply: 'Details' },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 400 when keyword is set but reply is null (partial trigger)', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: null },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 404 when post not found or not owned', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue(false);

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/unknown/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Details' },
            });

            expect(response.statusCode).toBe(404);
        });
    });
});

