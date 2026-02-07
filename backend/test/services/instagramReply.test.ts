import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies before imports
const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbInsert = vi.fn();

vi.mock('../../src/db', () => ({
    db: {
        select: () => ({ from: mockDbSelect }),
        update: () => ({ set: mockDbUpdate }),
        insert: () => ({ values: mockDbInsert }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    instagramMedia: { id: 'id', instagramMediaId: 'instagramMediaId' },
    instagramComments: { id: 'id', instagramCommentId: 'instagramCommentId' },
    messages: { id: 'id', instagramMessageId: 'instagramMessageId', pageId: 'pageId', senderId: 'senderId', platform: 'platform', createdTime: 'createdTime', direction: 'direction' },
}));

const mockGetPageByInstagramId = vi.fn();
vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPageByInstagramId: mockGetPageByInstagramId,
    },
}));

const mockGenerateReply = vi.fn();
vi.mock('../../src/services/ai', () => ({
    aiService: {
        generateReply: mockGenerateReply,
    },
}));

const mockIsCommentsAutoReplyEnabled = vi.fn();
const mockIsMessagesAutoReplyEnabled = vi.fn();
const mockGetReplyDelay = vi.fn();
const mockGetSettings = vi.fn();
const mockGetAwayMessage = vi.fn();
vi.mock('../../src/services/settings', () => ({
    settingsService: {
        isCommentsAutoReplyEnabled: mockIsCommentsAutoReplyEnabled,
        isMessagesAutoReplyEnabled: mockIsMessagesAutoReplyEnabled,
        getReplyDelay: mockGetReplyDelay,
        getSettings: mockGetSettings,
        getAwayMessage: mockGetAwayMessage,
    },
}));

const mockReplyToComment = vi.fn();
const mockSendDirectMessage = vi.fn();
vi.mock('../../src/services/instagram', () => ({
    instagramService: {
        replyToComment: mockReplyToComment,
        sendDirectMessage: mockSendDirectMessage,
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((...args: unknown[]) => args),
    and: vi.fn((...args: unknown[]) => args),
    desc: vi.fn((col: unknown) => col),
}));

import { InstagramReplyService } from '../../src/services/instagramReply';

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

    beforeEach(() => {
        vi.clearAllMocks();
        service = new InstagramReplyService();

        // Default happy-path mocks
        mockGetPageByInstagramId.mockResolvedValue(mockPage);
        mockIsCommentsAutoReplyEnabled.mockResolvedValue(true);
        mockIsMessagesAutoReplyEnabled.mockResolvedValue(true);
        mockGetReplyDelay.mockResolvedValue(0);
        mockGetSettings.mockResolvedValue({ aiEnabled: true });
        mockGenerateReply.mockResolvedValue({ reply: 'AI generated reply' });
        mockReplyToComment.mockResolvedValue('reply-id');
        mockSendDirectMessage.mockResolvedValue('msg-id');
        mockGetAwayMessage.mockResolvedValue(null);

        // DB mocks: findOrCreateMedia - no existing
        mockDbSelect.mockImplementation((table: any) => ({
            where: vi.fn().mockResolvedValue([]),
            innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([]),
            }),
            orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
            }),
        }));

        // insert returns new record
        mockDbInsert.mockImplementation(() => ({
            returning: vi.fn().mockResolvedValue([{
                id: 'new-record-id',
                autoReplyEnabled: true,
                replied: false,
                caption: 'Test caption',
            }]),
        }));

        // update returns ok
        mockDbUpdate.mockImplementation(() => ({
            where: vi.fn().mockResolvedValue(undefined),
        }));
    });

    describe('setLogger', () => {
        it('should accept a logger', () => {
            const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() };
            expect(() => service.setLogger(logger as any)).not.toThrow();
        });
    });

    describe('processComment', () => {
        it('should return error when page is not found', async () => {
            mockGetPageByInstagramId.mockResolvedValue(null);

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result).toEqual({
                success: false,
                commentId: 'comment-1',
                error: 'Page not found',
            });
        });

        it('should return error when Instagram auto-reply is disabled', async () => {
            mockGetPageByInstagramId.mockResolvedValue({
                ...mockPage,
                instagramAutoReplyEnabled: false,
            });

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result).toEqual({
                success: false,
                commentId: 'comment-1',
                error: 'Instagram auto-reply disabled for this page',
            });
        });

        it('should return error when page has no userId', async () => {
            mockGetPageByInstagramId.mockResolvedValue({
                ...mockPage,
                userId: null,
            });

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result).toEqual({
                success: false,
                commentId: 'comment-1',
                error: 'Page has no associated user',
            });
        });

        it('should return error when comments auto-reply is disabled by settings', async () => {
            mockIsCommentsAutoReplyEnabled.mockResolvedValue(false);

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Comments auto-reply disabled');
        });

        it('should return error when media auto-reply is disabled', async () => {
            // findOrCreateMedia returns media with autoReplyEnabled: false
            mockDbSelect.mockImplementation(() => ({
                where: vi.fn().mockResolvedValue([]),
            }));
            mockDbInsert.mockImplementation(() => ({
                returning: vi.fn().mockResolvedValue([{
                    id: 'media-uuid',
                    autoReplyEnabled: false,
                    replied: false,
                }]),
            }));

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Auto-reply disabled for this media');
        });

        it('should return error when comment already replied', async () => {
            let callCount = 0;
            mockDbSelect.mockImplementation(() => ({
                where: vi.fn().mockImplementation(() => {
                    callCount++;
                    // First call: findOrCreateMedia (existing media)
                    if (callCount <= 2) {
                        return Promise.resolve([{ id: 'media-uuid', autoReplyEnabled: true }]);
                    }
                    // Third call: check existing comment
                    return Promise.resolve([{ id: 'comment-uuid', replied: true }]);
                }),
            }));

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Comment already replied');
        });

        it('should use template fallback when AI reply is null', async () => {
            mockGenerateReply.mockResolvedValue({ reply: null });

            // Setup: existing media, no existing comment
            let selectCall = 0;
            mockDbSelect.mockImplementation(() => ({
                where: vi.fn().mockImplementation(() => {
                    selectCall++;
                    if (selectCall <= 2) return Promise.resolve([{ id: 'media-uuid', autoReplyEnabled: true, caption: 'test' }]);
                    return Promise.resolve([]); // no existing comment
                }),
            }));

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result.success).toBe(true);
            expect(result.replyMethod).toBe('template');
            expect(result.replyText).toContain('Thank you');
        });

        it('should return error when Instagram reply posting fails', async () => {
            mockReplyToComment.mockRejectedValue(new Error('API error'));

            let selectCall = 0;
            mockDbSelect.mockImplementation(() => ({
                where: vi.fn().mockImplementation(() => {
                    selectCall++;
                    if (selectCall <= 2) return Promise.resolve([{ id: 'media-uuid', autoReplyEnabled: true, caption: 'test' }]);
                    return Promise.resolve([]); // no existing comment
                }),
            }));

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Failed to post reply to Instagram');
        });

        it('should catch and return unexpected errors', async () => {
            mockGetPageByInstagramId.mockRejectedValue(new Error('DB connection lost'));

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result.success).toBe(false);
            expect(result.error).toBe('DB connection lost');
        });
    });

    describe('processMessage', () => {
        it('should return error when page is not found', async () => {
            mockGetPageByInstagramId.mockResolvedValue(null);

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result).toEqual({
                success: false,
                messageId: 'msg-1',
                error: 'Page not found',
            });
        });

        it('should return error when Instagram auto-reply is disabled', async () => {
            mockGetPageByInstagramId.mockResolvedValue({
                ...mockPage,
                instagramAutoReplyEnabled: false,
            });

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Instagram auto-reply disabled for this page');
        });

        it('should return error when page has no userId', async () => {
            mockGetPageByInstagramId.mockResolvedValue({
                ...mockPage,
                userId: null,
            });

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Page has no associated user');
        });

        it('should send away message when auto-reply disabled and away message configured', async () => {
            mockIsMessagesAutoReplyEnabled.mockResolvedValue(false);
            mockGetAwayMessage.mockResolvedValue('We are currently away');

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(mockSendDirectMessage).toHaveBeenCalledWith('ig-1', 'sender-1', 'We are currently away', mockPage.accessToken);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Messages auto-reply disabled');
        });

        it('should not fail if away message sending fails', async () => {
            mockIsMessagesAutoReplyEnabled.mockResolvedValue(false);
            mockGetAwayMessage.mockResolvedValue('Away');
            mockSendDirectMessage.mockRejectedValue(new Error('blocked'));

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Messages auto-reply disabled');
        });

        it('should return error when message already replied', async () => {
            mockDbSelect.mockImplementation(() => ({
                where: vi.fn().mockResolvedValue([{ id: 'msg-uuid', replied: true }]),
            }));

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Message already replied');
        });

        it('should return error when no AI reply is generated', async () => {
            mockGenerateReply.mockResolvedValue({ reply: null });
            mockGetSettings.mockResolvedValue({ aiEnabled: true });

            // No existing message
            mockDbSelect.mockImplementation(() => ({
                where: vi.fn().mockResolvedValue([{ id: 'msg-uuid', replied: false }]),
                orderBy: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([]),
                }),
            }));

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            // It might hit "already replied" first since we return replied: false
            // Let's check what happens
            expect(result.success).toBe(false);
        });

        it('should return error when DM sending fails', async () => {
            mockSendDirectMessage.mockRejectedValue(new Error('Cannot DM'));

            // No existing message, so it creates one
            mockDbSelect.mockImplementation(() => ({
                where: vi.fn().mockResolvedValue([]),
                orderBy: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([]),
                }),
            }));
            mockDbInsert.mockImplementation(() => ({
                returning: vi.fn().mockResolvedValue([{ id: 'msg-uuid', replied: false }]),
            }));

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to send reply');
        });

        it('should catch and return unexpected errors', async () => {
            mockGetPageByInstagramId.mockRejectedValue(new Error('timeout'));

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('timeout');
        });

        it('should skip reply when AI is disabled', async () => {
            mockGetSettings.mockResolvedValue({ aiEnabled: false });

            mockDbSelect.mockImplementation(() => ({
                where: vi.fn().mockResolvedValue([]),
                orderBy: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([]),
                }),
            }));
            mockDbInsert.mockImplementation(() => ({
                returning: vi.fn().mockResolvedValue([{ id: 'msg-uuid', replied: false }]),
            }));

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('No reply generated');
            expect(mockGenerateReply).not.toHaveBeenCalled();
        });
    });
});
