import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock dependencies before imports
vi.mock('../../src/services/messages', () => ({
    messagesService: {
        getMessages: vi.fn(),
        getStats: vi.fn(),
        getConversation: vi.fn(),
        pauseConversation: vi.fn(),
        resumeConversation: vi.fn(),
        getPauseStatus: vi.fn(),
    },
}));
vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPage: vi.fn(),
    },
}));
vi.mock('../../src/services/settings', () => ({
    settingsService: {
        getSettings: vi.fn(),
    },
}));
vi.mock('../../src/services/facebook', () => ({
    facebookService: {},
}));
vi.mock('../../src/services/instagram', () => ({
    instagramService: {},
}));

// Import controller AFTER mocks
import { messagesController } from '../../src/controllers/messages';
import { messagesService } from '../../src/services/messages';
import { pagesService } from '../../src/services/pages';
import { settingsService } from '../../src/services/settings';

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

            expect(messagesService.getMessages).toHaveBeenCalledWith('user-123', {
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

            expect(messagesService.getMessages).toHaveBeenCalledWith('user-123', {
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

            expect(messagesService.getMessages).toHaveBeenCalledWith('user-123', {
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

            expect(messagesService.getMessages).toHaveBeenCalledWith('user-123', {});
        });

        it('should clamp limit to max 100', async () => {
            vi.mocked(messagesService.getMessages).mockResolvedValue({
                data: [],
                pagination: { hasMore: false, nextCursor: null, limit: 100 },
            });
            (mockRequest as any).query = { limit: '999' };

            await messagesController.getAll(mockRequest as any, mockReply as any);

            expect(messagesService.getMessages).toHaveBeenCalledWith('user-123', {
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

            expect(messagesService.getStats).toHaveBeenCalledWith('user-123');
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

    // ─── pauseConversation ───────────────────────────────────

    describe('pauseConversation', () => {
        it('should pause conversation with default duration from settings', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-internal', userId: 'user-123' } as any);
            vi.mocked(settingsService.getSettings).mockResolvedValue({ handoffPauseDurationMinutes: 45 } as any);
            vi.mocked(messagesService.pauseConversation).mockResolvedValue({
                pausedUntil: new Date('2026-02-07T12:45:00Z'),
            });

            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).body = { pageId: 'page-1' };

            await messagesController.pauseConversation(mockRequest as any, mockReply as any);

            expect(pagesService.getPage).toHaveBeenCalledWith('user-123', 'page-1');
            expect(settingsService.getSettings).toHaveBeenCalledWith('user-123');
            expect(messagesService.pauseConversation).toHaveBeenCalledWith('page-internal', 'sender-1', 45);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ pausedUntil: expect.any(Date) }));
        });

        it('should allow custom durationMinutes override', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-internal', userId: 'user-123' } as any);
            vi.mocked(messagesService.pauseConversation).mockResolvedValue({
                pausedUntil: new Date('2026-02-07T14:00:00Z'),
            });

            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).body = { pageId: 'page-1', durationMinutes: 120 };

            await messagesController.pauseConversation(mockRequest as any, mockReply as any);

            // Should NOT call settingsService.getSettings when custom duration is provided
            expect(messagesService.pauseConversation).toHaveBeenCalledWith('page-internal', 'sender-1', 120);
        });

        it('should return 400 when pageId is missing', async () => {
            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).body = {};

            await messagesController.pauseConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'pageId is required' });
        });

        it('should return 403 when page is not owned by user', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null);

            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).body = { pageId: 'other-page' };

            await messagesController.pauseConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized: page not owned by user' });
        });
    });

    // ─── resumeConversation ──────────────────────────────────

    describe('resumeConversation', () => {
        it('should resume conversation and return success', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-internal', userId: 'user-123' } as any);
            vi.mocked(messagesService.resumeConversation).mockResolvedValue(undefined);

            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).body = { pageId: 'page-1' };

            await messagesController.resumeConversation(mockRequest as any, mockReply as any);

            expect(messagesService.resumeConversation).toHaveBeenCalledWith('page-internal', 'sender-1');
            expect(mockReply.send).toHaveBeenCalledWith({ success: true });
        });

        it('should return 400 when pageId is missing', async () => {
            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).body = {};

            await messagesController.resumeConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
        });

        it('should return 403 when page not owned by user', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null);

            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).body = { pageId: 'page-1' };

            await messagesController.resumeConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(403);
        });
    });

    // ─── getPauseStatus ──────────────────────────────────────

    describe('getPauseStatus', () => {
        it('should return pause status', async () => {
            vi.mocked(messagesService.getPauseStatus).mockResolvedValue({
                paused: true,
                pausedUntil: new Date('2026-02-07T12:30:00Z'),
                remainingMinutes: 20,
            });

            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).query = { pageId: 'page-1' };

            await messagesController.getPauseStatus(mockRequest as any, mockReply as any);

            expect(messagesService.getPauseStatus).toHaveBeenCalledWith('page-1', 'sender-1');
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ paused: true, remainingMinutes: 20 }));
        });

        it('should return 400 when pageId is missing', async () => {
            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).query = {};

            await messagesController.getPauseStatus(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'pageId is required' });
        });
    });
});
