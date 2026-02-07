import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        update: vi.fn(),
        insert: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    instagramMedia: { id: 'id', instagramMediaId: 'instagramMediaId' },
    instagramComments: { id: 'id', instagramCommentId: 'instagramCommentId' },
    messages: { id: 'id', instagramMessageId: 'instagramMessageId', pageId: 'pageId', senderId: 'senderId', platform: 'platform', createdTime: 'createdTime', direction: 'direction' },
}));

vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPageByInstagramId: vi.fn(),
    },
}));

vi.mock('../../src/services/ai', () => ({
    aiService: {
        generateReply: vi.fn(),
    },
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

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((...args: unknown[]) => args),
    and: vi.fn((...args: unknown[]) => args),
    desc: vi.fn((col: unknown) => col),
}));

import { InstagramReplyService } from '../../src/services/instagramReply';
import { pagesService } from '../../src/services/pages';
import { aiService } from '../../src/services/ai';
import { settingsService } from '../../src/services/settings';
import { instagramService } from '../../src/services/instagram';
import { db } from '../../src/db';

describe('InstagramReplyService', () => {
    let service: InstagramReplyService;

    const mockPage = {
        id: 'page-uuid',
        userId: 'user-uuid',
        name: 'Test Page',
        accessToken: 'page-token',
        instagramAutoReplyEnabled: true,
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
            // Calls: 1=findOrCreateMedia(storeComment), 2=storeComment check,
            // 3=findOrCreateMedia(processComment), 4=check existing comment
            if (selectCallCount <= 1) {
                // findOrCreateMedia in storeComment
                return Promise.resolve(existingMedia ? [existingMedia] : []);
            }
            if (selectCallCount === 2) {
                // storeComment existing check
                return Promise.resolve(existingComment ? [existingComment] : []);
            }
            if (selectCallCount === 3) {
                // findOrCreateMedia in processComment
                return Promise.resolve([existingMedia || { id: 'media-uuid', autoReplyEnabled: mediaAutoReply, caption: 'test' }]);
            }
            // check existing comment in processComment
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

        let selectCallCount = 0;
        const mockFrom = vi.fn().mockImplementation(() => {
            selectCallCount++;
            const currentCall = selectCallCount;

            const whereResult = {
                then: (resolve: any) => resolve(currentCall === 1
                    ? (existingMessage ? [existingMessage] : [])
                    : []),
                orderBy: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([]),
                }),
            };

            return { where: vi.fn().mockReturnValue(whereResult) };
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
        service = new InstagramReplyService();

        // Default happy-path mocks
        vi.mocked(pagesService.getPageByInstagramId).mockResolvedValue(mockPage as any);
        vi.mocked(settingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
        vi.mocked(settingsService.isMessagesAutoReplyEnabled).mockResolvedValue(true);
        vi.mocked(settingsService.getReplyDelay).mockResolvedValue(0);
        vi.mocked(settingsService.getSettings).mockResolvedValue({ aiEnabled: true } as any);
        vi.mocked(aiService.generateReply).mockResolvedValue({ reply: 'AI generated reply' } as any);
        vi.mocked(instagramService.replyToComment).mockResolvedValue('reply-id');
        vi.mocked(instagramService.sendDirectMessage).mockResolvedValue('msg-id');
        vi.mocked(settingsService.getAwayMessage).mockResolvedValue(null);
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
                error: 'Instagram auto-reply disabled for this page',
            });
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
        });

        it('should return error when Instagram reply posting fails', async () => {
            vi.mocked(instagramService.replyToComment).mockRejectedValue(new Error('API error'));
            setupDbForComment();

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Failed to post reply to Instagram');
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
            expect(result.error).toBe('Instagram auto-reply disabled for this page');
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

        it('should skip reply when AI is disabled', async () => {
            vi.mocked(settingsService.getSettings).mockResolvedValue({ aiEnabled: false } as any);
            setupDbForMessage();

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('No reply generated');
            expect(aiService.generateReply).not.toHaveBeenCalled();
        });
    });
});
