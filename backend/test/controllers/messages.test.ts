import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock dependencies before imports
vi.mock('../../src/services/messages', () => ({
    messagesService: {
        getMessages: vi.fn(),
        getStats: vi.fn(),
        getConversation: vi.fn(),
        getMessageById: vi.fn(),
        markAsReplied: vi.fn(),
        storeOutgoingMessage: vi.fn(),
        pauseConversation: vi.fn(),
        resumeConversation: vi.fn(),
        getPauseStatus: vi.fn(),
        resolveConversation: vi.fn(),
        unresolveConversation: vi.fn(),
    },
}));

vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPage: vi.fn(),
    },
}));

vi.mock('../../src/services/facebook', () => ({
    facebookService: { sendPrivateMessage: vi.fn() },
}));
vi.mock('../../src/services/instagram', () => ({
    instagramService: { sendDirectMessage: vi.fn() },
}));
vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: { getSettings: vi.fn() },
}));

const mockPromoteDelayedJobs = vi.fn().mockResolvedValue(0);
vi.mock('../../src/lib/replyQueue', () => ({
    promoteDelayedJobs: (...args: any[]) => mockPromoteDelayedJobs(...args),
}));

// Import controller AFTER mocks
import { messagesController } from '../../src/controllers/messages';
import { messagesService } from '../../src/services/messages';
import { pagesService } from '../../src/services/pages';
import { facebookService } from '../../src/services/facebook';
import { instagramService } from '../../src/services/instagram';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';

describe('MessagesController', () => {
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
            code: vi.fn().mockReturnThis(),
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

    // ─── getAll ────────────────────────────────────────────

    describe('getAll', () => {
        it('should return paginated messages on success', async () => {
            const result = {
                data: [{ id: 'msg-1', message: 'hello' }],
                pagination: { hasMore: false, nextCursor: null, limit: 50 },
            };
            vi.mocked(messagesService.getMessages).mockResolvedValue(result);
            (mockRequest as any).query = { cursor: 'cur-1', limit: '20' };

            await messagesController.getAll(mockRequest as any, mockReply as any);

            expect(messagesService.getMessages).toHaveBeenCalledWith('test_workspace_id', {
                cursor: 'cur-1',
                limit: 20,
            });
            expect(mockReply.send).toHaveBeenCalledWith(result);
        });

        it('should parse direction filter "incoming"', async () => {
            vi.mocked(messagesService.getMessages).mockResolvedValue({
                data: [],
                pagination: { hasMore: false, nextCursor: null, limit: 50 },
            });
            (mockRequest as any).query = { direction: 'incoming' };

            await messagesController.getAll(mockRequest as any, mockReply as any);

            expect(messagesService.getMessages).toHaveBeenCalledWith('test_workspace_id', {
                direction: 'incoming',
            });
        });

        it('should parse direction filter "outgoing"', async () => {
            vi.mocked(messagesService.getMessages).mockResolvedValue({
                data: [],
                pagination: { hasMore: false, nextCursor: null, limit: 50 },
            });
            (mockRequest as any).query = { direction: 'outgoing' };

            await messagesController.getAll(mockRequest as any, mockReply as any);

            expect(messagesService.getMessages).toHaveBeenCalledWith('test_workspace_id', {
                direction: 'outgoing',
            });
        });

        it('should use default options when no query params provided', async () => {
            vi.mocked(messagesService.getMessages).mockResolvedValue({
                data: [],
                pagination: { hasMore: false, nextCursor: null, limit: 50 },
            });
            (mockRequest as any).query = {};

            await messagesController.getAll(mockRequest as any, mockReply as any);

            expect(messagesService.getMessages).toHaveBeenCalledWith('test_workspace_id', {});
        });

        it('should pass actionRequired=true filter to service', async () => {
            vi.mocked(messagesService.getMessages).mockResolvedValue({
                data: [],
                pagination: { hasMore: false, nextCursor: null, limit: 50 },
            });
            (mockRequest as any).query = { actionRequired: 'true' };

            await messagesController.getAll(mockRequest as any, mockReply as any);

            expect(messagesService.getMessages).toHaveBeenCalledWith('test_workspace_id', expect.objectContaining({ actionRequired: true }));
        });

        it('should clamp limit to max 100', async () => {
            vi.mocked(messagesService.getMessages).mockResolvedValue({
                data: [],
                pagination: { hasMore: false, nextCursor: null, limit: 100 },
            });
            (mockRequest as any).query = { limit: '999' };

            await messagesController.getAll(mockRequest as any, mockReply as any);

            expect(messagesService.getMessages).toHaveBeenCalledWith('test_workspace_id', {
                limit: 100,
            });
        });

        it('should return 500 on service failure', async () => {
            vi.mocked(messagesService.getMessages).mockRejectedValue(new Error('DB down'));

            await messagesController.getAll(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to get messages' });
        });
    });

    // ─── getStats ──────────────────────────────────────────

    describe('getStats', () => {
        it('should return stats on success', async () => {
            const stats = {
                total: 100,
                replied: 80,
                pending: 15,
                needsAttention: 5,
                byMethod: { template: 40, ai: 30, manual: 10 },
            };
            vi.mocked(messagesService.getStats).mockResolvedValue(stats);

            await messagesController.getStats(mockRequest as any, mockReply as any);

            expect(messagesService.getStats).toHaveBeenCalledWith('test_workspace_id');
            expect(mockReply.send).toHaveBeenCalledWith(stats);
        });

        it('should return 500 on service failure', async () => {
            vi.mocked(messagesService.getStats).mockRejectedValue(new Error('DB down'));

            await messagesController.getStats(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to get message stats' });
        });
    });

    // ─── getConversation ───────────────────────────────────

    describe('getConversation', () => {
        it('should return conversation messages on success', async () => {
            const messages = [{ id: 'msg-1', message: 'hi' }];
            vi.mocked(messagesService.getConversation).mockResolvedValue(messages as any);
            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).query = { pageId: 'page-1', limit: '25' };

            await messagesController.getConversation(mockRequest as any, mockReply as any);

            expect(messagesService.getConversation).toHaveBeenCalledWith('page-1', 'sender-1', 25);
            expect(mockReply.send).toHaveBeenCalledWith(messages);
        });

        it('should return 400 when pageId is missing', async () => {
            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).query = {};

            await messagesController.getConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'pageId is required' });
            expect(messagesService.getConversation).not.toHaveBeenCalled();
        });

        it('should return 500 on service failure', async () => {
            vi.mocked(messagesService.getConversation).mockRejectedValue(new Error('fail'));
            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).query = { pageId: 'page-1' };

            await messagesController.getConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to get conversation' });
        });
    });

    // ─── resumeConversation ──────────────────────────────

    describe('resumeConversation', () => {
        beforeEach(() => {
            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).body = { pageId: 'page-ext-1' };
        });

        it('should resume conversation and promote delayed jobs', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({
                id: 'page-internal-uuid',
                name: 'Test Page',
            } as any);
            vi.mocked(messagesService.resumeConversation).mockResolvedValue(undefined as any);
            mockPromoteDelayedJobs.mockResolvedValue(2);

            await messagesController.resumeConversation(mockRequest as any, mockReply as any);

            expect(messagesService.resumeConversation).toHaveBeenCalledWith('page-ext-1', 'sender-1');
            // Must use internal UUID (page.id), not the external pageId from body
            expect(mockPromoteDelayedJobs).toHaveBeenCalledWith('page-internal-uuid', 'sender-1');
            expect(mockReply.send).toHaveBeenCalledWith({ success: true, promotedJobs: 2 });
        });

        it('should return 400 when pageId is missing', async () => {
            (mockRequest as any).body = {};

            await messagesController.resumeConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(messagesService.resumeConversation).not.toHaveBeenCalled();
            expect(mockPromoteDelayedJobs).not.toHaveBeenCalled();
        });

        it('should return 403 when page is not owned by user', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);

            await messagesController.resumeConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(messagesService.resumeConversation).not.toHaveBeenCalled();
            expect(mockPromoteDelayedJobs).not.toHaveBeenCalled();
        });

        it('should still succeed when promoteDelayedJobs fails', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({
                id: 'page-internal-uuid',
                name: 'Test Page',
            } as any);
            vi.mocked(messagesService.resumeConversation).mockResolvedValue(undefined as any);
            mockPromoteDelayedJobs.mockRejectedValue(new Error('Redis down'));

            await messagesController.resumeConversation(mockRequest as any, mockReply as any);

            // Resume succeeds even though promote failed
            expect(mockReply.send).toHaveBeenCalledWith({ success: true, promotedJobs: 0 });
            expect((mockRequest as any).log.warn).toHaveBeenCalled();
        });

        it('should return 500 when resumeConversation service fails', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({
                id: 'page-internal-uuid',
                name: 'Test Page',
            } as any);
            vi.mocked(messagesService.resumeConversation).mockRejectedValue(new Error('DB down'));

            await messagesController.resumeConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockPromoteDelayedJobs).not.toHaveBeenCalled();
        });
    });

    // ─── reply ──────────────────────────────────────────────

    describe('reply', () => {
        const mockPage = { id: 'page-uuid', accessToken: 'token-123', instagramAccountId: null };
        const mockMessage = { id: 'msg-1', pageId: 'page-uuid', senderId: 'sender-1', platform: 'facebook' };

        beforeEach(() => {
            (mockRequest as any).params = { id: 'msg-1' };
            (mockRequest as any).body = { replyText: 'Thank you!' };
        });

        it('should send reply via Facebook and store outgoing message', async () => {
            vi.mocked(messagesService.getMessageById).mockResolvedValue(mockMessage as any);
            vi.mocked(pagesService.getPage).mockResolvedValue(mockPage as any);
            vi.mocked(facebookService.sendPrivateMessage).mockResolvedValue(undefined as any);
            vi.mocked(messagesService.markAsReplied).mockResolvedValue(undefined as any);
            const outgoing = { id: 'out-1', message: 'Thank you!' };
            vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue(outgoing as any);

            await messagesController.reply(mockRequest as any, mockReply as any);

            expect(facebookService.sendPrivateMessage).toHaveBeenCalledWith('token-123', 'sender-1', 'Thank you!');
            expect(messagesService.markAsReplied).toHaveBeenCalledWith('msg-1', 'Thank you!', 'manual');
            expect(mockReply.send).toHaveBeenCalledWith(outgoing);
        });

        it('should send reply via Instagram when platform is instagram', async () => {
            const igMessage = { ...mockMessage, platform: 'instagram' };
            const igPage = { ...mockPage, instagramAccountId: 'ig-123' };
            vi.mocked(messagesService.getMessageById).mockResolvedValue(igMessage as any);
            vi.mocked(pagesService.getPage).mockResolvedValue(igPage as any);
            vi.mocked(instagramService.sendDirectMessage).mockResolvedValue(undefined as any);
            vi.mocked(messagesService.markAsReplied).mockResolvedValue(undefined as any);
            vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({ id: 'out-1' } as any);

            await messagesController.reply(mockRequest as any, mockReply as any);

            expect(instagramService.sendDirectMessage).toHaveBeenCalledWith('ig-123', 'sender-1', 'Thank you!', 'token-123');
        });

        it('should return 400 when replyText is empty', async () => {
            (mockRequest as any).body = { replyText: '  ' };

            await messagesController.reply(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
        });

        it('should return 404 when message not found', async () => {
            vi.mocked(messagesService.getMessageById).mockResolvedValue(null as any);

            await messagesController.reply(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(404);
        });

        it('should return 403 when page not owned by workspace', async () => {
            vi.mocked(messagesService.getMessageById).mockResolvedValue(mockMessage as any);
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);

            await messagesController.reply(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(403);
        });

        it('should return 401 when no workspaceId', async () => {
            (mockRequest as any).workspaceId = undefined;

            await messagesController.reply(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(401);
        });

        it('should return 500 on service failure', async () => {
            vi.mocked(messagesService.getMessageById).mockRejectedValue(new Error('fail'));

            await messagesController.reply(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
        });
    });

    // ─── pauseConversation ──────────────────────────────────

    describe('pauseConversation', () => {
        beforeEach(() => {
            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).body = { pageId: 'page-1', durationMinutes: 30 };
        });

        it('should pause conversation with provided duration', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-uuid' } as any);
            const pauseResult = { pausedUntil: new Date() };
            vi.mocked(messagesService.pauseConversation).mockResolvedValue(pauseResult as any);

            await messagesController.pauseConversation(mockRequest as any, mockReply as any);

            expect(messagesService.pauseConversation).toHaveBeenCalledWith('page-1', 'sender-1', 30);
            expect(mockReply.send).toHaveBeenCalledWith({ success: true, pausedUntil: pauseResult.pausedUntil });
        });

        it('should use default duration from settings when not provided', async () => {
            (mockRequest as any).body = { pageId: 'page-1' };
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-uuid' } as any);
            vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({ handoffPauseDurationMinutes: 60 } as any);
            vi.mocked(messagesService.pauseConversation).mockResolvedValue({ pausedUntil: new Date() } as any);

            await messagesController.pauseConversation(mockRequest as any, mockReply as any);

            expect(workspaceSettingsService.getSettings).toHaveBeenCalledWith('test_workspace_id');
            expect(messagesService.pauseConversation).toHaveBeenCalledWith('page-1', 'sender-1', 60);
        });

        it('should return 400 when pageId is missing', async () => {
            (mockRequest as any).body = {};

            await messagesController.pauseConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
        });

        it('should return 403 when page not owned by workspace', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);

            await messagesController.pauseConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(403);
        });

        it('should return 401 when no user or workspaceId', async () => {
            (mockRequest as any).user = undefined;
            (mockRequest as any).workspaceId = undefined;

            await messagesController.pauseConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(401);
        });

        it('should return 500 on service failure', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-uuid' } as any);
            vi.mocked(messagesService.pauseConversation).mockRejectedValue(new Error('fail'));

            await messagesController.pauseConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
        });
    });

    // ─── getPauseStatus ──────────────────────────────────────

    describe('getPauseStatus', () => {
        beforeEach(() => {
            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).query = { pageId: 'page-1' };
        });

        it('should return pause status', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-uuid' } as any);
            const status = { paused: true, pausedUntil: new Date() };
            vi.mocked(messagesService.getPauseStatus).mockResolvedValue(status as any);

            await messagesController.getPauseStatus(mockRequest as any, mockReply as any);

            expect(mockReply.send).toHaveBeenCalledWith(status);
        });

        it('should return 400 when pageId is missing', async () => {
            (mockRequest as any).query = {};

            await messagesController.getPauseStatus(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
        });

        it('should return 403 when page not owned', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);

            await messagesController.getPauseStatus(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(403);
        });

        it('should return 500 on service failure', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-uuid' } as any);
            vi.mocked(messagesService.getPauseStatus).mockRejectedValue(new Error('fail'));

            await messagesController.getPauseStatus(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
        });
    });

    // ─── resolveConversation ────────────────────────────────

    describe('resolveConversation', () => {
        beforeEach(() => {
            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).body = { pageId: 'page-1' };
        });

        it('should resolve conversation', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-uuid' } as any);
            vi.mocked(messagesService.resolveConversation).mockResolvedValue(5);

            await messagesController.resolveConversation(mockRequest as any, mockReply as any);

            expect(mockReply.send).toHaveBeenCalledWith({ success: true, resolved: 5 });
        });

        it('should return 400 when pageId missing', async () => {
            (mockRequest as any).body = {};

            await messagesController.resolveConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
        });

        it('should return 403 when page not owned', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);

            await messagesController.resolveConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(403);
        });

        it('should return 500 on failure', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-uuid' } as any);
            vi.mocked(messagesService.resolveConversation).mockRejectedValue(new Error('fail'));

            await messagesController.resolveConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
        });
    });

    // ─── unresolveConversation ──────────────────────────────

    describe('unresolveConversation', () => {
        beforeEach(() => {
            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).body = { pageId: 'page-1' };
        });

        it('should unresolve conversation', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-uuid' } as any);
            vi.mocked(messagesService.unresolveConversation).mockResolvedValue(3);

            await messagesController.unresolveConversation(mockRequest as any, mockReply as any);

            expect(mockReply.send).toHaveBeenCalledWith({ success: true, unresolved: 3 });
        });

        it('should return 400 when pageId missing', async () => {
            (mockRequest as any).body = {};

            await messagesController.unresolveConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
        });

        it('should return 403 when page not owned', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);

            await messagesController.unresolveConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(403);
        });

        it('should return 500 on failure', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-uuid' } as any);
            vi.mocked(messagesService.unresolveConversation).mockRejectedValue(new Error('fail'));

            await messagesController.unresolveConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
        });
    });
});
