import { describe, it, expect, vi, beforeEach } from 'vitest';
import { replyService } from '../../src/services/reply';
import { pagesService } from '../../src/services/pages';
import { postsService } from '../../src/services/posts';
import { commentsService } from '../../src/services/comments';
import { rulesService } from '../../src/services/rules';
import { templatesService } from '../../src/services/templates';
import { aiService } from '../../src/services/ai';
import { settingsService } from '../../src/services/settings';

// Mock all services
vi.mock('../../src/services/pages');
vi.mock('../../src/services/posts');
vi.mock('../../src/services/comments');
vi.mock('../../src/services/rules');
vi.mock('../../src/services/templates');
vi.mock('../../src/services/ai');
vi.mock('../../src/services/settings');
vi.mock('../../src/services/messages');
vi.mock('../../src/services/facebook');
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canUseAiReplies: vi.fn().mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 }),
        incrementAiReplies: vi.fn().mockResolvedValue(undefined),
    }
}));
vi.mock('axios');
vi.mock('../../src/config', () => ({
    config: {
        ai: {
            enabled: true,
            cacheEnabled: true,
            serviceUrl: 'http://localhost:3002',
            defaultModel: 'gpt-4-mini',
        },
    },
}));

describe('Reply Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        
        // Default mock implementations for settingsService
        vi.mocked(settingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
        vi.mocked(settingsService.isMessagesAutoReplyEnabled).mockResolvedValue(true);
        vi.mocked(settingsService.getReplyDelay).mockResolvedValue(0);
        vi.mocked(settingsService.getSettings).mockResolvedValue({
            id: 'settings_uuid',
            userId: 'user_uuid',
            aiEnabled: true,
            defaultReplyLanguage: 'en',
            commentsAutoReply: true,
            messagesAutoReply: true,
            businessHoursOnly: false,
            replyDelay: 0,
        } as any);
    });

    describe('processComment', () => {
        const mockPage = {
            id: 'page_uuid',
            userId: 'user_uuid',
            facebookPageId: 'fb_page_123',
            name: 'My Store',
            accessToken: 'access_token',
            autoReplyEnabled: true,
        };

        const mockPost = {
            id: 'post_uuid',
            pageId: 'page_uuid',
            facebookPostId: 'fb_post_123',
            autoReplyEnabled: true,
        };

        const mockComment = {
            id: 'comment_uuid',
            postId: 'post_uuid',
            facebookCommentId: 'fb_comment_123',
            message: 'Great product!',
            replied: false,
        };

        it('should process comment and reply using template', async () => {
            const mockRule = { id: 'rule_1', templateId: 'template_1' };
            const mockTemplate = {
                id: 'template_1',
                translations: { en: 'Thank you for your feedback!' },
            };

            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue(mockPost as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({ comment: mockComment as any, isNew: true });
            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(mockRule as any);
            vi.mocked(templatesService.getTemplate).mockResolvedValue(mockTemplate as any);
            vi.mocked(commentsService.markAsReplied).mockResolvedValue(mockComment as any);

            // Mock the Facebook API call
            const axios = await import('axios');
            vi.mocked(axios.default.post).mockResolvedValue({ data: { id: 'reply_id' } });

            const result = await replyService.processComment(
                'fb_page_123',
                'fb_post_123',
                'fb_comment_123',
                'Great product!',
                'user_123',
                'John Doe'
            );

            expect(result.success).toBe(true);
            expect(result.replyMethod).toBe('template');
            expect(result.replyText).toBe('Thank you for your feedback!');
        });

        it('should process comment and reply using AI when no template', async () => {
            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue(mockPost as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({ comment: mockComment as any, isNew: true });
            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'AI generated reply',
                language: 'en',
                cached: false,
            });
            vi.mocked(commentsService.markAsReplied).mockResolvedValue(mockComment as any);

            const axios = await import('axios');
            vi.mocked(axios.default.post).mockResolvedValue({ data: { id: 'reply_id' } });

            const result = await replyService.processComment(
                'fb_page_123',
                'fb_post_123',
                'fb_comment_123',
                'Great product!',
                'user_123',
                'John Doe'
            );

            expect(result.success).toBe(true);
            expect(result.replyMethod).toBe('ai');
            expect(aiService.generateReply).toHaveBeenCalled();
        });

        it('should skip if page not found', async () => {
            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(null);

            const result = await replyService.processComment(
                'fb_page_123',
                'fb_post_123',
                'fb_comment_123',
                'Great product!'
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Page not found');
        });

        it('should skip if auto-reply is disabled for page', async () => {
            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue({
                ...mockPage,
                autoReplyEnabled: false,
            } as any);

            const result = await replyService.processComment(
                'fb_page_123',
                'fb_post_123',
                'fb_comment_123',
                'Great product!'
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Auto-reply disabled for this page');
        });

        it('should skip if auto-reply is disabled for post', async () => {
            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(settingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue({
                ...mockPost,
                autoReplyEnabled: false,
            } as any);

            const result = await replyService.processComment(
                'fb_page_123',
                'fb_post_123',
                'fb_comment_123',
                'Great product!'
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Auto-reply disabled for this post');
        });

        it('should skip if comment already replied', async () => {
            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(settingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue(mockPost as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({
                comment: { ...mockComment, replied: true } as any,
                isNew: false,
            });

            const result = await replyService.processComment(
                'fb_page_123',
                'fb_post_123',
                'fb_comment_123',
                'Great product!'
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Comment already replied');
        });
    });
});

