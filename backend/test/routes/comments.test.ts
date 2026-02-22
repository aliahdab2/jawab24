import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import commentsRoutes from '../../src/routes/comments';
import { commentsService } from '../../src/services/comments';

// Mock services
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
    }
}));

describe('Comments Routes', () => {
    let app: any;

    beforeEach(async () => {
        app = fastify();
        app.register(commentsRoutes);
        await app.ready();
        vi.clearAllMocks();
    });

    describe('GET /comments', () => {
        it('should get all comments for user', async () => {
            const commentsList = [{ id: 'comment_1', message: 'Great product!' }];
            vi.mocked(commentsService.getCommentsByWorkspace).mockResolvedValue(commentsList as any);

            const response = await app.inject({
                method: 'GET',
                url: '/comments'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(commentsList);
        });

        it('should include pageId in comment response', async () => {
            const commentsList = [{
                id: 'comment_1',
                message: 'Great!',
                pageId: 'page-uuid-123',
                pageName: 'My Shop',
            }];
            vi.mocked(commentsService.getCommentsByWorkspace).mockResolvedValue(commentsList as any);

            const response = await app.inject({
                method: 'GET',
                url: '/comments'
            });

            const payload = JSON.parse(response.payload);
            expect(payload[0].pageId).toBe('page-uuid-123');
            expect(payload[0].pageName).toBe('My Shop');
        });

        it('should filter by replied status', async () => {
            const commentsList = [{ id: 'comment_1', replied: false }];
            vi.mocked(commentsService.getCommentsByWorkspace).mockResolvedValue(commentsList as any);

            const response = await app.inject({
                method: 'GET',
                url: '/comments?replied=false'
            });

            expect(response.statusCode).toBe(200);
            expect(commentsService.getCommentsByWorkspace).toHaveBeenCalledWith('test_workspace_id', { replied: false });
        });
    });

    describe('GET /comments/inbox', () => {
        it('should get unreplied comments', async () => {
            const inbox = [{ id: 'comment_1', replied: false }];
            vi.mocked(commentsService.getUnrepliedComments).mockResolvedValue(inbox as any);

            const response = await app.inject({
                method: 'GET',
                url: '/comments/inbox'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(inbox);
        });
    });

    describe('GET /comments/stats', () => {
        it('should get comment statistics', async () => {
            const stats = {
                total: 100,
                replied: 80,
                unreplied: 20,
                replyRate: '80.0',
                byMethod: { template: 50, ai: 25, manual: 5 }
            };
            vi.mocked(commentsService.getStats).mockResolvedValue(stats);

            const response = await app.inject({
                method: 'GET',
                url: '/comments/stats'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(stats);
        });
    });

    describe('GET /comments/:id', () => {
        it('should get a single comment', async () => {
            const comment = { id: 'comment_1', message: 'Great!' };
            vi.mocked(commentsService.getComment).mockResolvedValue(comment as any);

            const response = await app.inject({
                method: 'GET',
                url: '/comments/comment_1'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(comment);
        });

        it('should return 404 if comment not found', async () => {
            vi.mocked(commentsService.getComment).mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/comments/non_existent'
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('POST /comments/:id/reply', () => {
        it('should reply to a comment', async () => {
            const repliedComment = { id: 'comment_1', replied: true, replyText: 'Thank you!' };
            vi.mocked(commentsService.markAsReplied).mockResolvedValue(repliedComment as any);

            const response = await app.inject({
                method: 'POST',
                url: '/comments/comment_1/reply',
                payload: { replyText: 'Thank you!' }
            });

            expect(response.statusCode).toBe(200);
            expect(commentsService.markAsReplied).toHaveBeenCalledWith('comment_1', 'Thank you!', 'manual', undefined, undefined);
        });

        it('should return 400 if reply text is missing', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/comments/comment_1/reply',
                payload: {}
            });

            expect(response.statusCode).toBe(400);
        });
    });

    describe('DELETE /comments/:id', () => {
        it('should delete a comment', async () => {
            vi.mocked(commentsService.deleteComment).mockResolvedValue(undefined);

            const response = await app.inject({
                method: 'DELETE',
                url: '/comments/comment_1'
            });

            expect(response.statusCode).toBe(204);
            expect(commentsService.deleteComment).toHaveBeenCalledWith('comment_1');
        });
    });

    describe('POST /comments/:id/resolve', () => {
        it('should resolve a comment', async () => {
            vi.mocked(commentsService.resolveComment).mockResolvedValue({ id: 'comment_1', resolved: true } as any);

            const response = await app.inject({
                method: 'POST',
                url: '/comments/comment_1/resolve'
            });

            expect(response.statusCode).toBe(200);
            expect(commentsService.resolveComment).toHaveBeenCalledWith('comment_1');
            expect(JSON.parse(response.payload)).toEqual({ success: true });
        });

        it('should return 404 if comment not found', async () => {
            vi.mocked(commentsService.resolveComment).mockResolvedValue(undefined);

            const response = await app.inject({
                method: 'POST',
                url: '/comments/non_existent/resolve'
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('POST /comments/:id/unresolve', () => {
        it('should unresolve a comment', async () => {
            vi.mocked(commentsService.unresolveComment).mockResolvedValue({ id: 'comment_1', resolved: false } as any);

            const response = await app.inject({
                method: 'POST',
                url: '/comments/comment_1/unresolve'
            });

            expect(response.statusCode).toBe(200);
            expect(commentsService.unresolveComment).toHaveBeenCalledWith('comment_1');
            expect(JSON.parse(response.payload)).toEqual({ success: true });
        });

        it('should return 404 if comment not found', async () => {
            vi.mocked(commentsService.unresolveComment).mockResolvedValue(undefined);

            const response = await app.inject({
                method: 'POST',
                url: '/comments/non_existent/unresolve'
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('GET /comments with resolved filter', () => {
        it('should pass resolved=false to service', async () => {
            vi.mocked(commentsService.getCommentsByWorkspace).mockResolvedValue({ data: [], pagination: { hasMore: false, nextCursor: null, limit: 50 } } as any);

            const response = await app.inject({
                method: 'GET',
                url: '/comments?resolved=false'
            });

            expect(response.statusCode).toBe(200);
            expect(commentsService.getCommentsByWorkspace).toHaveBeenCalledWith('test_workspace_id', expect.objectContaining({ resolved: false }));
        });
    });
});

