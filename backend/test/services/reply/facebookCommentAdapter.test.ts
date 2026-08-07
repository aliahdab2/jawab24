import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
const mockGetPageByFacebookId = vi.fn();
vi.mock('../../../src/services/pages', () => ({
    pagesService: {
        getPageByFacebookId: (...args: unknown[]) => mockGetPageByFacebookId(...args),
    },
}));

const mockFindOrCreateFromWebhook = vi.fn();
vi.mock('../../../src/services/posts', () => ({
    postsService: {
        findOrCreateFromWebhook: (...args: unknown[]) => mockFindOrCreateFromWebhook(...args),
    },
}));

const mockFindOrCreateComment = vi.fn();
const mockMarkAsReplied = vi.fn();
const mockUpdateComment = vi.fn();
vi.mock('../../../src/services/comments', () => ({
    commentsService: {
        findOrCreateFromWebhook: (...args: unknown[]) => mockFindOrCreateComment(...args),
        markAsReplied: (...args: unknown[]) => mockMarkAsReplied(...args),
        updateComment: (...args: unknown[]) => mockUpdateComment(...args),
    },
}));

const mockGetCommentDetails = vi.fn();
vi.mock('../../../src/services/facebook', () => ({
    facebookService: {
        getCommentDetails: (...args: unknown[]) => mockGetCommentDetails(...args),
    },
}));

const mockSendCommentReply = vi.fn();
vi.mock('../../../src/services/reply/sender', () => ({
    replySender: {
        sendCommentReply: (...args: unknown[]) => mockSendCommentReply(...args),
    },
    ReplyMode: {},
}));

const mockPickNudgeVariation = vi.fn();
vi.mock('../../../src/services/reply/nudge', () => ({
    pickNudgeVariation: (...args: unknown[]) => mockPickNudgeVariation(...args),
}));

const mockDetectLanguageCode = vi.fn();
vi.mock('../../../src/utils/language', () => ({
    detectLanguageCode: (...args: unknown[]) => mockDetectLanguageCode(...args),
    detectCommentLanguage: (...args: unknown[]) => mockDetectLanguageCode(args[0]),
}));

import { FacebookCommentAdapter } from '../../../src/services/reply/adapters/facebookCommentAdapter';

describe('FacebookCommentAdapter', () => {
    let adapter: FacebookCommentAdapter;

    const mockPage = {
        id: 'page_uuid_1',
        userId: 'user_uuid_1',
        name: 'Test Page',
        accessToken: 'token_abc',
        knowledgeBase: 'Some KB content',
        kbActiveVersion: 2,
        autoReplyEnabled: true,
        ecommerceStoreId: null,
        businessProfile: null,
        facebookPageId: 'fb_page_123',
    };

    beforeEach(() => {
        adapter = new FacebookCommentAdapter();
        vi.clearAllMocks();
    });

    describe('platform', () => {
        it('should identify as facebook', () => {
            expect(adapter.platform).toBe('facebook');
        });
    });

    describe('getPage', () => {
        it('should return normalized PlatformPage for existing page', async () => {
            mockGetPageByFacebookId.mockResolvedValue(mockPage);

            const result = await adapter.getPage('fb_page_123');

            expect(result).not.toBeNull();
            expect(result!.id).toBe('page_uuid_1');
            expect(result!.userId).toBe('user_uuid_1');
            expect(result!.name).toBe('Test Page');
            expect(result!.accessToken).toBe('token_abc');
            expect(result!.knowledgeBase).toBe('Some KB content');
            expect(result!.kbActiveVersion).toBe(2);
            expect(result!.autoReplyEnabled).toBe(true);
        });

        it('should return null when page not found', async () => {
            mockGetPageByFacebookId.mockResolvedValue(null);

            const result = await adapter.getPage('nonexistent_page');

            expect(result).toBeNull();
        });

        it('should default autoReplyEnabled to true when undefined', async () => {
            mockGetPageByFacebookId.mockResolvedValue({
                ...mockPage,
                autoReplyEnabled: undefined,
            });

            const result = await adapter.getPage('fb_page_123');

            expect(result!.autoReplyEnabled).toBe(true);
        });

        it('should handle null kbActiveVersion', async () => {
            mockGetPageByFacebookId.mockResolvedValue({
                ...mockPage,
                kbActiveVersion: null,
            });

            const result = await adapter.getPage('fb_page_123');

            expect(result!.kbActiveVersion).toBeNull();
        });
    });

    describe('findOrCreateContent', () => {
        it('should find or create a post and return ContentEntity', async () => {
            mockFindOrCreateFromWebhook.mockResolvedValue({
                id: 'post_uuid_1',
                autoReplyEnabled: true,
                message: 'Check out our new product!',
            });

            const result = await adapter.findOrCreateContent('page_uuid_1', 'fb_post_123');

            expect(result.id).toBe('post_uuid_1');
            expect(result.autoReplyEnabled).toBe(true);
            expect(result.message).toBe('Check out our new product!');
            expect(mockFindOrCreateFromWebhook).toHaveBeenCalledWith('page_uuid_1', 'fb_post_123', undefined, undefined);
        });

        it('should default autoReplyEnabled to true when undefined', async () => {
            mockFindOrCreateFromWebhook.mockResolvedValue({
                id: 'post_uuid_1',
                autoReplyEnabled: undefined,
                message: null,
            });

            const result = await adapter.findOrCreateContent('page_uuid_1', 'fb_post_123');

            expect(result.autoReplyEnabled).toBe(true);
        });
    });

    describe('storeComment', () => {
        it('should store a new comment and return isNew=true', async () => {
            mockFindOrCreateComment.mockResolvedValue({
                comment: { id: 'comment_uuid_1', replied: false, needsAttention: false },
                isNew: true,
            });

            const result = await adapter.storeComment(
                'post_uuid_1', 'ws_uuid_1', 'fb_comment_123', 'Great product!', 'from_user_1', 'John',
            );

            expect(result.isNew).toBe(true);
            expect(result.comment.id).toBe('comment_uuid_1');
            expect(result.comment.replied).toBe(false);
        });

        it('should return isNew=false for existing comment', async () => {
            mockFindOrCreateComment.mockResolvedValue({
                comment: { id: 'comment_uuid_1', replied: true, needsAttention: false },
                isNew: false,
            });

            const result = await adapter.storeComment(
                'post_uuid_1', 'ws_uuid_1', 'fb_comment_123', 'Great product!',
            );

            expect(result.isNew).toBe(false);
            expect(result.comment.replied).toBe(true);
        });

        it('should handle missing fromId and fromName', async () => {
            mockFindOrCreateComment.mockResolvedValue({
                comment: { id: 'comment_uuid_1', replied: false },
                isNew: true,
            });

            const result = await adapter.storeComment(
                'post_uuid_1', 'ws_uuid_1', 'fb_comment_123', 'Hello',
            );

            expect(result.comment.id).toBe('comment_uuid_1');
            expect(mockFindOrCreateComment).toHaveBeenCalledWith(
                'post_uuid_1', 'ws_uuid_1', 'fb_comment_123', 'Hello', undefined, undefined, undefined,
            );
        });
    });

    describe('sendReply', () => {
        beforeEach(() => {
            mockDetectLanguageCode.mockReturnValue('en');
            mockPickNudgeVariation.mockReturnValue('Details sent via DM');
        });

        it('should delegate to replySender with correct params', async () => {
            mockSendCommentReply.mockResolvedValue({ success: true });

            const result = await adapter.sendReply({
                platformCommentId: 'fb_comment_123',
                platformPageId: 'fb_page_123',
                replyText: 'Thank you!',
                commentMessage: 'Great product!',
                accessToken: 'token_abc',
                fromId: 'from_user_1',
                userSettings: { commentReplyMode: 'public' },
            });

            expect(result.success).toBe(true);
            expect(mockSendCommentReply).toHaveBeenCalledWith({
                facebookCommentId: 'fb_comment_123',
                replyText: 'Thank you!',
                commentMessage: 'Great product!',
                accessToken: 'token_abc',
                fromId: 'from_user_1',
                replyMode: 'public',
                dualReplyNudge: 'Details sent via DM',
                isDemo: false,
                replyImageUrl: undefined,
                readMore: null,
                // Mention plumbing: the page id keys the per-page capability memo, and the
                // flag is undefined for every non-Post-Reply comment.
                platformPageId: 'fb_page_123',
                tagCommenter: undefined,
            });
        });

        // Regression: an image card must tap through to our resolver, never to the storage key —
        // the key is deleted when the merchant replaces or clears the rule, but the already-sent
        // card lives in the customer's thread forever.
        it('sends a STABLE image view link (not the storage URL) when an image + postId are present', async () => {
            mockSendCommentReply.mockResolvedValue({ success: true });

            await adapter.sendReply({
                platformCommentId: 'fb_comment_123',
                platformPageId: 'fb_page_123',
                replyText: 'Thank you!',
                commentMessage: 'Great product!',
                accessToken: 'token_abc',
                fromId: 'from_user_1',
                userSettings: { commentReplyMode: 'private' },
                replyImageUrl: 'https://s3.example/bucket/trigger-images/ws/abc.jpg',
                postId: 'post-uuid-1',
            });

            const sent = mockSendCommentReply.mock.calls[0][0];
            expect(sent.imageViewUrl).toMatch(/\/post-reply-image\/facebook\/post-uuid-1$/);
            expect(sent.imageViewUrl).not.toContain('trigger-images');
        });

        it('has no view link when there is no image (nothing to resolve)', async () => {
            mockSendCommentReply.mockResolvedValue({ success: true });

            await adapter.sendReply({
                platformCommentId: 'fb_comment_123',
                platformPageId: 'fb_page_123',
                replyText: 'Thank you!',
                commentMessage: 'Great product!',
                accessToken: 'token_abc',
                fromId: 'from_user_1',
                userSettings: { commentReplyMode: 'private' },
                postId: 'post-uuid-1',
            });

            expect(mockSendCommentReply.mock.calls[0][0].imageViewUrl).toBeUndefined();
        });

        it('should detect language from comment and pick nudge variation', async () => {
            mockDetectLanguageCode.mockReturnValue('ar');
            mockPickNudgeVariation.mockReturnValue('تم الرد بالخاص');
            mockSendCommentReply.mockResolvedValue({ success: true });

            const variations = { ar: ['تم الرد بالخاص', 'شيك الرسائل'] };

            await adapter.sendReply({
                platformCommentId: 'fb_comment_123',
                platformPageId: 'fb_page_123',
                replyText: 'شكرا!',
                commentMessage: 'كم السعر؟',
                accessToken: 'token_abc',
                userSettings: {
                    commentReplyMode: 'dual',
                    dualReplyNudgeVariations: variations,
                },
            });

            expect(mockDetectLanguageCode).toHaveBeenCalledWith('كم السعر؟');
            expect(mockPickNudgeVariation).toHaveBeenCalledWith(variations, 'ar');
            expect(mockSendCommentReply).toHaveBeenCalledWith(
                expect.objectContaining({
                    replyMode: 'dual',
                    dualReplyNudge: 'تم الرد بالخاص',
                }),
            );
        });

        it('should strip @mentions before language detection (structured tag)', async () => {
            // Raw "@[id:Hanaa Kanaan]" has Latin characters that would falsely detect as English.
            // After stripping, detectCommentLanguage sees "" and falls back to postMessage.
            mockDetectLanguageCode.mockReturnValue('ar');
            mockSendCommentReply.mockResolvedValue({ success: true });

            await adapter.sendReply({
                platformCommentId: 'fb_comment_123',
                platformPageId: 'fb_page_123',
                replyText: 'شكرا!',
                commentMessage: '@[100012345:Hanaa Kanaan]',
                postMessage: 'منشور عربي',
                accessToken: 'token_abc',
                userSettings: { commentReplyMode: 'dual' },
            });

            // First arg to detectCommentLanguage must be stripped (empty), not the raw tag.
            expect(mockDetectLanguageCode).toHaveBeenCalledWith('');
            expect(mockDetectLanguageCode).not.toHaveBeenCalledWith('@[100012345:Hanaa Kanaan]');
        });

        it('should strip @mentions before language detection (plain tag)', async () => {
            mockDetectLanguageCode.mockReturnValue('ar');
            mockSendCommentReply.mockResolvedValue({ success: true });

            await adapter.sendReply({
                platformCommentId: 'fb_comment_123',
                platformPageId: 'fb_page_123',
                replyText: 'شكرا!',
                commentMessage: '@Ali Ahdab شو السعر؟',
                postMessage: 'منشور عربي',
                accessToken: 'token_abc',
                userSettings: { commentReplyMode: 'dual' },
            });

            // "@Ali Ahdab" stripped → "شو السعر؟" should reach detector, not the full raw comment.
            expect(mockDetectLanguageCode).toHaveBeenCalledWith('شو السعر؟');
        });

        it('should pass undefined variations when none in settings', async () => {
            mockSendCommentReply.mockResolvedValue({ success: true });

            await adapter.sendReply({
                platformCommentId: 'fb_comment_123',
                platformPageId: 'fb_page_123',
                replyText: 'Thank you!',
                commentMessage: 'Great product!',
                accessToken: 'token_abc',
                userSettings: { commentReplyMode: 'dual' },
            });

            expect(mockPickNudgeVariation).toHaveBeenCalledWith(undefined, 'en');
        });

        it('should default commentReplyMode to public when not set', async () => {
            mockSendCommentReply.mockResolvedValue({ success: true });

            await adapter.sendReply({
                platformCommentId: 'fb_comment_123',
                platformPageId: 'fb_page_123',
                replyText: 'Thank you!',
                commentMessage: 'Great product!',
                accessToken: 'token_abc',
                userSettings: {},
            });

            expect(mockSendCommentReply).toHaveBeenCalledWith(
                expect.objectContaining({ replyMode: 'public' }),
            );
        });

        it('should set isDemo=true for demo page IDs', async () => {
            mockSendCommentReply.mockResolvedValue({ success: true });

            await adapter.sendReply({
                platformCommentId: 'fb_comment_123',
                platformPageId: 'demo_page_123',
                replyText: 'Thank you!',
                commentMessage: 'Great product!',
                accessToken: 'token_abc',
                userSettings: { commentReplyMode: 'public' },
            });

            expect(mockSendCommentReply).toHaveBeenCalledWith(
                expect.objectContaining({ isDemo: true }),
            );
        });

        it('should return error when replySender fails', async () => {
            mockSendCommentReply.mockResolvedValue({
                success: false,
                error: 'Facebook API error',
            });

            const result = await adapter.sendReply({
                platformCommentId: 'fb_comment_123',
                platformPageId: 'fb_page_123',
                replyText: 'Thank you!',
                commentMessage: 'Great product!',
                accessToken: 'token_abc',
                userSettings: {},
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Facebook API error');
        });
    });

    describe('markAsReplied', () => {
        it('should delegate to commentsService.markAsReplied', async () => {
            mockMarkAsReplied.mockResolvedValue(undefined);

            await adapter.markAsReplied(
                'comment_uuid_1', 'Thank you!', 'ai', 'en', false, undefined, 'positive',
            );

            expect(mockMarkAsReplied).toHaveBeenCalledWith(
                'comment_uuid_1', 'Thank you!', 'ai', 'en', false, undefined, 'positive', undefined, undefined,
            );
        });
    });

    describe('flagComment', () => {
        it('should update comment with needsAttention=true', async () => {
            mockUpdateComment.mockResolvedValue(undefined);

            await adapter.flagComment('comment_uuid_1', 'offensive', 'OFFENSIVE');

            expect(mockUpdateComment).toHaveBeenCalledWith('comment_uuid_1', {
                needsAttention: true,
                flagReason: 'offensive',
                flagMeta: null,
                aiIntent: 'OFFENSIVE',
            });
        });

        it('should handle missing flagReason and aiIntent', async () => {
            mockUpdateComment.mockResolvedValue(undefined);

            await adapter.flagComment('comment_uuid_1');

            expect(mockUpdateComment).toHaveBeenCalledWith('comment_uuid_1', {
                needsAttention: true,
                flagReason: null,
                flagMeta: null,
                aiIntent: null,
            });
        });
    });

    describe('buildGeneratorContext', () => {
        it('should build correct context from page and content', () => {
            const page = {
                id: 'page_uuid_1',
                userId: 'user_uuid_1',
                name: 'Test Page',
                accessToken: 'token_abc',
                knowledgeBase: 'KB content',
                kbActiveVersion: 2,
                autoReplyEnabled: true,
                ecommerceStoreId: null,
                businessProfile: null,
            };
            const content = {
                id: 'post_uuid_1',
                autoReplyEnabled: true,
                message: 'Post message',
            };

            const ctx = adapter.buildGeneratorContext(page, content, 'fb_post_123');

            expect(ctx.userId).toBe('user_uuid_1');
            expect(ctx.text).toBe('');
            expect(ctx.pageName).toBe('Test Page');
            expect(ctx.knowledgeBase).toBe('KB content');
            expect(ctx.kbActiveVersion).toBe(2);
            expect(ctx.postId).toBe('fb_post_123');
            expect(ctx.postMessage).toBe('Post message');
            expect(ctx.pageId).toBe('page_uuid_1');
            expect(ctx.accessToken).toBe('token_abc');
        });

        it('should handle undefined optional fields', () => {
            const page = {
                id: 'page_uuid_1',
                userId: 'user_uuid_1',
                name: null,
                accessToken: 'token_abc',
                knowledgeBase: null,
                kbActiveVersion: null,
                autoReplyEnabled: true,
                ecommerceStoreId: null,
                businessProfile: null,
            };
            const content = {
                id: 'post_uuid_1',
                autoReplyEnabled: true,
                message: null,
            };

            const ctx = adapter.buildGeneratorContext(page, content, 'fb_post_123');

            expect(ctx.pageName).toBeUndefined();
            expect(ctx.knowledgeBase).toBeUndefined();
            expect(ctx.postMessage).toBeUndefined();
        });
    });

    describe('getFallbackReply', () => {
        it('should return null (no fallback for Facebook)', () => {
            expect(adapter.getFallbackReply()).toBeNull();
        });
    });

    describe('fetchCommenterName', () => {
        it('should return name from getCommentDetails', async () => {
            mockGetCommentDetails.mockResolvedValue({
                message: 'Great product!',
                from: { id: 'user_123', name: 'Ali Ahdab' },
            });

            const name = await adapter.fetchCommenterName('fb_comment_123', 'token_abc');

            expect(name).toBe('Ali Ahdab');
            expect(mockGetCommentDetails).toHaveBeenCalledWith('fb_comment_123', 'token_abc');
        });

        it('should return undefined when getCommentDetails returns null', async () => {
            mockGetCommentDetails.mockResolvedValue(null);

            const name = await adapter.fetchCommenterName('fb_comment_123', 'token_abc');

            expect(name).toBeUndefined();
        });

        it('should return undefined when from field is missing', async () => {
            mockGetCommentDetails.mockResolvedValue({ message: 'Hello' });

            const name = await adapter.fetchCommenterName('fb_comment_123', 'token_abc');

            expect(name).toBeUndefined();
        });

        it('should return undefined when API throws', async () => {
            mockGetCommentDetails.mockRejectedValue(new Error('API error'));

            const name = await adapter.fetchCommenterName('fb_comment_123', 'token_abc');

            expect(name).toBeUndefined();
        });
    });
});
