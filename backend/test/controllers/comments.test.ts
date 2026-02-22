import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock dependencies before imports
vi.mock('../../src/services/comments', () => ({
    commentsService: {
        getCommentsByWorkspace: vi.fn(),
        getUnrepliedComments: vi.fn(),
        getCommentsByPost: vi.fn(),
        getComment: vi.fn(),
        updateComment: vi.fn(),
        markAsReplied: vi.fn(),
        getStats: vi.fn(),
        deleteComment: vi.fn(),
        logFeedback: vi.fn(),
        resolveComment: vi.fn(),
        unresolveComment: vi.fn(),
    },
}));

// Import controller AFTER mocks
import { commentsController } from '../../src/controllers/comments';
import { commentsService } from '../../src/services/comments';

describe('CommentsController', () => {
    let mockRequest: Partial<FastifyRequest>;
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
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
        };
    });

    // ─── getAll() ────────────────────────────────────────────────

    describe('getAll', () => {
        it('should return paginated comments with parsed query params', async () => {
            mockRequest.query = { cursor: 'c-10', limit: '25', replied: 'true', replyMethod: 'ai' };
            const mockResult = {
                data: [{ id: 'c-1', message: 'Hello' }],
                pagination: { hasMore: false, nextCursor: null, limit: 25 },
            };
            vi.mocked(commentsService.getCommentsByWorkspace).mockResolvedValue(mockResult);

            await commentsController.getAll(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(commentsService.getCommentsByWorkspace).toHaveBeenCalledWith('test_workspace_id', {
                cursor: 'c-10',
                limit: 25,
                replied: true,
                replyMethod: 'ai',
            });
            expect(mockReply.send).toHaveBeenCalledWith(mockResult);
        });

        it('should return 401 when workspace is not set', async () => {
            (mockRequest as any).workspaceId = undefined;

            await commentsController.getAll(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(401);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
        });

        it('should clamp limit to max 100', async () => {
            mockRequest.query = { limit: '999' };
            vi.mocked(commentsService.getCommentsByWorkspace).mockResolvedValue({ data: [], pagination: { hasMore: false, nextCursor: null, limit: 100 } });

            await commentsController.getAll(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(commentsService.getCommentsByWorkspace).toHaveBeenCalledWith('test_workspace_id', expect.objectContaining({ limit: 100 }));
        });
    });

    // ─── getInbox() ──────────────────────────────────────────────

    describe('getInbox', () => {
        it('should return unreplied comments', async () => {
            mockRequest.query = { limit: '20' };
            const mockComments = [{ id: 'c-1', replied: false }];
            vi.mocked(commentsService.getUnrepliedComments).mockResolvedValue(mockComments);

            await commentsController.getInbox(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(commentsService.getUnrepliedComments).toHaveBeenCalledWith('test_workspace_id', 20);
            expect(mockReply.send).toHaveBeenCalledWith(mockComments);
        });

        it('should return 401 when workspace is not set', async () => {
            (mockRequest as any).workspaceId = undefined;

            await commentsController.getInbox(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(401);
        });
    });

    // ─── getByPost() ─────────────────────────────────────────────

    describe('getByPost', () => {
        it('should return comments for a post', async () => {
            mockRequest.params = { postId: 'post-1' };
            const mockComments = [{ id: 'c-1', postId: 'post-1' }];
            vi.mocked(commentsService.getCommentsByPost).mockResolvedValue(mockComments);

            await commentsController.getByPost(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(commentsService.getCommentsByPost).toHaveBeenCalledWith('post-1');
            expect(mockReply.send).toHaveBeenCalledWith(mockComments);
        });

        it('should return 500 when service throws', async () => {
            mockRequest.params = { postId: 'post-bad' };
            vi.mocked(commentsService.getCommentsByPost).mockRejectedValue(new Error('DB error'));

            await commentsController.getByPost(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to fetch comments' });
        });
    });

    // ─── getOne() ────────────────────────────────────────────────

    describe('getOne', () => {
        it('should return a single comment', async () => {
            mockRequest.params = { id: 'c-42' };
            const mockComment = { id: 'c-42', message: 'Found it' };
            vi.mocked(commentsService.getComment).mockResolvedValue(mockComment);

            await commentsController.getOne(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(commentsService.getComment).toHaveBeenCalledWith('c-42');
            expect(mockReply.send).toHaveBeenCalledWith(mockComment);
        });

        it('should return 404 when comment not found', async () => {
            mockRequest.params = { id: 'missing' };
            vi.mocked(commentsService.getComment).mockResolvedValue(null);

            await commentsController.getOne(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Comment not found' });
        });
    });

    // ─── update() ────────────────────────────────────────────────

    describe('update', () => {
        it('should update and return the comment', async () => {
            mockRequest.params = { id: 'c-1' };
            mockRequest.body = { message: 'Updated text' };
            const updatedComment = { id: 'c-1', message: 'Updated text' };
            vi.mocked(commentsService.updateComment).mockResolvedValue(updatedComment);

            await commentsController.update(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(commentsService.updateComment).toHaveBeenCalledWith('c-1', { message: 'Updated text' });
            expect(mockReply.send).toHaveBeenCalledWith(updatedComment);
        });

        it('should return 404 when comment to update is not found', async () => {
            mockRequest.params = { id: 'missing' };
            mockRequest.body = { message: 'text' };
            vi.mocked(commentsService.updateComment).mockResolvedValue(undefined);

            await commentsController.update(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Comment not found' });
        });
    });

    // ─── reply() ─────────────────────────────────────────────────

    describe('reply', () => {
        it('should reply to a comment successfully', async () => {
            mockRequest.params = { id: 'c-1' };
            mockRequest.body = { replyText: 'Thanks for your feedback!', language: 'en' };
            const repliedComment = { id: 'c-1', replied: true, replyText: 'Thanks for your feedback!' };
            vi.mocked(commentsService.markAsReplied).mockResolvedValue(repliedComment);

            await commentsController.reply(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(commentsService.markAsReplied).toHaveBeenCalledWith('c-1', 'Thanks for your feedback!', 'manual', undefined, 'en');
            expect(mockReply.send).toHaveBeenCalledWith(repliedComment);
        });

        it('should return 400 when replyText is empty', async () => {
            mockRequest.params = { id: 'c-1' };
            mockRequest.body = { replyText: '' };

            await commentsController.reply(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Reply text is required' });
        });

        it('should return 400 when replyText is only whitespace', async () => {
            mockRequest.params = { id: 'c-1' };
            mockRequest.body = { replyText: '   ' };

            await commentsController.reply(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
        });
    });

    // ─── getStats() ──────────────────────────────────────────────

    describe('getStats', () => {
        it('should return comment statistics', async () => {
            const mockStats = { total: 100, replied: 80, unreplied: 17, needsAttention: 3, repliedToday: 5, replyRate: '80.0', byMethod: { template: 30, ai: 40, manual: 10 } };
            vi.mocked(commentsService.getStats).mockResolvedValue(mockStats);

            await commentsController.getStats(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(commentsService.getStats).toHaveBeenCalledWith('test_workspace_id');
            expect(mockReply.send).toHaveBeenCalledWith(mockStats);
        });

        it('should return 401 when workspace is not set', async () => {
            (mockRequest as any).workspaceId = undefined;

            await commentsController.getStats(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(401);
        });
    });

    // ─── delete() ────────────────────────────────────────────────

    describe('delete', () => {
        it('should delete comment and return 204', async () => {
            mockRequest.params = { id: 'c-99' };
            vi.mocked(commentsService.deleteComment).mockResolvedValue(undefined);

            await commentsController.delete(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(commentsService.deleteComment).toHaveBeenCalledWith('c-99');
            expect(mockReply.status).toHaveBeenCalledWith(204);
            expect(mockReply.send).toHaveBeenCalled();
        });
    });

    // ─── feedback() ──────────────────────────────────────────────

    describe('feedback', () => {
        it('should log feedback successfully', async () => {
            mockRequest.params = { id: 'c-1' };
            mockRequest.body = { helpful: true, reason: 'Spot on' };
            vi.mocked(commentsService.logFeedback).mockResolvedValue({ id: 'log-1' });

            await commentsController.feedback(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(commentsService.logFeedback).toHaveBeenCalledWith('c-1', 'user-123', true, 'Spot on');
            expect(mockReply.send).toHaveBeenCalledWith({ success: true, logId: 'log-1' });
        });

        it('should return 400 when helpful field is missing', async () => {
            mockRequest.params = { id: 'c-1' };
            mockRequest.body = { reason: 'no flag' };

            await commentsController.feedback(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Helpful status is required' });
        });

        it('should return 401 when user is not authenticated', async () => {
            mockRequest.user = undefined;
            mockRequest.params = { id: 'c-1' };
            mockRequest.body = { helpful: true };

            await commentsController.feedback(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(401);
        });
    });

    // ─── getAll with resolved filter ──────────────────────────────

    describe('getAll with resolved filter', () => {
        it('should pass resolved=false filter to service', async () => {
            mockRequest.query = { resolved: 'false' };
            vi.mocked(commentsService.getCommentsByWorkspace).mockResolvedValue({ data: [], pagination: { hasMore: false, nextCursor: null, limit: 50 } });

            await commentsController.getAll(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(commentsService.getCommentsByWorkspace).toHaveBeenCalledWith('test_workspace_id', expect.objectContaining({ resolved: false }));
        });

        it('should pass resolved=true filter to service', async () => {
            mockRequest.query = { resolved: 'true' };
            vi.mocked(commentsService.getCommentsByWorkspace).mockResolvedValue({ data: [], pagination: { hasMore: false, nextCursor: null, limit: 50 } });

            await commentsController.getAll(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(commentsService.getCommentsByWorkspace).toHaveBeenCalledWith('test_workspace_id', expect.objectContaining({ resolved: true }));
        });
    });

    // ─── resolve() ────────────────────────────────────────────────

    describe('resolve', () => {
        it('should resolve a comment and return success', async () => {
            mockRequest.params = { id: 'c-1' };
            vi.mocked(commentsService.resolveComment).mockResolvedValue({ id: 'c-1', resolved: true } as any);

            await commentsController.resolve(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(commentsService.resolveComment).toHaveBeenCalledWith('c-1');
            expect(mockReply.send).toHaveBeenCalledWith({ success: true });
        });

        it('should return 404 when comment not found', async () => {
            mockRequest.params = { id: 'missing' };
            vi.mocked(commentsService.resolveComment).mockResolvedValue(undefined);

            await commentsController.resolve(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Comment not found' });
        });

        it('should return 401 when workspace is not set', async () => {
            (mockRequest as any).workspaceId = undefined;
            mockRequest.params = { id: 'c-1' };

            await commentsController.resolve(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(401);
        });

        it('should return 500 when service throws', async () => {
            mockRequest.params = { id: 'c-1' };
            vi.mocked(commentsService.resolveComment).mockRejectedValue(new Error('DB error'));

            await commentsController.resolve(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to resolve comment' });
        });
    });

    // ─── unresolve() ──────────────────────────────────────────────

    describe('unresolve', () => {
        it('should unresolve a comment and return success', async () => {
            mockRequest.params = { id: 'c-1' };
            vi.mocked(commentsService.unresolveComment).mockResolvedValue({ id: 'c-1', resolved: false } as any);

            await commentsController.unresolve(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(commentsService.unresolveComment).toHaveBeenCalledWith('c-1');
            expect(mockReply.send).toHaveBeenCalledWith({ success: true });
        });

        it('should return 404 when comment not found', async () => {
            mockRequest.params = { id: 'missing' };
            vi.mocked(commentsService.unresolveComment).mockResolvedValue(undefined);

            await commentsController.unresolve(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Comment not found' });
        });

        it('should return 401 when workspace is not set', async () => {
            (mockRequest as any).workspaceId = undefined;
            mockRequest.params = { id: 'c-1' };

            await commentsController.unresolve(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(401);
        });
    });
});
