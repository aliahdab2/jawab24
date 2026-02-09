import { describe, it, expect, vi, beforeEach } from 'vitest';
import { replyService } from '../../src/services/reply';
import { pagesService } from '../../src/services/pages';
import { postsService } from '../../src/services/posts';
import { commentsService } from '../../src/services/comments';
import { rulesService } from '../../src/services/rules';
import { templatesService } from '../../src/services/templates';
import { aiService } from '../../src/services/ai';
import { settingsService } from '../../src/services/settings';
import { redis } from '../../src/lib/redis';
import { pipelineMetrics } from '../../src/lib/pipelineMetrics';

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
vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: vi.fn().mockResolvedValue('notif-123'),
    },
}));
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canUseAiReplies: vi.fn().mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 }),
        incrementAiReplies: vi.fn().mockResolvedValue(undefined),
    }
}));

// Mock Redis with rate limiting support
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn(),
        set: vi.fn(),
        quit: vi.fn(),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
    },
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
        facebook: {
            graphApiVersion: 'v18.0',
        },
    },
}));

describe('Reply Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pipelineMetrics.reset();

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

        // Default Redis rate limiting mocks (within limit)
        vi.mocked(redis.incr).mockResolvedValue(1);
        vi.mocked(redis.expire).mockResolvedValue(1);
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
            expect(pipelineMetrics.getMetrics().counters['facebook_comment.success']).toBe(1);
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
            expect(pipelineMetrics.getMetrics().counters['facebook_comment.page_not_found']).toBe(1);
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
            expect(pipelineMetrics.getMetrics().counters['facebook_comment.auto_reply_disabled']).toBe(1);
        });

        it('should skip if auto-reply is disabled for post', async () => {
            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(settingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue({
                ...mockPost,
                autoReplyEnabled: false,
            } as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({
                comment: mockComment as any,
                isNew: true,
            });

            const result = await replyService.processComment(
                'fb_page_123',
                'fb_post_123',
                'fb_comment_123',
                'Great product!'
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Auto-reply disabled for this content');
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

        it('should rate limit when user exceeds comment limit', async () => {
            // Simulate 6th request (over limit of 5)
            vi.mocked(redis.incr).mockResolvedValue(6);
            vi.mocked(redis.expire).mockResolvedValue(1);

            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(settingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue(mockPost as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({
                comment: mockComment as any,
                isNew: true,
            });

            const result = await replyService.processComment(
                'fb_page_123',
                'fb_post_123',
                'fb_comment_123',
                'Great product!',
                'user_123', // fromId is required for rate limiting
                'John Doe'
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Rate limited');
            expect(redis.incr).toHaveBeenCalledWith('rate:comment:page_uuid:user_123');
        });

        it('should allow comment when within rate limit', async () => {
            // Simulate 3rd request (within limit of 5)
            vi.mocked(redis.incr).mockResolvedValue(3);
            vi.mocked(redis.expire).mockResolvedValue(1);

            const mockRule = { id: 'rule_1', templateId: 'template_1' };
            const mockTemplate = {
                id: 'template_1',
                translations: { en: 'Thank you!' },
            };

            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(settingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue(mockPost as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({
                comment: mockComment as any,
                isNew: true,
            });
            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(mockRule as any);
            vi.mocked(templatesService.getTemplate).mockResolvedValue(mockTemplate as any);
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
            expect(redis.incr).toHaveBeenCalled();
        });

        it('should allow request when Redis fails (fail-open)', async () => {
            // Simulate Redis failure
            vi.mocked(redis.incr).mockRejectedValue(new Error('Redis connection failed'));

            const mockRule = { id: 'rule_1', templateId: 'template_1' };
            const mockTemplate = {
                id: 'template_1',
                translations: { en: 'Thank you!' },
            };

            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(settingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue(mockPost as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({
                comment: mockComment as any,
                isNew: true,
            });
            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(mockRule as any);
            vi.mocked(templatesService.getTemplate).mockResolvedValue(mockTemplate as any);
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

            // Should still succeed because fail-open
            expect(result.success).toBe(true);
        });

        it('should pass flag data to markAsReplied when AI returns flags', async () => {
            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue(mockPost as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({ comment: mockComment as any, isNew: true });
            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'We apologize for the inconvenience.',
                language: 'en',
                cached: false,
                intent: 'COMPLAINT',
                confidence: 'high',
                flags: ['angry_customer'],
            });
            vi.mocked(commentsService.markAsReplied).mockResolvedValue(mockComment as any);

            const axios = await import('axios');
            vi.mocked(axios.default.post).mockResolvedValue({ data: { id: 'reply_id' } });

            const result = await replyService.processComment(
                'fb_page_123',
                'fb_post_123',
                'fb_comment_123',
                'This is terrible!',
                'user_123',
                'John Doe'
            );

            expect(result.success).toBe(true);
            // Verify markAsReplied was called with flag data
            expect(commentsService.markAsReplied).toHaveBeenCalledWith(
                'comment_uuid',
                'We apologize for the inconvenience.',
                'ai',
                undefined, // templateId
                expect.any(String), // language
                true, // needsAttention
                'angry_customer', // flagReason
                'COMPLAINT' // aiIntent
            );
        });

        it('should send flagged_reply notification when needsAttention is true', async () => {
            const { notificationService } = await import('../../src/services/notifications');

            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue(mockPost as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({ comment: mockComment as any, isNew: true });
            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'We apologize.',
                language: 'en',
                cached: false,
                intent: 'COMPLAINT',
                confidence: 'high',
                flags: ['angry_customer'],
            });
            vi.mocked(commentsService.markAsReplied).mockResolvedValue(mockComment as any);

            const axios = await import('axios');
            vi.mocked(axios.default.post).mockResolvedValue({ data: { id: 'reply_id' } });

            await replyService.processComment(
                'fb_page_123',
                'fb_post_123',
                'fb_comment_123',
                'Angry message!',
                'user_123',
                'John Doe'
            );

            // Verify notification was sent
            expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith(
                'user_uuid',
                'flagged_reply',
                expect.objectContaining({
                    senderName: 'John Doe',
                    reason: expect.any(String),
                }),
                expect.objectContaining({
                    commentId: 'comment_uuid',
                    type: 'comment',
                })
            );
        });

        it('should NOT send notification when needsAttention is false', async () => {
            const { notificationService } = await import('../../src/services/notifications');

            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue(mockPost as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({ comment: mockComment as any, isNew: true });
            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(null);
            vi.mocked(aiService.generateReply).mockResolvedValue({
                reply: 'Thank you!',
                language: 'en',
                cached: false,
                intent: 'COMPLIMENT',
                confidence: 'high',
                flags: [],
            });
            vi.mocked(commentsService.markAsReplied).mockResolvedValue(mockComment as any);

            const axios = await import('axios');
            vi.mocked(axios.default.post).mockResolvedValue({ data: { id: 'reply_id' } });

            await replyService.processComment(
                'fb_page_123',
                'fb_post_123',
                'fb_comment_123',
                'Great product!',
                'user_123',
                'John Doe'
            );

            // Should NOT have sent notification
            expect(notificationService.sendTemplateNotification).not.toHaveBeenCalled();
        });

        it('should pass needsAttention: false for template replies', async () => {
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

            const axios = await import('axios');
            vi.mocked(axios.default.post).mockResolvedValue({ data: { id: 'reply_id' } });

            await replyService.processComment(
                'fb_page_123',
                'fb_post_123',
                'fb_comment_123',
                'Great product!',
                'user_123',
                'John Doe'
            );

            // markAsReplied should have needsAttention=false for template replies
            expect(commentsService.markAsReplied).toHaveBeenCalledWith(
                'comment_uuid',
                'Thank you for your feedback!',
                'template',
                'template_1',
                expect.any(String),
                false, // needsAttention
                undefined, // flagReason
                undefined // aiIntent
            );
        });

        it('should set TTL on first rate limit increment', async () => {
            // Simulate first request (count = 1)
            vi.mocked(redis.incr).mockResolvedValue(1);
            vi.mocked(redis.expire).mockResolvedValue(1);

            const mockRule = { id: 'rule_1', templateId: 'template_1' };
            const mockTemplate = {
                id: 'template_1',
                translations: { en: 'Thank you!' },
            };

            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(settingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue(mockPost as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({
                comment: mockComment as any,
                isNew: true,
            });
            vi.mocked(rulesService.findMatchingRule).mockResolvedValue(mockRule as any);
            vi.mocked(templatesService.getTemplate).mockResolvedValue(mockTemplate as any);
            vi.mocked(commentsService.markAsReplied).mockResolvedValue(mockComment as any);

            const axios = await import('axios');
            vi.mocked(axios.default.post).mockResolvedValue({ data: { id: 'reply_id' } });

            await replyService.processComment(
                'fb_page_123',
                'fb_post_123',
                'fb_comment_123',
                'Great product!',
                'user_123',
                'John Doe'
            );

            // Should set expire on first increment
            expect(redis.expire).toHaveBeenCalledWith('rate:comment:page_uuid:user_123', 60);
        });
    });
});

