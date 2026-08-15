import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    instagramMedia: { id: 'id', instagramMediaId: 'instagramMediaId', caption: 'caption', createdAt: 'createdAt' },
    instagramComments: { id: 'id', instagramCommentId: 'instagramCommentId' },
    // commentsService.resolveComment tries Facebook then Instagram — both tables must
    // be defined here even if the test only exercises the IG path.
    comments: { id: 'id' },
    messages: { id: 'id', platformMessageId: 'platformMessageId', pageId: 'pageId', senderId: 'senderId', platform: 'platform', createdTime: 'createdTime', direction: 'direction', message: 'message' },
    posts: { id: 'id', message: 'message', createdTime: 'createdTime' },
}));

// messageProcessor imports conversationsService for origin-post lookup. These tests
// never exercise comment-originated DMs, so stub findByPageAndSender to return null.
vi.mock('../../src/services/conversations', () => ({
    conversationsService: {
        findByPageAndSender: vi.fn().mockResolvedValue(null),
        findOrCreate: vi.fn(),
        setSenderName: vi.fn(),
        getSenderName: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        enforceAutoReplyGate: vi.fn().mockResolvedValue({ allowed: true }),
    },
}));
vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPageByInstagramId: vi.fn(),
    },
    invalidateWorkspaceStatsCache: vi.fn(),
}));

vi.mock('../../src/services/reply/generator', () => ({
    replyGenerator: {
        generateForComment: vi.fn(),
        generateForMessage: vi.fn(),
        setLogger: vi.fn(),
    },
    shouldSkipReply: vi.fn().mockReturnValue(false),
    shouldSilentlySkip: vi.fn().mockReturnValue(false),
    shouldUseFallback: vi.fn().mockReturnValue(false),
    shouldHoldReply: vi.fn().mockReturnValue(false),
    SKIP_REPLY_FLAGS: ['offensive_or_abusive', 'offensive'],
    SAFE_FALLBACK_FLAGS: ['price_not_in_kb'],
    HOLD_REPLY_FLAGS: ['self_identification_exhausted'],
    SKIP_REPLY_INTENTS: ['OFFENSIVE'],
    PRICE_FALLBACK: { ar: 'شكراً لاهتمامك!', en: 'Thank you for your interest!' },
    resolveFallbackLanguage: vi.fn().mockReturnValue('en'),
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
    commentDebounce: {
        isCoolingDown: vi.fn().mockResolvedValue(false),
        arm: vi.fn().mockResolvedValue(undefined),
        setLogger: vi.fn(),
    },
    postReplyCap: {
        isOverCap: vi.fn().mockResolvedValue(false),
        increment: vi.fn().mockResolvedValue(undefined),
        setLogger: vi.fn(),
    },
}));

vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: vi.fn().mockResolvedValue(undefined),
        sendTemplateNotificationToWorkspace: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/utils/language', () => ({
    detectLanguageCode: vi.fn().mockReturnValue('en'),
    detectTemplateLanguage: vi.fn().mockReturnValue('en'),
    detectCommentLanguage: vi.fn().mockReturnValue('en'),
}));

vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        isCommentsAutoReplyEnabled: vi.fn(),
        isMessagesAutoReplyEnabled: vi.fn(),
        isAutoReplyEnabledFromSettings: vi.fn(),
        getReplyDelay: vi.fn(),
        getSettings: vi.fn(),
        getAwayMessage: vi.fn(),
        getGreetingMessage: vi.fn(),
    },
}));

vi.mock('../../src/services/instagram', () => ({
    instagramService: {
        replyToComment: vi.fn(),
        sendDirectMessage: vi.fn(),
        sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/messages', () => ({
    messagesService: {
        findOrCreateFromWebhook: vi.fn(),
        getSenderNameBySenderId: vi.fn(),
        isPaused: vi.fn(),
        getRemainingPauseMs: vi.fn().mockResolvedValue(60000),
        hasNewerUnrepliedMessage: vi.fn(),
        isFirstIncomingMessage: vi.fn(),
        storeOutgoingMessage: vi.fn(),
        getUnrepliedFromSender: vi.fn(),
        markOlderMessagesAsReplied: vi.fn(),
        markAsReplied: vi.fn(),
        flagMessage: vi.fn(),
    },
}));

// commentProcessor now calls resolveComment on several silent-skip paths
// (rate-limited, settings-disabled, AI-spam). Mock at the service layer so
// tests don't need to stub the full db.update(...).returning() chain.
vi.mock('../../src/services/comments', () => ({
    commentsService: {
        updateComment: vi.fn().mockResolvedValue(undefined),
        resolveComment: vi.fn().mockResolvedValue(undefined),
    },
}));


// In-memory pipelineMetrics mock (Redis-backed in production; use counters map in tests)
const pipelineCounters = vi.hoisted<Record<string, number>>(() => ({}));
vi.mock('../../src/lib/pipelineMetrics', () => ({
    pipelineMetrics: {
        record: vi.fn((pipeline: string, outcome: string) => {
            const key = `${pipeline}.${outcome}`;
            pipelineCounters[key] = (pipelineCounters[key] || 0) + 1;
            return Promise.resolve();
        }),
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
// The away-message cooldown is a Redis SET NX. Without this mock the suite talks
// to whatever Redis the dev machine happens to have running, so the cooldown key
// survives between runs and the assertion fails on the second run only.
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        incr: vi.fn(),
        expire: vi.fn(),
        quit: vi.fn(),
    },
}));

vi.mock('../../src/lib/replyLock', () => ({
    acquireReplyLock: vi.fn().mockResolvedValue('mock-lock-token'),
    releaseReplyLock: vi.fn().mockResolvedValue(undefined),
}));



import { InstagramReplyService } from '../../src/services/instagramReply';
import { pagesService } from '../../src/services/pages';
import { replyGenerator, shouldSkipReply, shouldUseFallback } from '../../src/services/reply/generator';
import { rateLimiter } from '../../src/services/protection';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';
import { instagramService } from '../../src/services/instagram';
import { pageLinkedInstagramCredential } from '../../src/services/instagramCredential';
import { messagesService } from '../../src/services/messages';
import { notificationService } from '../../src/services/notifications';
import { db } from '../../src/db';
import { pipelineMetrics } from '../../src/lib/pipelineMetrics';
import { redis } from '../../src/lib/redis';

describe('InstagramReplyService', () => {
    let service: InstagramReplyService;

    const mockPage = {
        id: 'page-uuid',
        userId: 'user-uuid',
        workspaceId: 'test_workspace_id',
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
        const message = existingMessage || { id: 'msg-uuid', replied: false, needsAttention: false };
        vi.mocked(messagesService.findOrCreateFromWebhook).mockResolvedValue({
            message: { ...message, platformMessageId: 'test-msg', pageId: 'page-uuid', senderId: 'sender', senderName: null, message: 'hello', direction: 'incoming', replyText: null, replyMethod: null, createdAt: null },
            isNew: !existingMessage,
        });
    }

    beforeEach(async () => {
        vi.clearAllMocks();
        await pipelineMetrics.reset();
        service = new InstagramReplyService();

        // Default happy-path mocks
        vi.mocked(pagesService.getPageByInstagramId).mockResolvedValue(mockPage as any);
        vi.mocked(workspaceSettingsService.isCommentsAutoReplyEnabled).mockResolvedValue(true);
        vi.mocked(workspaceSettingsService.isMessagesAutoReplyEnabled).mockResolvedValue(true);
        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(workspaceSettingsService.getReplyDelay).mockResolvedValue(0);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            aiEnabled: true,
            commentsAutoReply: true,
            messagesAutoReply: true,
            replyDelay: 0,
            handoffPauseDurationMinutes: 30,
        } as any);
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
        vi.mocked(workspaceSettingsService.getAwayMessage).mockResolvedValue(null);
        vi.mocked(messagesService.getSenderNameBySenderId).mockResolvedValue('Test Sender');
        vi.mocked(messagesService.isPaused).mockResolvedValue(false);
        vi.mocked(messagesService.hasNewerUnrepliedMessage).mockResolvedValue(false);
        vi.mocked(messagesService.isFirstIncomingMessage).mockResolvedValue(false);
        vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({} as any);
        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([{ id: 'msg-uuid', message: 'hello' }]);
        vi.mocked(messagesService.markOlderMessagesAsReplied).mockResolvedValue(0);
        vi.mocked(messagesService.markAsReplied).mockResolvedValue(undefined);
        vi.mocked(messagesService.flagMessage).mockResolvedValue(undefined);
        vi.mocked(messagesService.findOrCreateFromWebhook).mockResolvedValue({
            message: { id: 'msg-uuid', platformMessageId: 'test-msg', pageId: 'page-uuid', senderId: 'sender', senderName: null, message: 'hello', direction: 'incoming', replied: false, replyText: null, replyMethod: null, createdAt: null, needsAttention: false } as any,
            isNew: true,
        });
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
            expect((await pipelineMetrics.getMetrics()).counters['instagram_comment.page_not_found']).toBe(1);
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
            expect((await pipelineMetrics.getMetrics()).counters['instagram_comment.auto_reply_disabled']).toBe(1);
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
            vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(false);
            setupDbForComment();

            const result = await service.processComment('ig-1', 'media-1', 'comment-1', 'hello');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Comments auto-reply disabled');
            expect((await pipelineMetrics.getMetrics()).counters['instagram_comment.settings_disabled']).toBe(1);
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
        afterEach(() => {
            // Ensure per-test overrides don't leak to the next test
            vi.mocked(shouldSkipReply).mockReturnValue(false);
            vi.mocked(shouldUseFallback).mockReturnValue(false);
        });

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
            vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(false);
            vi.mocked(workspaceSettingsService.getAwayMessage).mockResolvedValue('We are currently away');
            // Away message now gates on first incoming (not the legacy `isNew` flag which was
            // always false under the webhook pre-store flow).
            vi.mocked(messagesService.isFirstIncomingMessage).mockResolvedValue(true);
            setupDbForMessage();

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(instagramService.sendDirectMessage).toHaveBeenCalledWith(
                'ig-1', 'sender-1', 'We are currently away', pageLinkedInstagramCredential(mockPage.accessToken),
            );
            expect(result.success).toBe(false);
            expect(result.error).toBe('Messages auto-reply disabled');
        });

        it('should not fail if away message sending fails', async () => {
            vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(false);
            vi.mocked(workspaceSettingsService.getAwayMessage).mockResolvedValue('Away');
            vi.mocked(instagramService.sendDirectMessage).mockRejectedValue(new Error('blocked'));
            vi.mocked(messagesService.isFirstIncomingMessage).mockResolvedValue(true);
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

        it('should mark message as replied with delivery_failed when DM sending fails', async () => {
            vi.mocked(instagramService.sendDirectMessage).mockRejectedValue(new Error('Cannot DM'));
            setupDbForMessage();

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to send reply');
            // Message should still be marked as replied with delivery_failed flag,
            // and the classified failure persisted in flag_meta — the row alone
            // must answer "failed WHY" (a plain Error classifies as 'unknown').
            expect(messagesService.markAsReplied).toHaveBeenCalledWith(
                'msg-uuid', expect.any(String), expect.any(String),
                true, 'delivery_failed',
                expect.toBeOneOf([expect.any(String), undefined]),
                undefined,
                expect.toBeOneOf([expect.any(String), undefined]),
                { dm_failed: { bucket: 'unknown' } },
            );
        });

        it('should catch and return unexpected errors', async () => {
            vi.mocked(pagesService.getPageByInstagramId).mockRejectedValue(new Error('timeout'));

            const result = await service.processMessage('ig-1', 'sender-1', 'hello', 'msg-1');

            expect(result.success).toBe(false);
            expect(result.error).toBe('timeout');
        });

        it('should skip reply when AI is disabled and no template matches', async () => {
            vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
                aiEnabled: false,
                commentsAutoReply: true,
                messagesAutoReply: true,
                replyDelay: 0,
                handoffPauseDurationMinutes: 30,
            } as any);
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
            // The success must clear THIS platform's send-failure streak (and only
            // this platform's) — the reset half of the FB-masks-dead-IG pin.
            expect(redis.del).toHaveBeenCalledWith('sendfail:page-uuid:instagram');
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
            // Notification should be skipped_reply (sent to whole workspace)
            expect(notificationService.sendTemplateNotificationToWorkspace).toHaveBeenCalledWith(
                'test_workspace_id',
                'skipped_reply',
                expect.objectContaining({ reason: 'offensive_or_abusive' }),
                expect.objectContaining({ type: 'message' }),
            );
            expect((await pipelineMetrics.getMetrics()).counters['instagram_message.skipped_risky']).toBe(1);
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
                pageLinkedInstagramCredential(mockPage.accessToken),
            );
            expect(messagesService.flagMessage).not.toHaveBeenCalled();
            expect(messagesService.markAsReplied).toHaveBeenCalled();

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
