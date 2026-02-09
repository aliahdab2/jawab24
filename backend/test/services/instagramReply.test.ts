import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        update: vi.fn(),
        insert: vi.fn(),
        transaction: vi.fn(async (fn: Function) => fn({
            update: vi.fn().mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
                    }),
                }),
            }),
            insert: vi.fn().mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
                }),
            }),
        })),
    },
}));

vi.mock('../../src/db/schema', () => ({
    instagramMedia: { id: 'id', instagramMediaId: 'instagramMediaId' },
    instagramComments: { id: 'id', instagramCommentId: 'instagramCommentId' },
    messages: { id: 'id', instagramMessageId: 'instagramMessageId', pageId: 'pageId', senderId: 'senderId', platform: 'platform', createdTime: 'createdTime', direction: 'direction', facebookMessageId: 'facebookMessageId', message: 'message' },
}));

vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPageByInstagramId: vi.fn(),
    },
}));

vi.mock('../../src/services/reply/generator', () => ({
    replyGenerator: {
        generateForComment: vi.fn(),
        generateForMessage: vi.fn(),
        setLogger: vi.fn(),
    },
    shouldSkipReply: vi.fn().mockReturnValue(false),
    shouldUseFallback: vi.fn().mockReturnValue(false),
    SKIP_REPLY_FLAGS: ['offensive_or_abusive', 'offensive'],
    SAFE_FALLBACK_FLAGS: ['price_not_in_kb'],
    SKIP_REPLY_INTENTS: ['OFFENSIVE'],
    PRICE_FALLBACK: { ar: 'شكراً لاهتمامك!', en: 'Thank you for your interest!' },
}));

vi.mock('../../src/services/protection/rate-limiter', () => ({
    rateLimiter: {
        check: vi.fn(),
        setLogger: vi.fn(),
    },
}));

vi.mock('../../src/services/protection', () => ({
    rateLimiter: {
        check: vi.fn(),
        setLogger: vi.fn(),
    },
}));

vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/utils/language', () => ({
    detectLanguageCode: vi.fn().mockReturnValue('en'),
}));

vi.mock('../../src/services/settings', () => ({
    settingsService: {
        isCommentsAutoReplyEnabled: vi.fn(),
        isMessagesAutoReplyEnabled: vi.fn(),
        getReplyDelay: vi.fn(),
        getSettings: vi.fn(),
        getAwayMessage: vi.fn(),
    },
}));

vi.mock('../../src/services/instagram', () => ({
    instagramService: {
        replyToComment: vi.fn(),
        sendDirectMessage: vi.fn(),
    },
}));

vi.mock('../../src/services/messages', () => ({
    messagesService: {
        isPaused: vi.fn(),
        hasNewerUnrepliedMessage: vi.fn(),
        storeOutgoingMessage: vi.fn(),
        getUnrepliedFromSender: vi.fn(),
        markOlderMessagesAsReplied: vi.fn(),
        markAsReplied: vi.fn(),
        flagMessage: vi.fn(),
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((...args: unknown[]) => args),
    and: vi.fn((...args: unknown[]) => args),
    desc: vi.fn((col: unknown) => col),
    sql: vi.fn().mockReturnValue('sql-mock'),
}));

import { InstagramReplyService } from '../../src/services/instagramReply';
import { pagesService } from '../../src/services/pages';
import { replyGenerator, shouldSkipReply, shouldUseFallback } from '../../src/services/reply/generator';
import { rateLimiter } from '../../src/services/protection';
import { settingsService } from '../../src/services/settings';
import { instagramService } from '../../src/services/instagram';
import { messagesService } from '../../src/services/messages';
import { notificationService } from '../../src/services/notifications';
import { db } from '../../src/db';
import { pipelineMetrics } from '../../src/lib/pipelineMetrics';

describe('InstagramReplyService', () => {
    let service: InstagramReplyService;

    const mockPage = {
        id: 'page-uuid',
        userId: 'user-uuid',
        name: 'Test Page',
        accessToken: 'page-token',
        instagramAutoReplyEnabled: true,
        instagramAccountId: 'ig-1',
        knowledgeBase: 'Some KB',
    };

    function setupDbForComment(opts: {
        existingMedia?: any;
        existingComment?: any;
        mediaAutoReply?: boolean;
    } = {}) {
        const { existingMedia, existingComment, mediaAutoReply = true } = opts;

        const mockFrom = vi.fn();
        const mockWhere = vi.fn();
        const mockSet = vi.fn();
        const mockValues = vi.fn();
        const mockReturning = vi.fn();

        let selectCallCount = 0;
        mockFrom.mockImplementation(() => {
            selectCallCount++;
            return { where: mockWhere };
        });

        mockWhere.mockImplementation(() => {
            if (selectCallCount <= 1) {
                return Promise.resolve(existingMedia ? [existingMedia] : []);
            }
            if (selectCallCount === 2) {
                return Promise.resolve(existingComment ? [existingComment] : []);
            }
            if (selectCallCount === 3) {
                return Promise.resolve([existingMedia || { id: 'media-uuid', autoReplyEnabled: mediaAutoReply, caption: 'test' }]);
            }
            return Promise.resolve(existingComment ? [existingComment] : []);
        });

        mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
        mockValues.mockReturnValue({
            returning: mockReturning.mockResolvedValue([{
                id: 'new-record-id',
                autoReplyEnabled: mediaAutoReply,
                replied: false,
                caption: 'Test caption',
            }]),
        });

        vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);
        vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);
        vi.mocked(db.insert).mockReturnValue({ values: mockValues } as any);
    }

    function setupDbForMessage(opts: { existingMessage?: any } = {}) {
        const { existingMessage } = opts;

        const mockSet = vi.fn();
        const mockFrom = vi.fn().mockImplementation(() => {
            return {
                where: vi.fn().mockResolvedValue(
                    existingMessage ? [existingMessage] : [],
                ),
            };
        });

        mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
        const mockValues = vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([existingMessage || {
                id: 'msg-uuid',
                replied: false,
            }]),
        });

        vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);
        vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);
        vi.mocked(db.insert).mockReturnValue({ values: mockValues } as any);
    }

    beforeEach(() => {
        vi.clearAllMocks();
        pipelineMetrics.reset();
        service = new InstagramReplyService();

        // Default happy-path mocks
        vi.mocked(pagesService.getPageByInstagramId).mockResolvedValue(mockPage as any);
        vi.mocked(settingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
        vi.mocked(settingsService.isMessagesAutoReplyEnabled).mockResolvedValue(true);
        vi.mocked(settingsService.getReplyDelay).mockResolvedValue(0);
        vi.mocked(settingsService.getSettings).mockResolvedValue({ aiEnabled: true } as any);
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'AI generated reply',
            replyMethod: 'ai' as const,
            needsAttention: false,
        });
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'AI generated reply',
            replyMethod: 'ai' as const,
            needsAttention: false,
        });
        vi.mocked(rateLimiter.check).mockResolvedValue({ allowed: true, count: 1 });
        vi.mocked(instagramService.replyToComment).mockResolvedValue('reply-id');
        vi.mocked(instagramService.sendDirectMessage).mockResolvedValue('msg-id');
        vi.mocked(settingsService.getAwayMessage).mockResolvedValue(null);
        vi.mocked(messagesService.isPaused).mockResolvedValue(false);
        vi.mocked(messagesService.hasNewerUnrepliedMessage).mockResolvedValue(false);
        vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({} as any);
        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([{ id: 'msg-uuid', message: 'hello' }]);
        vi.mocked(messagesService.markOlderMessagesAsReplied).mockResolvedValue(0);
        vi.mocked(messagesService.markAsReplied).mockResolvedValue(undefined);
        vi.mocked(messagesService.flagMessage).mockResolvedValue(undefined);
    });

    describe('setLogger', () => {
        it('should accept a logger', () => {
            const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() };
            expect(() => service.setLogger(logger as any)).not.toThrow();
        });
    });

    describe('processComment', () => {
        it('should return error when page is not found', async () => {
            vi.mocked(pagesService.getPageByInstagramId).mockResolvedValue(null);

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result).toEqual({
                success: false,
                commentId: 'comment-1',
                error: 'Page not found',
            });
            expect(pipelineMetrics.getMetrics().counters['instagram_comment.page_not_found']).toBe(1);
        });

        it('should return error when Instagram auto-reply is disabled', async () => {
            vi.mocked(pagesService.getPageByInstagramId).mockResolvedValue({
                ...mockPage,
                instagramAutoReplyEnabled: false,
            } as any);

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result).toEqual({
                success: false,
                commentId: 'comment-1',
                error: 'Auto-reply disabled for this page',
            });
            expect(pipelineMetrics.getMetrics().counters['instagram_comment.auto_reply_disabled']).toBe(1);
        });

        it('should return error when page has no userId', async () => {
            vi.mocked(pagesService.getPageByInstagramId).mockResolvedValue({
                ...mockPage,
                userId: null,
            } as any);

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result).toEqual({
                success: false,
                commentId: 'comment-1',
                error: 'Page has no associated user',
            });
        });

        it('should return error when comments auto-reply is disabled', async () => {
            vi.mocked(settingsService.isCommentsAutoReplyEnabled).mockResolvedValue(false);
            setupDbForComment();

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Comments auto-reply disabled');
            expect(pipelineMetrics.getMetrics().counters['instagram_comment.settings_disabled']).toBe(1);
        });

        it('should return error when Instagram reply posting fails', async () => {
            vi.mocked(instagramService.replyToComment).mockRejectedValue(new Error('API error'));
            setupDbForComment();

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Failed to post reply to Instagram: API error');
        });

        it('should catch and return unexpected errors', async () => {
            vi.mocked(pagesService.getPageByInstagramId).mockRejectedValue(new Error('DB connection lost'));

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result.success).toBe(false);
            expect(result.error).toBe('DB connection lost');
        });
    });

    describe('processMessage', () => {
        it('should return error when page is not found', async () => {
            vi.mocked(pagesService.getPageByInstagramId).mockResolvedValue(null);

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result).toEqual({
                success: false,
                messageId: 'msg-1',
                error: 'Page not found',
            });
        });

        it('should return error when Instagram auto-reply is disabled', async () => {
            vi.mocked(pagesService.getPageByInstagramId).mockResolvedValue({
                ...mockPage,
                instagramAutoReplyEnabled: false,
            } as any);

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toContain('Auto-reply disabled');
        });

        it('should return error when page has no userId', async () => {
            vi.mocked(pagesService.getPageByInstagramId).mockResolvedValue({
                ...mockPage,
                userId: null,
            } as any);

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Page has no associated user');
        });

        it('should send away message when auto-reply disabled and away message configured', async () => {
            vi.mocked(settingsService.isMessagesAutoReplyEnabled).mockResolvedValue(false);
            vi.mocked(settingsService.getAwayMessage).mockResolvedValue('We are currently away');
            setupDbForMessage();

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(instagramService.sendDirectMessage).toHaveBeenCalledWith(
                'ig-1', 'sender-1', 'We are currently away', mockPage.accessToken,
            );
            expect(result.success).toBe(false);
            expect(result.error).toBe('Messages auto-reply disabled');
        });

        it('should not fail if away message sending fails', async () => {
            vi.mocked(settingsService.isMessagesAutoReplyEnabled).mockResolvedValue(false);
            vi.mocked(settingsService.getAwayMessage).mockResolvedValue('Away');
            vi.mocked(instagramService.sendDirectMessage).mockRejectedValue(new Error('blocked'));
            setupDbForMessage();

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Messages auto-reply disabled');
        });

        it('should return error when message already replied', async () => {
            setupDbForMessage({ existingMessage: { id: 'msg-uuid', replied: true } });

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Message already replied');
        });

        it('should return error when DM sending fails', async () => {
            vi.mocked(instagramService.sendDirectMessage).mockRejectedValue(new Error('Cannot DM'));
            setupDbForMessage();

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to send reply');
        });

        it('should catch and return unexpected errors', async () => {
            vi.mocked(pagesService.getPageByInstagramId).mockRejectedValue(new Error('timeout'));

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('timeout');
        });

        it('should skip reply when AI is disabled and no template matches', async () => {
            vi.mocked(settingsService.getSettings).mockResolvedValue({ aiEnabled: false } as any);
            vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
                replyText: null,
                replyMethod: 'ai' as const,
                needsAttention: false,
            });
            setupDbForMessage();

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('No reply generated');
            expect(replyGenerator.generateForMessage).toHaveBeenCalledWith(
                expect.objectContaining({ userId: 'user-uuid', text: 'hello' }),
                false,
            );
        });

        it('should process message successfully through shared pipeline', async () => {
            setupDbForMessage();

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(true);
            expect(result.replyText).toBe('AI generated reply');
            expect(result.replyMethod).toBe('ai');
            expect(messagesService.markAsReplied).toHaveBeenCalled();
            expect(messagesService.storeOutgoingMessage).toHaveBeenCalled();
        });

        it('should skip when newer message is pending (debounce)', async () => {
            vi.mocked(messagesService.hasNewerUnrepliedMessage).mockResolvedValue(true);
            setupDbForMessage();

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toContain('newer message pending');
        });

        it('should skip when handoff is active', async () => {
            vi.mocked(messagesService.isPaused).mockResolvedValue(true);
            setupDbForMessage();

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Handoff active');
        });

        it('should skip when rate limited', async () => {
            vi.mocked(rateLimiter.check).mockResolvedValue({ allowed: false, count: 11 });
            setupDbForMessage();

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Rate limited');
        });

        it('should skip reply for offensive message and flag without replying', async () => {
            vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
                replyText: 'Some reply',
                replyMethod: 'ai',
                needsAttention: true,
                flagReason: 'offensive_or_abusive',
                aiIntent: 'OFFENSIVE',
            });
            vi.mocked(shouldSkipReply).mockReturnValue(true);
            setupDbForMessage();

            const result = await service.processMessage('ig-1', 'sender-1', 'offensive text', 'msg-1');

            expect(result.success).toBe(true);
            // Reply should NOT be sent
            expect(instagramService.sendDirectMessage).not.toHaveBeenCalled();
            // Message should be flagged (not marked as replied)
            expect(messagesService.flagMessage).toHaveBeenCalledWith(
                'msg-uuid', 'offensive_or_abusive', 'OFFENSIVE',
            );
            expect(messagesService.markAsReplied).not.toHaveBeenCalled();
            // Notification should be skipped_reply
            expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith(
                'user-uuid',
                'skipped_reply',
                expect.objectContaining({ reason: 'offensive_or_abusive' }),
                expect.objectContaining({ type: 'message' }),
            );
            expect(pipelineMetrics.getMetrics().counters['instagram_message.skipped_risky']).toBe(1);

            // Reset mock
            vi.mocked(shouldSkipReply).mockReturnValue(false);
        });

        it('should replace AI text with safe fallback for price_not_in_kb in messages', async () => {
            vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
                replyText: 'The price is $99!',
                replyMethod: 'ai',
                needsAttention: true,
                flagReason: 'price_not_in_kb',
                aiIntent: 'PURCHASE_INTENT',
            });
            vi.mocked(shouldUseFallback).mockReturnValue(true);
            setupDbForMessage();

            const result = await service.processMessage('ig-1', 'sender-1', 'How much?', 'msg-1');

            expect(result.success).toBe(true);
            // Reply IS sent but with fallback text
            expect(instagramService.sendDirectMessage).toHaveBeenCalledWith(
                'ig-1', 'sender-1',
                expect.stringContaining('Thank you for your interest'),
                mockPage.accessToken,
            );
            expect(messagesService.flagMessage).not.toHaveBeenCalled();
            expect(messagesService.markAsReplied).toHaveBeenCalled();

            // Reset mock
            vi.mocked(shouldUseFallback).mockReturnValue(false);
        });

        it('should skip already-flagged messages on duplicate webhook', async () => {
            setupDbForMessage({
                existingMessage: { id: 'msg-uuid', replied: false, needsAttention: true },
            });

            const result = await service.processMessage('ig-1', 'sender-1', 'offensive', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Message already replied');
            expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
        });
    });
});
