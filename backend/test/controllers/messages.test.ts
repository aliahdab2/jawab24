import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { DmSendError } from '../../src/utils/fbGraphErrors';
import { AppError } from '../../src/utils/errors';

// Mock dependencies before imports
vi.mock('../../src/services/messages', () => ({
    messagesService: {
        getMessages: vi.fn(),
        getStats: vi.fn(),
        getConversation: vi.fn(),
        getMessageById: vi.fn(),
        markAsReplied: vi.fn(),
        storeOutgoingMessage: vi.fn(),
        findOutgoingByClientMessageId: vi.fn(),
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
    isPageDisconnected: (page: { accessToken: string } | null | undefined) =>
        !!page && page.accessToken === '',
}));

vi.mock('../../src/services/conversations', () => ({
    conversationsService: {
        findByPageAndSender: vi.fn(),
    },
}));

vi.mock('../../src/services/facebook', () => ({
    facebookService: { sendPrivateMessage: vi.fn() },
}));
vi.mock('../../src/services/instagram', () => ({
    instagramService: { sendDirectMessage: vi.fn() },
}));
vi.mock('../../src/services/whatsapp', () => ({
    whatsappService: { sendTextMessage: vi.fn() },
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
import { conversationsService } from '../../src/services/conversations';
import { facebookService } from '../../src/services/facebook';
import { instagramService } from '../../src/services/instagram';
import { pageLinkedInstagramCredential } from '../../src/services/instagramCredential';
import { whatsappService } from '../../src/services/whatsapp';
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

        it('should forward pageId filter to service', async () => {
            vi.mocked(messagesService.getMessages).mockResolvedValue({
                data: [],
                pagination: { hasMore: false, nextCursor: null, limit: 50 },
            });
            (mockRequest as any).query = { pageId: 'page_42' };

            await messagesController.getAll(mockRequest as any, mockReply as any);

            expect(messagesService.getMessages).toHaveBeenCalledWith('test_workspace_id', expect.objectContaining({ pageId: 'page_42' }));
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

            expect(messagesService.getStats).toHaveBeenCalledWith('test_workspace_id', undefined);
            expect(mockReply.send).toHaveBeenCalledWith(stats);
        });

        it('should forward pageId filter to service so chip counts match the list', async () => {
            mockRequest.query = { pageId: 'page_77' };
            const stats = { total: 5, replied: 3, pending: 2, needsAttention: 0, byMethod: { template: 0, ai: 3, manual: 0 } };
            vi.mocked(messagesService.getStats).mockResolvedValue(stats);

            await messagesController.getStats(mockRequest as any, mockReply as any);

            expect(messagesService.getStats).toHaveBeenCalledWith('test_workspace_id', { pageId: 'page_77' });
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
        beforeEach(() => {
            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).query = { pageId: 'page-1', limit: '25' };
        });

        it('should return conversation messages on success', async () => {
            const messages = [{ id: 'msg-1', message: 'hi' }];
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-uuid' } as any);
            vi.mocked(messagesService.getConversation).mockResolvedValue(messages as any);

            await messagesController.getConversation(mockRequest as any, mockReply as any);

            expect(pagesService.getPage).toHaveBeenCalledWith('test_workspace_id', 'page-1');
            expect(messagesService.getConversation).toHaveBeenCalledWith('page-1', 'sender-1', 25);
            expect(mockReply.send).toHaveBeenCalledWith(messages);
        });

        it('should return 401 when no workspaceId', async () => {
            (mockRequest as any).workspaceId = undefined;

            await messagesController.getConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(401);
            expect(pagesService.getPage).not.toHaveBeenCalled();
            expect(messagesService.getConversation).not.toHaveBeenCalled();
        });

        it('should return 403 when page is not owned by workspace', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);

            await messagesController.getConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized: page not owned by workspace' });
            expect(messagesService.getConversation).not.toHaveBeenCalled();
        });

        it('should return 400 when pageId is missing', async () => {
            (mockRequest as any).query = {};

            await messagesController.getConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'pageId is required' });
            expect(messagesService.getConversation).not.toHaveBeenCalled();
        });

        it('should return 500 on service failure', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-uuid' } as any);
            vi.mocked(messagesService.getConversation).mockRejectedValue(new Error('fail'));

            await messagesController.getConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to get conversation' });
        });
    });

    // ─── locateMessage ───────────────────────────────────

    describe('locateMessage', () => {
        beforeEach(() => {
            (mockRequest as any).params = { messageId: 'msg-1' };
        });

        it('should return senderId and pageId for an owned message', async () => {
            vi.mocked(messagesService.getMessageById).mockResolvedValue({
                id: 'msg-1',
                senderId: 'sender-1',
                pageId: 'page-1',
            } as any);
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-1' } as any);

            await messagesController.locateMessage(mockRequest as any, mockReply as any);

            expect(pagesService.getPage).toHaveBeenCalledWith('test_workspace_id', 'page-1');
            expect(mockReply.send).toHaveBeenCalledWith({ senderId: 'sender-1', pageId: 'page-1' });
        });

        it('should return 401 when no workspaceId', async () => {
            (mockRequest as any).workspaceId = undefined;

            await messagesController.locateMessage(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(401);
            expect(messagesService.getMessageById).not.toHaveBeenCalled();
        });

        it('should return 404 when message does not exist', async () => {
            vi.mocked(messagesService.getMessageById).mockResolvedValue(null);

            await messagesController.locateMessage(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Message not found' });
            expect(pagesService.getPage).not.toHaveBeenCalled();
        });

        it('should return 403 when page is not owned by workspace', async () => {
            vi.mocked(messagesService.getMessageById).mockResolvedValue({
                id: 'msg-1',
                senderId: 'sender-1',
                pageId: 'page-other',
            } as any);
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);

            await messagesController.locateMessage(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized: page not owned by workspace' });
        });

        it('should return 500 on service failure', async () => {
            vi.mocked(messagesService.getMessageById).mockRejectedValue(new Error('db down'));

            await messagesController.locateMessage(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to locate message' });
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
            vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({ handoffPauseDurationMinutes: 15 } as any);
            vi.mocked(messagesService.resumeConversation).mockResolvedValue(undefined as any);
            mockPromoteDelayedJobs.mockResolvedValue(2);

            await messagesController.resumeConversation(mockRequest as any, mockReply as any);

            // pauseMinutes is forwarded so the Redis resume marker TTL matches
            // the workspace's window — protects the override behavior.
            expect(messagesService.resumeConversation).toHaveBeenCalledWith('page-ext-1', 'sender-1', 15);
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
            vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({ handoffPauseDurationMinutes: 15 } as any);
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

            expect(instagramService.sendDirectMessage).toHaveBeenCalledWith('ig-123', 'sender-1', 'Thank you!', pageLinkedInstagramCredential('token-123'));
        });

        it('should send reply via WhatsApp with the WABA token (never the FB path)', async () => {
            const waMessage = { ...mockMessage, platform: 'whatsapp', senderId: '+966500000000' };
            // WhatsApp-only page: FB token is the '' disconnect sentinel — must not block WhatsApp
            const waPage = { ...mockPage, accessToken: '', whatsappPhoneNumberId: 'pn-1', whatsappAccessToken: 'wa-token' };
            vi.mocked(messagesService.getMessageById).mockResolvedValue(waMessage as any);
            vi.mocked(pagesService.getPage).mockResolvedValue(waPage as any);
            vi.mocked(whatsappService.sendTextMessage).mockResolvedValue('wamid.out' as any);
            vi.mocked(messagesService.markAsReplied).mockResolvedValue(undefined as any);
            vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({ id: 'out-1' } as any);

            await messagesController.reply(mockRequest as any, mockReply as any);

            expect(whatsappService.sendTextMessage).toHaveBeenCalledWith('pn-1', '+966500000000', 'Thank you!', 'wa-token');
            expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
        });

        it('should 409 WHATSAPP_DISCONNECTED when the WhatsApp token is missing', async () => {
            const waMessage = { ...mockMessage, platform: 'whatsapp' };
            const waPage = { ...mockPage, whatsappPhoneNumberId: 'pn-1', whatsappAccessToken: null };
            vi.mocked(messagesService.getMessageById).mockResolvedValue(waMessage as any);
            vi.mocked(pagesService.getPage).mockResolvedValue(waPage as any);

            await expect(messagesController.reply(mockRequest as any, mockReply as any))
                .rejects.toMatchObject({ statusCode: 409, code: 'WHATSAPP_DISCONNECTED' });
            expect(whatsappService.sendTextMessage).not.toHaveBeenCalled();
        });

        it('should map the 24h-window Meta error to DM_WINDOW_EXPIRED', async () => {
            const waMessage = { ...mockMessage, platform: 'whatsapp' };
            const waPage = { ...mockPage, whatsappPhoneNumberId: 'pn-1', whatsappAccessToken: 'wa-token' };
            vi.mocked(messagesService.getMessageById).mockResolvedValue(waMessage as any);
            vi.mocked(pagesService.getPage).mockResolvedValue(waPage as any);
            vi.mocked(whatsappService.sendTextMessage).mockRejectedValue({
                response: { data: { error: { code: 131047, message: 'Re-engagement message' } } },
            });

            await expect(messagesController.reply(mockRequest as any, mockReply as any))
                .rejects.toMatchObject({ statusCode: 409, code: 'DM_WINDOW_EXPIRED' });
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

        it('propagates unexpected service failures to the global error handler (no silent 500)', async () => {
            // Regression: the controller used to catch-and-return-500, hiding the cause from Sentry.
            // Now it must let unknown errors propagate so the global errorHandler captures them.
            const boom = new Error('db exploded');
            vi.mocked(messagesService.getMessageById).mockRejectedValue(boom);

            await expect(messagesController.reply(mockRequest as any, mockReply as any)).rejects.toBe(boom);
            expect(mockReply.status).not.toHaveBeenCalledWith(500);
        });

        describe('Graph API error classification', () => {
            beforeEach(() => {
                vi.mocked(messagesService.getMessageById).mockResolvedValue(mockMessage as any);
                vi.mocked(pagesService.getPage).mockResolvedValue(mockPage as any);
            });

            const cases: Array<{
                name: string;
                error: DmSendError;
                expectedStatus: number;
                expectedCode: string;
            }> = [
                {
                    name: 'window expired → 409 DM_WINDOW_EXPIRED',
                    error: new DmSendError('outside 24h window', { code: 10, subcode: 2018278 }),
                    expectedStatus: 409,
                    expectedCode: 'DM_WINDOW_EXPIRED',
                },
                {
                    name: 'customer unavailable → 409 DM_CUSTOMER_UNAVAILABLE',
                    error: new DmSendError("This person isn't available", { code: 551 }),
                    expectedStatus: 409,
                    expectedCode: 'DM_CUSTOMER_UNAVAILABLE',
                },
                {
                    name: 'transient rate limit → 503 DM_TRANSIENT',
                    error: new DmSendError('rate limited', { code: 613 }),
                    expectedStatus: 503,
                    expectedCode: 'DM_TRANSIENT',
                },
                {
                    name: 'expired token → 409 DM_PLATFORM_AUTH',
                    error: new DmSendError('token invalid', { code: 190 }),
                    expectedStatus: 409,
                    expectedCode: 'DM_PLATFORM_AUTH',
                },
                {
                    name: 'unknown Graph error → 502 DM_UNKNOWN',
                    error: new DmSendError('something new', { code: 99999 }),
                    expectedStatus: 502,
                    expectedCode: 'DM_UNKNOWN',
                },
            ];

            for (const { name, error, expectedStatus, expectedCode } of cases) {
                it(`maps ${name}`, async () => {
                    vi.mocked(facebookService.sendPrivateMessage).mockRejectedValue(error);

                    let thrown: unknown;
                    try {
                        await messagesController.reply(mockRequest as any, mockReply as any);
                    } catch (e) {
                        thrown = e;
                    }

                    expect(thrown).toBeInstanceOf(AppError);
                    expect((thrown as AppError).statusCode).toBe(expectedStatus);
                    expect((thrown as AppError).code).toBe(expectedCode);
                    // Must not have been marked as replied or stored — the send failed.
                    expect(messagesService.markAsReplied).not.toHaveBeenCalled();
                    expect(messagesService.storeOutgoingMessage).not.toHaveBeenCalled();
                });
            }

            it('rejects with PAGE_DISCONNECTED 409 when page.accessToken is the empty-string sentinel', async () => {
                // Empty accessToken is the disconnect sentinel set by pages sync / tokenRefresh
                // when Facebook revokes the page. Merchant must reconnect — frontend prompts on 409.
                vi.mocked(pagesService.getPage).mockResolvedValue({ ...mockPage, accessToken: '' } as any);

                let thrown: unknown;
                try {
                    await messagesController.reply(mockRequest as any, mockReply as any);
                } catch (e) {
                    thrown = e;
                }

                expect(thrown).toBeInstanceOf(AppError);
                expect((thrown as AppError).statusCode).toBe(409);
                expect((thrown as AppError).code).toBe('PAGE_DISCONNECTED');
                // Facebook must not be called — we caught the disconnected sentinel before the request
                expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
                expect(messagesService.markAsReplied).not.toHaveBeenCalled();
            });

            it('routes Instagram DmSendError through the same classifier', async () => {
                const igMessage = { ...mockMessage, platform: 'instagram' };
                const igPage = { ...mockPage, instagramAccountId: 'ig-123' };
                vi.mocked(messagesService.getMessageById).mockResolvedValue(igMessage as any);
                vi.mocked(pagesService.getPage).mockResolvedValue(igPage as any);
                vi.mocked(instagramService.sendDirectMessage).mockRejectedValue(
                    new DmSendError('outside 24h window', { code: 10, subcode: 2018278 }),
                );

                let thrown: unknown;
                try {
                    await messagesController.reply(mockRequest as any, mockReply as any);
                } catch (e) {
                    thrown = e;
                }

                expect((thrown as AppError).code).toBe('DM_WINDOW_EXPIRED');
            });
        });

        describe('idempotency (clientMessageId)', () => {
            const validKey = 'b1f0e6e2-9c4f-4d3a-9e2b-3d2f5a6e7b8c';

            it('returns the stored outgoing row and skips FB when the same clientMessageId was already processed', async () => {
                // Bad-network retry case: the previous attempt actually reached FB and persisted,
                // but the response didn't make it back to the phone — the client retried with the
                // same UUID. Backend must not double-send to FB.
                const stored = { id: 'out-prev', message: 'Thank you!' };
                vi.mocked(messagesService.getMessageById).mockResolvedValue(mockMessage as any);
                vi.mocked(pagesService.getPage).mockResolvedValue(mockPage as any);
                vi.mocked(messagesService.findOutgoingByClientMessageId).mockResolvedValue(stored as any);
                (mockRequest as any).body = { replyText: 'Thank you!', clientMessageId: validKey };

                await messagesController.reply(mockRequest as any, mockReply as any);

                expect(messagesService.findOutgoingByClientMessageId).toHaveBeenCalledWith('page-uuid', validKey);
                expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
                expect(instagramService.sendDirectMessage).not.toHaveBeenCalled();
                expect(messagesService.markAsReplied).not.toHaveBeenCalled();
                expect(messagesService.storeOutgoingMessage).not.toHaveBeenCalled();
                expect(mockReply.send).toHaveBeenCalledWith(stored);
            });

            it('forwards clientMessageId to storeOutgoingMessage on a fresh send', async () => {
                vi.mocked(messagesService.getMessageById).mockResolvedValue(mockMessage as any);
                vi.mocked(pagesService.getPage).mockResolvedValue(mockPage as any);
                vi.mocked(messagesService.findOutgoingByClientMessageId).mockResolvedValue(null);
                vi.mocked(facebookService.sendPrivateMessage).mockResolvedValue(undefined as any);
                vi.mocked(messagesService.markAsReplied).mockResolvedValue(undefined as any);
                vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({ id: 'out-1' } as any);
                (mockRequest as any).body = { replyText: 'Hello', clientMessageId: validKey };

                await messagesController.reply(mockRequest as any, mockReply as any);

                expect(facebookService.sendPrivateMessage).toHaveBeenCalled();
                // clientMessageId is the 9th positional arg. (It stopped being the LAST
                // one when platformMessageId was appended for WhatsApp Coexistence, so
                // index by position rather than from the end.)
                const args = vi.mocked(messagesService.storeOutgoingMessage).mock.calls[0];
                expect(args[8]).toBe(validKey);
            });

            it('rejects an oversized clientMessageId with 400 (would otherwise blow the unique index)', async () => {
                (mockRequest as any).body = {
                    replyText: 'Hello',
                    clientMessageId: 'x'.repeat(65),
                };

                await messagesController.reply(mockRequest as any, mockReply as any);

                expect(mockReply.status).toHaveBeenCalledWith(400);
                expect(messagesService.getMessageById).not.toHaveBeenCalled();
            });

            it('does not consult the dedupe path when no clientMessageId is supplied (legacy clients)', async () => {
                vi.mocked(messagesService.getMessageById).mockResolvedValue(mockMessage as any);
                vi.mocked(pagesService.getPage).mockResolvedValue(mockPage as any);
                vi.mocked(facebookService.sendPrivateMessage).mockResolvedValue(undefined as any);
                vi.mocked(messagesService.markAsReplied).mockResolvedValue(undefined as any);
                vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({ id: 'out-1' } as any);
                (mockRequest as any).body = { replyText: 'Hello' };

                await messagesController.reply(mockRequest as any, mockReply as any);

                expect(messagesService.findOutgoingByClientMessageId).not.toHaveBeenCalled();
                expect(facebookService.sendPrivateMessage).toHaveBeenCalled();
            });
        });
    });

    // ─── replyToConversation ────────────────────────────────
    //
    // Send a manual DM without an incoming message anchor. Required for dual-mode
    // comment replies where the customer never DM'd: our DB has only an outgoing row,
    // so /messages/:id/reply has nothing to target. Tenant safety is the conversations
    // row instead of the message row.

    describe('replyToConversation', () => {
        const mockPage = { id: 'page-uuid', accessToken: 'token-123', instagramAccountId: null };
        const mockConversationFb = { id: 'conv-1', pageId: 'page-uuid', senderId: 'sender-1', platform: 'facebook' };
        const mockOutgoing = { id: 'out-1', message: 'Hello' };

        beforeEach(() => {
            (mockRequest as any).params = { senderId: 'sender-1' };
            (mockRequest as any).body = { pageId: 'page-uuid', replyText: 'Hello' };
        });

        it('sends via Facebook and stores outgoing message', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(mockPage as any);
            vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue(mockConversationFb as any);
            vi.mocked(facebookService.sendPrivateMessage).mockResolvedValue(undefined as any);
            vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue(mockOutgoing as any);

            await messagesController.replyToConversation(mockRequest as any, mockReply as any);

            expect(facebookService.sendPrivateMessage).toHaveBeenCalledWith('token-123', 'sender-1', 'Hello');
            expect(messagesService.storeOutgoingMessage).toHaveBeenCalledWith(
                'page-uuid', 'test_workspace_id', 'sender-1', 'Hello', 'manual',
                // …flagMeta, then platformMessageId — undefined on Facebook, which
                // surfaces no per-message id (see facebookAdapter.sendReply).
                undefined, undefined, undefined, undefined, undefined, undefined,
            );
            // No incoming message to mark — markAsReplied must not be called.
            expect(messagesService.markAsReplied).not.toHaveBeenCalled();
            expect(mockReply.send).toHaveBeenCalledWith(mockOutgoing);
        });

        it('sends via Instagram when conversation platform is instagram', async () => {
            const igPage = { ...mockPage, instagramAccountId: 'ig-acc-1' };
            const igConv = { ...mockConversationFb, platform: 'instagram' };
            vi.mocked(pagesService.getPage).mockResolvedValue(igPage as any);
            vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue(igConv as any);
            vi.mocked(instagramService.sendDirectMessage).mockResolvedValue(undefined as any);
            vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue(mockOutgoing as any);

            await messagesController.replyToConversation(mockRequest as any, mockReply as any);

            expect(instagramService.sendDirectMessage).toHaveBeenCalledWith('ig-acc-1', 'sender-1', 'Hello', pageLinkedInstagramCredential('token-123'));
            expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
        });

        it('returns 400 when pageId is missing', async () => {
            (mockRequest as any).body = { replyText: 'Hello' };

            await messagesController.replyToConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
        });

        it('returns 400 when replyText is empty', async () => {
            (mockRequest as any).body = { pageId: 'page-uuid', replyText: '   ' };

            await messagesController.replyToConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
        });

        it('returns 400 on invalid clientMessageId', async () => {
            (mockRequest as any).body = { pageId: 'page-uuid', replyText: 'Hello', clientMessageId: 'x'.repeat(65) };

            await messagesController.replyToConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
        });

        it('returns 401 when no workspaceId on request', async () => {
            (mockRequest as any).workspaceId = undefined;

            await messagesController.replyToConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(401);
        });

        it('returns 403 when workspace does not own the page', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);

            await messagesController.replyToConversation(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(403);
            // Tenant safety: must not hit the conversation lookup or Graph API.
            expect(conversationsService.findByPageAndSender).not.toHaveBeenCalled();
            expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
        });

        it('throws 404 CONVERSATION_NOT_FOUND when no prior conversation exists', async () => {
            // Tenant safety boundary: without a conversation row, the endpoint would let
            // a merchant DM any FB user from any page they happen to own. The row proves
            // prior legitimate contact on this page.
            vi.mocked(pagesService.getPage).mockResolvedValue(mockPage as any);
            vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue(null as any);

            let thrown: unknown;
            try {
                await messagesController.replyToConversation(mockRequest as any, mockReply as any);
            } catch (e) {
                thrown = e;
            }

            expect(thrown).toBeInstanceOf(AppError);
            expect((thrown as AppError).statusCode).toBe(404);
            expect((thrown as AppError).code).toBe('CONVERSATION_NOT_FOUND');
            expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
            expect(messagesService.storeOutgoingMessage).not.toHaveBeenCalled();
        });

        it('throws 409 PAGE_DISCONNECTED when accessToken is the empty-string sentinel', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ ...mockPage, accessToken: '' } as any);
            vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue(mockConversationFb as any);

            let thrown: unknown;
            try {
                await messagesController.replyToConversation(mockRequest as any, mockReply as any);
            } catch (e) {
                thrown = e;
            }

            expect(thrown).toBeInstanceOf(AppError);
            expect((thrown as AppError).statusCode).toBe(409);
            expect((thrown as AppError).code).toBe('PAGE_DISCONNECTED');
            expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
        });

        it('dedupes via clientMessageId — returns stored outgoing without re-hitting Graph', async () => {
            (mockRequest as any).body = { pageId: 'page-uuid', replyText: 'Hello', clientMessageId: 'cmid-1' };
            const stored = { id: 'out-stored', message: 'Hello' };
            vi.mocked(pagesService.getPage).mockResolvedValue(mockPage as any);
            vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue(mockConversationFb as any);
            vi.mocked(messagesService.findOutgoingByClientMessageId).mockResolvedValue(stored as any);

            await messagesController.replyToConversation(mockRequest as any, mockReply as any);

            expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
            expect(messagesService.storeOutgoingMessage).not.toHaveBeenCalled();
            expect(mockReply.send).toHaveBeenCalledWith(stored);
        });

        it('maps DmSendError window_expired to 409 DM_WINDOW_EXPIRED', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(mockPage as any);
            vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue(mockConversationFb as any);
            vi.mocked(facebookService.sendPrivateMessage).mockRejectedValue(
                new DmSendError('outside 24h window', { code: 10, subcode: 2018278 })
            );

            let thrown: unknown;
            try {
                await messagesController.replyToConversation(mockRequest as any, mockReply as any);
            } catch (e) {
                thrown = e;
            }

            expect(thrown).toBeInstanceOf(AppError);
            expect((thrown as AppError).statusCode).toBe(409);
            expect((thrown as AppError).code).toBe('DM_WINDOW_EXPIRED');
            // Failed send must not be persisted.
            expect(messagesService.storeOutgoingMessage).not.toHaveBeenCalled();
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
            vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({ handoffPauseDurationMinutes: 15 } as any);
        });

        it('should return pause status', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-uuid' } as any);
            const status = { paused: true, pausedUntil: new Date() };
            vi.mocked(messagesService.getPauseStatus).mockResolvedValue(status as any);

            await messagesController.getPauseStatus(mockRequest as any, mockReply as any);

            expect(mockReply.send).toHaveBeenCalledWith(status);
        });

        it('passes the merchant handoff window to the service', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-uuid' } as any);
            vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({ handoffPauseDurationMinutes: 60 } as any);
            vi.mocked(messagesService.getPauseStatus).mockResolvedValue({ paused: false } as any);

            await messagesController.getPauseStatus(mockRequest as any, mockReply as any);

            expect(messagesService.getPauseStatus).toHaveBeenCalledWith('page-1', 'sender-1', 60);
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
