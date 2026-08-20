import { describe, it, expect, vi, beforeEach } from 'vitest';
import { replyService } from '../../src/services/reply';
import { pagesService } from '../../src/services/pages';
import { postsService } from '../../src/services/posts';
import { commentsService } from '../../src/services/comments';
import { aiService } from '../../src/services/ai';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';
import { redis } from '../../src/lib/redis';
import { pipelineMetrics } from '../../src/lib/pipelineMetrics';

// Mock all services
vi.mock('../../src/services/pages');
vi.mock('../../src/services/posts');
vi.mock('../../src/services/comments');
vi.mock('../../src/services/ai');
vi.mock('../../src/services/workspaceSettings');
vi.mock('../../src/services/messages');
vi.mock('../../src/services/facebook');
vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: vi.fn().mockResolvedValue('notif-123'),
        sendTemplateNotificationToWorkspace: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        enforceAutoReplyGate: vi.fn().mockResolvedValue({ allowed: true }),
        canUseAiReplies: vi.fn().mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 }),
        incrementAiReplies: vi.fn().mockResolvedValue(undefined),
        logQuotaEvent: vi.fn().mockResolvedValue(undefined),
    }
}));

// Mock Redis with rate limiting support
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn(),
        // SET NX returns 'OK' when the key is free — the comment debounce reads
        // this as "slot won, proceed". Returning undefined would read as "slot
        // held" and debounce every comment.
        set: vi.fn().mockResolvedValue('OK'),
        // Lua compare-and-delete used by the debounce release path.
        eval: vi.fn().mockResolvedValue(1),
        quit: vi.fn(),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
    },
}));

vi.mock('../../src/lib/replyLock', () => ({
    acquireReplyLock: vi.fn().mockResolvedValue('mock-lock-token'),
    releaseReplyLock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('axios');

// In-memory pipelineMetrics mock (Redis-backed in production; use counters map in tests)
const pipelineCounters = vi.hoisted<Record<string, number>>(() => ({}));
vi.mock('../../src/lib/pipelineMetrics', () => ({
    pipelineMetrics: {
        record: vi.fn((pipeline: string, outcome: string) => {
            const key = `${pipeline}.${outcome}`;
            pipelineCounters[key] = (pipelineCounters[key] || 0) + 1;
            return Promise.resolve();
        }),
        // Present on the real module (D-087). A mock missing it makes the
        // fire-and-forget counter throw AT the call site and fail the reply —
        // which is how this gap surfaced.
        recordReplyMode: vi.fn(() => Promise.resolve()),
        getMetrics: vi.fn(() => Promise.resolve({
            since: '2025-01-01T00:00:00.000Z',
            counters: { ...pipelineCounters },
        })),
        reset: vi.fn(() => {
            Object.keys(pipelineCounters).forEach(k => delete pipelineCounters[k]);
            return Promise.resolve();
        }),
    },
    PipelineMetrics: class {},
}));

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
        circuitBreaker: {
            failureThreshold: 5,
            openDurationSeconds: 30,
        },
    },
}));

describe('Reply Service', () => {

    beforeEach(async () => {
        vi.clearAllMocks();
        await pipelineMetrics.reset();

        // Default mock implementations for workspaceSettingsService
        vi.mocked(workspaceSettingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
        vi.mocked(workspaceSettingsService.isMessagesAutoReplyEnabled).mockResolvedValue(true);
        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(workspaceSettingsService.getReplyDelay).mockResolvedValue(0);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            aiEnabled: true,
            defaultReplyLanguage: 'en',
            supportedLanguages: ['en', 'ar'],
            autoDetectLanguage: true,
            aiModel: 'gpt-4.1-mini',
            commentReplyMode: 'public',
            dualReplyNudge: '',
            commentsAutoReply: true,
            messagesAutoReply: true,
            businessHoursOnly: false,
            businessHoursStart: '09:00',
            businessHoursEnd: '18:00',
            timezone: 'Asia/Damascus',
            greetingMessageMulti: {},
            awayMessageMulti: {},
            dualReplyNudgeMulti: {},
            replyDelay: 0,
            commentEscalationMinutes: 60,
            messageEscalationMinutes: 30,
            handoffPauseDurationMinutes: 30,
        } as any);

        // Default Redis rate limiting mocks (within limit)
        vi.mocked(redis.incr).mockResolvedValue(1);
        vi.mocked(redis.expire).mockResolvedValue(1);
    });

    describe('processComment', () => {
        const mockPage = {
            id: 'page_uuid',
            userId: 'user_uuid',
            workspaceId: 'test_workspace_id',
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

        it('should process comment and reply using AI', async () => {
            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue(mockPost as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({ comment: mockComment as any, isNew: true });
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
            expect((await pipelineMetrics.getMetrics()).counters['facebook_comment.page_not_found']).toBe(1);
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
            expect((await pipelineMetrics.getMetrics()).counters['facebook_comment.auto_reply_disabled']).toBe(1);
        });

        it('should skip if auto-reply is disabled for post', async () => {
            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(workspaceSettingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
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
            vi.mocked(workspaceSettingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
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
            vi.mocked(workspaceSettingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
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

            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(workspaceSettingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue(mockPost as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({
                comment: mockComment as any,
                isNew: true,
            });
            vi.mocked(aiService.generateReply).mockResolvedValue({ reply: 'Thank you!', language: 'en', cached: false });
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

            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(workspaceSettingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue(mockPost as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({
                comment: mockComment as any,
                isNew: true,
            });
            vi.mocked(aiService.generateReply).mockResolvedValue({ reply: 'Thank you!', language: 'en', cached: false });
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
                expect.any(String), // language
                true, // needsAttention
                'angry_customer', // flagReason
                'COMPLAINT', // aiIntent
                'We apologize for the inconvenience.', // aiOriginalReply (captured for AI replies)
                null, // flagMeta (plain keys like angry_customer carry no structured params)
            );
        });

        it('should send flagged_reply notification when needsAttention is true', async () => {
            const { notificationService } = await import('../../src/services/notifications');

            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue(mockPost as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({ comment: mockComment as any, isNew: true });
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

            // Verify notification was sent to workspace (so all team members receive it)
            expect(notificationService.sendTemplateNotificationToWorkspace).toHaveBeenCalledWith(
                'test_workspace_id',
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
            expect(notificationService.sendTemplateNotificationToWorkspace).not.toHaveBeenCalled();
        });

        it('should set TTL on first rate limit increment', async () => {
            // Simulate first request (count = 1)
            vi.mocked(redis.incr).mockResolvedValue(1);
            vi.mocked(redis.expire).mockResolvedValue(1);

            vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as any);
            vi.mocked(workspaceSettingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
            vi.mocked(postsService.findOrCreateFromWebhook).mockResolvedValue(mockPost as any);
            vi.mocked(commentsService.findOrCreateFromWebhook).mockResolvedValue({
                comment: mockComment as any,
                isNew: true,
            });
            vi.mocked(aiService.generateReply).mockResolvedValue({ reply: 'Thank you!', language: 'en', cached: false });
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

