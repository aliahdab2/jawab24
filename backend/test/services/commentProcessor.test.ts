import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commentProcessor } from '../../src/services/reply/commentProcessor';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';
import { messagesService } from '../../src/services/messages';
import { commentsService } from '../../src/services/comments';
import { replyGenerator, shouldSkipReply, shouldUseFallback, PRICE_FALLBACK } from '../../src/services/reply/generator';
import { rateLimiter, commentDebounce } from '../../src/services/protection';
import { pipelineMetrics } from '../../src/lib/pipelineMetrics';
import { notificationService } from '../../src/services/notifications';
import { publishSSEEvent } from '../../src/lib/eventBus';
import { acquireReplyLock } from '../../src/lib/replyLock';
import type { CommentPlatformAdapter, PlatformPage, ContentEntity, StoredComment, CommentReplyContext, SendCommentResult } from '../../src/interfaces';

vi.mock('../../src/services/workspaceSettings');
vi.mock('../../src/services/messages');
vi.mock('../../src/services/pages', () => ({
    pagesService: {},
    invalidateWorkspaceStatsCache: vi.fn(),
}));
vi.mock('../../src/services/reply/generator', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/services/reply/generator')>();
    return {
        ...actual,
        replyGenerator: {
            generateForComment: vi.fn(),
            setLogger: vi.fn(),
        },
    };
});
vi.mock('../../src/services/protection', () => ({
    rateLimiter: {
        check: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
        setLogger: vi.fn(),
    },
    commentDebounce: {
        isCoolingDown: vi.fn().mockResolvedValue(false),
        arm: vi.fn().mockResolvedValue(undefined),
        setLogger: vi.fn(),
    },
}));
vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: vi.fn().mockResolvedValue('notif-id'),
        sendTemplateNotificationToWorkspace: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../../src/utils/language', () => ({
    detectLanguageCode: vi.fn().mockReturnValue('en'),
    detectCommentLanguage: vi.fn().mockReturnValue('en'),
}));
vi.mock('../../src/services/comments', () => ({
    commentsService: {
        updateComment: vi.fn().mockResolvedValue(undefined),
        resolveComment: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), set: vi.fn(), quit: vi.fn(), incr: vi.fn(), expire: vi.fn() },
}));
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        enforceAutoReplyGate: vi.fn().mockResolvedValue({ allowed: true }),
    },
}));
vi.mock('../../src/lib/replyLock', () => ({
    acquireReplyLock: vi.fn().mockResolvedValue('mock-lock-token'),
    releaseReplyLock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/lib/eventBus', () => ({
    publishSSEEvent: vi.fn().mockResolvedValue(undefined),
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



// --- Mock adapter factory ---
function createMockAdapter(overrides: Partial<CommentPlatformAdapter> = {}): CommentPlatformAdapter {
    const mockPage: PlatformPage = {
        id: 'page-uuid',
        userId: 'user-uuid',
        workspaceId: 'test_workspace_id',
        name: 'Test Page',
        accessToken: 'token-123',
        knowledgeBase: null,
        kbActiveVersion: null,
        autoReplyEnabled: true,
    };

    const mockContent: ContentEntity = {
        id: 'content-uuid',
        autoReplyEnabled: true,
        message: 'Post body',
    };

    const mockComment: StoredComment = { id: 'comment-uuid', replied: false };

    return {
        platform: 'facebook',
        getPage: vi.fn().mockResolvedValue(mockPage),
        findOrCreateContent: vi.fn().mockResolvedValue(mockContent),
        storeComment: vi.fn().mockResolvedValue({ comment: mockComment, isNew: true }),
        sendReply: vi.fn().mockResolvedValue({ success: true }),
        markAsReplied: vi.fn().mockResolvedValue(undefined),
        buildGeneratorContext: vi.fn().mockReturnValue({
            workspaceId: 'test_workspace_id',
            userId: 'user-uuid',
            text: '',
            pageName: 'Test Page',
            pageId: 'page-uuid',
        } as CommentReplyContext),
        getFallbackReply: vi.fn().mockReturnValue(null),
        flagComment: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('CommentProcessor', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await pipelineMetrics.reset();

        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            commentsAutoReply: true,
            replyDelay: 0,
        } as any);
        vi.mocked(messagesService.isPaused).mockResolvedValue(false);
        // storeOutgoingMessage is called fire-and-forget in dual/private mode — give
        // it a resolved promise by default so the .catch() chain doesn't throw in tests.
        vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({} as any);
        vi.mocked(rateLimiter.check).mockResolvedValue({ allowed: true, count: 1 } as any);
        vi.mocked(commentDebounce.isCoolingDown).mockResolvedValue(false);
        vi.mocked(commentDebounce.arm).mockResolvedValue(undefined);
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'Thank you!',
            replyMethod: 'ai',
            needsAttention: false,
        });
    });

    it('should process a comment successfully end-to-end', async () => {
        const adapter = createMockAdapter();

        const result = await commentProcessor.processComment(
            adapter, 'platform-page-1', 'content-1', 'comment-1', 'Hello!', 'user-1', 'Alice',
        );

        expect(result.success).toBe(true);
        expect(result.commentId).toBe('comment-uuid');
        expect(result.replyText).toBe('Thank you!');
        expect(result.replyMethod).toBe('ai');
        expect(adapter.getPage).toHaveBeenCalledWith('platform-page-1');
        expect(adapter.findOrCreateContent).toHaveBeenCalledWith('page-uuid', 'content-1', 'token-123');
        expect(adapter.storeComment).toHaveBeenCalledWith('content-uuid', 'test_workspace_id', 'comment-1', 'Hello!', 'user-1', 'Alice', undefined);
        expect(adapter.sendReply).toHaveBeenCalled();
        expect(adapter.markAsReplied).toHaveBeenCalledWith(
            'comment-uuid', 'Thank you!', 'ai', 'en', false, undefined, undefined, 'Thank you!',
        );
        expect((await pipelineMetrics.getMetrics()).counters['facebook_comment.success']).toBe(1);
    });

    it('should return error when page not found', async () => {
        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue(null),
        });

        const result = await commentProcessor.processComment(
            adapter, 'bad-page', 'content-1', 'comment-1', 'Hello!',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Page not found');
        expect((await pipelineMetrics.getMetrics()).counters['facebook_comment.page_not_found']).toBe(1);
    });

    it('should return error when auto-reply disabled for page', async () => {
        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue({
                id: 'p', userId: 'u', workspaceId: 'test_workspace_id', name: 'N', accessToken: 't', knowledgeBase: null,
                autoReplyEnabled: false,
            }),
        });

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Auto-reply disabled for this page');
    });

    it('should return error when page has no user', async () => {
        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue({
                id: 'p', userId: null, workspaceId: 'test_workspace_id', name: 'N', accessToken: 't', knowledgeBase: null,
                autoReplyEnabled: true,
            }),
        });

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Page has no associated user');
    });

    it('should return error when page has no workspace', async () => {
        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue({
                id: 'p', userId: 'u', workspaceId: null, name: 'N', accessToken: 't', knowledgeBase: null,
                autoReplyEnabled: true,
            }),
        });

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Page has no associated workspace');
        expect((await pipelineMetrics.getMetrics()).counters['facebook_comment.no_workspace']).toBe(1);
    });

    it('should return error when content auto-reply disabled and still store comment', async () => {
        const storeComment = vi.fn().mockResolvedValue({ comment: { id: 'c', replied: false }, isNew: true });
        const adapter = createMockAdapter({
            findOrCreateContent: vi.fn().mockResolvedValue({ id: 'c-id', autoReplyEnabled: false, message: null }),
            storeComment,
        });

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'from-1', 'Bob',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Auto-reply disabled for this content');
        // Should still store the comment
        expect(storeComment).toHaveBeenCalledWith('c-id', 'test_workspace_id', 'comment-1', 'Hello!', 'from-1', 'Bob', undefined);
    });

    it('should return error when comments auto-reply disabled in settings', async () => {
        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(false);
        const adapter = createMockAdapter();

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Comments auto-reply disabled');
        // Comment should be stored before settings check
        expect(adapter.storeComment).toHaveBeenCalled();
    });

    it('should skip already replied comments', async () => {
        const adapter = createMockAdapter({
            storeComment: vi.fn().mockResolvedValue({
                comment: { id: 'c-uuid', replied: true },
                isNew: false,
            }),
        });

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Comment already replied');
    });

    it('should skip when handoff is active and return handoffDelayMs', async () => {
        vi.mocked(messagesService.isPaused).mockResolvedValue(true);
        vi.mocked(messagesService.getRemainingPauseMs).mockResolvedValue(120000); // 2 min remaining
        const adapter = createMockAdapter();

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'from-1',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Handoff active');
        expect(result.handoffDelayMs).toBe(125000); // remaining + 5s buffer
        expect(messagesService.getRemainingPauseMs).toHaveBeenCalledWith('page-uuid', 'from-1', undefined);
    });

    it('should use full pause duration as delay when getRemainingPauseMs returns 0', async () => {
        vi.mocked(messagesService.isPaused).mockResolvedValue(true);
        vi.mocked(messagesService.getRemainingPauseMs).mockResolvedValue(0);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            commentsAutoReply: true,
            replyDelay: 0,
            handoffPauseDurationMinutes: 15,
        } as any);
        const adapter = createMockAdapter();

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'from-1',
        );

        expect(result.success).toBe(false);
        expect(result.handoffDelayMs).toBe(15 * 60 * 1000); // full 15 min
    });

    it('should skip handoff check when fromId is missing', async () => {
        vi.mocked(messagesService.isPaused).mockResolvedValue(true); // Would block if called
        const adapter = createMockAdapter();

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!',
            // fromId omitted
        );

        // Should NOT check isPaused at all (no fromId)
        expect(messagesService.isPaused).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
    });

    it('should rate limit when count exceeds threshold', async () => {
        vi.mocked(rateLimiter.check).mockResolvedValue({ allowed: false, count: 6 } as any);
        const adapter = createMockAdapter();

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'from-1',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Rate limited');
    });

    describe('per-(page, post, sender) debounce', () => {
        it('skips with reason=debounced when same sender already replied to on same post within window', async () => {
            vi.mocked(commentDebounce.isCoolingDown).mockResolvedValueOnce(true);
            const adapter = createMockAdapter();

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-2', '..', 'from-1', 'Nano',
            );

            expect(result.success).toBe(true);
            expect(result.commentId).toBe('comment-uuid');
            expect(commentDebounce.isCoolingDown).toHaveBeenCalledWith('page-uuid', 'content-uuid', 'from-1');
            // No AI call, no platform reply, no markAsReplied
            expect(replyGenerator.generateForComment).not.toHaveBeenCalled();
            expect(adapter.sendReply).not.toHaveBeenCalled();
            expect(adapter.markAsReplied).not.toHaveBeenCalled();
            // Comment IS persisted (so it shows in inbox) and resolved
            expect(adapter.storeComment).toHaveBeenCalled();
            expect(commentsService.resolveComment).toHaveBeenCalledWith('comment-uuid');
            // SSE event with reason=debounced
            expect(publishSSEEvent).toHaveBeenCalledWith(
                'user-uuid',
                'comment:skipped',
                expect.objectContaining({ commentId: 'comment-uuid', reason: 'debounced' }),
            );
            // Metric records as debounce_skipped, NOT skipped_spam
            const counters = (await pipelineMetrics.getMetrics()).counters;
            expect(counters['facebook_comment.debounce_skipped']).toBe(1);
            expect(counters['facebook_comment.skipped_spam']).toBeUndefined();
        });

        it('a duplicate webhook for the SAME comment_id (after arm) defers to already_replied, not debounced', async () => {
            // Webhook A successfully replied; arm fired. Webhook B for the same
            // comment_id arrives — cooldown is hot, BUT storeComment returns the
            // existing replied=true row. Must hit already_replied, not debounce.
            vi.mocked(commentDebounce.isCoolingDown).mockResolvedValueOnce(true);
            const adapter = createMockAdapter({
                storeComment: vi.fn().mockResolvedValue({
                    comment: { id: 'comment-uuid', replied: true },
                    isNew: false,
                }),
            });

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'from-1',
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe('Comment already replied');
            // Should NOT emit comment:skipped with reason=debounced
            const skippedCalls = vi.mocked(publishSSEEvent).mock.calls
                .filter(c => c[1] === 'comment:skipped');
            expect(skippedCalls).toHaveLength(0);
            // Metric: already_replied, not debounce_skipped
            const counters = (await pipelineMetrics.getMetrics()).counters;
            expect(counters['facebook_comment.already_replied']).toBe(1);
            expect(counters['facebook_comment.debounce_skipped']).toBeUndefined();
        });

        it('keys the cooldown by (page, post, sender) — different sender on same post is not gated', async () => {
            const adapter = createMockAdapter();
            await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'sender-A', 'Alice',
            );
            await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-2', 'Hello!', 'sender-B', 'Bob',
            );
            // arm called with two distinct sender ids — same page, same post
            expect(commentDebounce.arm).toHaveBeenCalledWith('page-uuid', 'content-uuid', 'sender-A');
            expect(commentDebounce.arm).toHaveBeenCalledWith('page-uuid', 'content-uuid', 'sender-B');
        });

        it('arms the cooldown after a successful reply (per page/post/sender)', async () => {
            const adapter = createMockAdapter();

            await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'from-1', 'Alice',
            );

            expect(commentDebounce.arm).toHaveBeenCalledWith('page-uuid', 'content-uuid', 'from-1');
        });

        it('does not arm the cooldown when fromId is missing', async () => {
            const adapter = createMockAdapter();

            await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'Hello!',
                // fromId omitted
            );

            expect(commentDebounce.arm).not.toHaveBeenCalled();
        });

        it('does not check the debounce when fromId is missing', async () => {
            // If we somehow set isCoolingDown=true but fromId is absent, the gate
            // is skipped entirely — there is nothing to key on.
            vi.mocked(commentDebounce.isCoolingDown).mockResolvedValue(true);
            const adapter = createMockAdapter();

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'Hello!',
            );

            expect(commentDebounce.isCoolingDown).not.toHaveBeenCalled();
            expect(result.success).toBe(true);
        });

        it('does not check the debounce when comments auto-reply is disabled (settings_disabled path wins)', async () => {
            vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(false);
            vi.mocked(commentDebounce.isCoolingDown).mockResolvedValue(true);
            const adapter = createMockAdapter();

            await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'from-1',
            );

            expect(commentDebounce.isCoolingDown).not.toHaveBeenCalled();
        });
    });

    it('should use fallback reply when generator returns null and adapter has fallback', async () => {
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: null,
            replyMethod: 'ai',
        });
        const adapter = createMockAdapter({
            getFallbackReply: vi.fn().mockReturnValue('Thanks for commenting!'),
        });

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'from-1',
        );

        expect(result.success).toBe(true);
        expect(result.replyText).toBe('Thanks for commenting!');
        expect(adapter.sendReply).toHaveBeenCalled();
    });

    it('should return error when generator returns null and no fallback', async () => {
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: null,
            replyMethod: 'ai',
        });
        const adapter = createMockAdapter({
            getFallbackReply: vi.fn().mockReturnValue(null),
        });

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'from-1',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('No reply generated');
        expect(adapter.sendReply).not.toHaveBeenCalled();
    });

    it('should return error when sendReply fails', async () => {
        const adapter = createMockAdapter({
            sendReply: vi.fn().mockResolvedValue({ success: false, error: 'API error' }),
        });

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'from-1',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('API error');
        expect(adapter.markAsReplied).not.toHaveBeenCalled();
    });

    it('should notify when reply is flagged', async () => {
        const { notificationService } = await import('../../src/services/notifications');
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'Sorry about that.',
            replyMethod: 'ai',
            needsAttention: true,
            flagReason: 'angry_customer',
            aiIntent: 'COMPLAINT',
        });
        const adapter = createMockAdapter();

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Terrible!', 'from-1', 'Bob',
        );

        expect(notificationService.sendTemplateNotificationToWorkspace).toHaveBeenCalledWith(
            'test_workspace_id',
            'flagged_reply',
            expect.objectContaining({ senderName: 'Bob', reason: 'angry_customer' }),
            expect.objectContaining({ commentId: 'comment-uuid', type: 'comment' }),
        );
    });

    it('should NOT notify when reply is not flagged', async () => {
        const { notificationService } = await import('../../src/services/notifications');
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'Thank you!',
            replyMethod: 'template',
            needsAttention: false,
        });
        const adapter = createMockAdapter();

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Great!', 'from-1', 'Alice',
        );

        expect(notificationService.sendTemplateNotificationToWorkspace).not.toHaveBeenCalled();
    });

    it('should handle adapter errors gracefully', async () => {
        const adapter = createMockAdapter({
            getPage: vi.fn().mockRejectedValue(new Error('DB connection failed')),
        });

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('DB connection failed');
        expect((await pipelineMetrics.getMetrics()).counters['facebook_comment.error']).toBe(1);
    });

    it('should set commentMessage as text in generator context', async () => {
        const buildGeneratorContext = vi.fn().mockReturnValue({
            workspaceId: 'test_workspace_id', userId: 'user-uuid', text: '', pageName: 'Test', pageId: 'page-uuid',
        });
        const adapter = createMockAdapter({ buildGeneratorContext });

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'My specific comment text', 'from-1',
        );

        // The processor should override text with commentMessage
        expect(replyGenerator.generateForComment).toHaveBeenCalledWith(
            expect.objectContaining({ text: 'My specific comment text' }),
            expect.any(Boolean),
            expect.any(String),
        );
    });

    it('should work with instagram platform name for metrics', async () => {
        const adapter = createMockAdapter({ platform: 'instagram' as any });

        const result = await commentProcessor.processComment(
            adapter, 'ig-1', 'media-1', 'comment-1', 'Nice!', 'from-1',
        );

        expect(result.success).toBe(true);
        expect((await pipelineMetrics.getMetrics()).counters['instagram_comment.success']).toBe(1);
    });

    // --- Facebook message_tags plumbing ---

    it('passes messageTags + ourFacebookPageId to generator when the comment also tags our own page', async () => {
        // A user-tag alone is silently skipped before the generator runs (see
        // "Friend-tag silent skip" block below). To exercise the plumbing to the
        // generator, use a tag set that addresses our page — the skip is bypassed
        // and preprocessCommentText still needs the tag offsets to strip them
        // from the text before AI sees it.
        const buildGeneratorContext = vi.fn().mockReturnValue({
            workspaceId: 'test_workspace_id', userId: 'user-uuid', text: '', pageName: 'Test', pageId: 'page-uuid',
        });
        const adapter = createMockAdapter({ buildGeneratorContext });

        const tags = [
            { id: 'fb-page-1', name: 'Our Page', type: 'page' as const, offset: 0, length: 8 },
            { id: 'u1', name: 'Khadeja Alrefae', type: 'user' as const, offset: 9, length: 15 },
        ];

        await commentProcessor.processComment(
            adapter, 'fb-page-1', 'content-1', 'comment-1',
            'Our Page Khadeja Alrefae تفاصيل؟', 'from-1', 'Commenter', undefined, tags,
        );

        expect(replyGenerator.generateForComment).toHaveBeenCalledWith(
            expect.objectContaining({
                messageTags: tags,
                ourFacebookPageId: 'fb-page-1',
            }),
            expect.any(Boolean),
            expect.any(String),
        );
    });

    it('persists messageTags on the stored comment', async () => {
        const adapter = createMockAdapter();
        const tags = [
            { id: 'u1', name: 'Khadeja Alrefae', type: 'user' as const, offset: 0, length: 15 },
        ];

        await commentProcessor.processComment(
            adapter, 'fb-page-1', 'content-1', 'comment-1',
            'Khadeja Alrefae', 'from-1', 'Commenter', undefined, tags,
        );

        expect(adapter.storeComment).toHaveBeenCalledWith(
            'content-uuid', 'test_workspace_id', 'comment-1', 'Khadeja Alrefae',
            'from-1', 'Commenter', tags,
        );
    });

    it('emits comment:skipped with reason=friend_tag when a user-tag triggers silent skip', async () => {
        // Generator returns the silent-skip shape the user-tag rule produces today.
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: null, replyMethod: 'ai', aiIntent: 'SPAM_OR_IRRELEVANT', needsAttention: false,
        });
        const adapter = createMockAdapter();
        const tags = [
            { id: 'u1', name: 'Khadeja Alrefae', type: 'user' as const, offset: 0, length: 15 },
        ];

        await commentProcessor.processComment(
            adapter, 'fb-page-1', 'content-1', 'comment-1',
            'Khadeja Alrefae', 'from-1', 'Commenter', undefined, tags,
        );

        expect(commentsService.resolveComment).toHaveBeenCalledWith('comment-uuid');
        expect(publishSSEEvent).toHaveBeenCalledWith(
            'user-uuid',
            'comment:skipped',
            expect.objectContaining({
                commentId: 'comment-uuid',
                pageId: 'page-uuid',
                reason: 'friend_tag',
            }),
        );
    });

    it('emits comment:skipped with reason=spam when no user-tag is present (generic SPAM)', async () => {
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: null, replyMethod: 'ai', aiIntent: 'SPAM_OR_IRRELEVANT', needsAttention: false,
        });
        const adapter = createMockAdapter();

        await commentProcessor.processComment(
            adapter, 'fb-page-1', 'content-1', 'comment-1',
            '.', 'from-1', 'Commenter',
        );

        expect(publishSSEEvent).toHaveBeenCalledWith(
            'user-uuid',
            'comment:skipped',
            expect.objectContaining({ reason: 'spam' }),
        );
    });

    it('leaves ourFacebookPageId undefined for Instagram comments (no tag classification)', async () => {
        const adapter = createMockAdapter({ platform: 'instagram' as any });

        await commentProcessor.processComment(
            adapter, 'ig-1', 'media-1', 'comment-1', 'Nice!', 'from-1',
        );

        expect(replyGenerator.generateForComment).toHaveBeenCalledWith(
            expect.objectContaining({ ourFacebookPageId: undefined }),
            expect.any(Boolean),
            expect.any(String),
        );
    });

    // --- Offensive skip tests ---

    it('should skip reply for offensive_or_abusive flag and call flagComment', async () => {
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'Some AI reply',
            replyMethod: 'ai',
            needsAttention: true,
            flagReason: 'offensive_or_abusive',
            aiIntent: 'OFFENSIVE',
        });
        const adapter = createMockAdapter();

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'You are terrible!', 'from-1', 'Troll',
        );

        expect(result.success).toBe(true);
        expect(result.commentId).toBe('comment-uuid');
        // Reply should NOT be sent
        expect(adapter.sendReply).not.toHaveBeenCalled();
        expect(adapter.markAsReplied).not.toHaveBeenCalled();
        // flagComment should be called
        expect(adapter.flagComment).toHaveBeenCalledWith('comment-uuid', 'offensive_or_abusive', 'OFFENSIVE');
        // Notification should be skipped_reply
        expect(notificationService.sendTemplateNotificationToWorkspace).toHaveBeenCalledWith(
            'test_workspace_id',
            'skipped_reply',
            expect.objectContaining({ senderName: 'Troll', reason: 'offensive_or_abusive' }),
            expect.objectContaining({ commentId: 'comment-uuid', type: 'comment' }),
        );
        expect((await pipelineMetrics.getMetrics()).counters['facebook_comment.skipped_risky']).toBe(1);
    });

    it('should skip reply when AI intent is OFFENSIVE (case-insensitive)', async () => {
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'Some reply',
            replyMethod: 'ai',
            needsAttention: true,
            flagReason: 'offensive',
            aiIntent: 'Offensive', // mixed case
        });
        const adapter = createMockAdapter();

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Bad comment', 'from-1', 'User',
        );

        expect(result.success).toBe(true);
        expect(adapter.sendReply).not.toHaveBeenCalled();
        expect(adapter.flagComment).toHaveBeenCalled();
    });

    it('should NOT skip reply for angry_customer flag (keep auto-reply)', async () => {
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'Sorry about that.',
            replyMethod: 'ai',
            needsAttention: true,
            flagReason: 'angry_customer',
            aiIntent: 'COMPLAINT',
        });
        const adapter = createMockAdapter();

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Terrible service!', 'from-1', 'Bob',
        );

        expect(result.success).toBe(true);
        expect(adapter.sendReply).toHaveBeenCalled();
        expect(adapter.markAsReplied).toHaveBeenCalled();
        expect(adapter.flagComment).not.toHaveBeenCalled();
        // Should still notify as flagged_reply (not skipped)
        expect(notificationService.sendTemplateNotificationToWorkspace).toHaveBeenCalledWith(
            'test_workspace_id',
            'flagged_reply',
            expect.objectContaining({ senderName: 'Bob', reason: 'angry_customer' }),
            expect.any(Object),
        );
    });

    it('should skip reply for SPAM_OR_IRRELEVANT intent silently — no flag, no notification', async () => {
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: '',
            replyMethod: 'ai',
            needsAttention: true,
            flagReason: undefined,
            aiIntent: 'SPAM_OR_IRRELEVANT',
        });
        const adapter = createMockAdapter();

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', '🔥🔥 follow me @spam', 'from-1', 'Spammer',
        );

        expect(result.success).toBe(true);
        expect(adapter.sendReply).not.toHaveBeenCalled();
        expect(adapter.markAsReplied).not.toHaveBeenCalled();
        // Spam/irrelevant (tagging someone, emoji-only, etc.) should NOT flag or notify
        expect(adapter.flagComment).not.toHaveBeenCalled();
    });

    // --- Price fallback tests ---

    it('should replace AI text with safe fallback for price_not_in_kb flag', async () => {
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'The price is $99!',  // hallucinated price
            replyMethod: 'ai',
            needsAttention: true,
            flagReason: 'price_not_in_kb',
            aiIntent: 'PURCHASE_INTENT',
        });
        const adapter = createMockAdapter();

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'How much?', 'from-1', 'Lead',
        );

        expect(result.success).toBe(true);
        // Reply IS sent (not skipped), but with safe fallback text + DM CTA (PURCHASE_INTENT in public mode)
        const sendCall = vi.mocked(adapter.sendReply).mock.calls[0][0];
        expect(sendCall.replyText).toContain(PRICE_FALLBACK['en']);
        expect(adapter.flagComment).not.toHaveBeenCalled(); // not offensive
        expect(adapter.markAsReplied).toHaveBeenCalled();
    });

    // --- Duplicate webhook guard tests ---

    it('should skip already-flagged comments on duplicate webhook', async () => {
        const adapter = createMockAdapter({
            storeComment: vi.fn().mockResolvedValue({
                comment: { id: 'c-uuid', replied: false, needsAttention: true },
                isNew: false,
            }),
        });

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Offensive!', 'from-1',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Comment already replied');
        // Should NOT call AI again
        expect(replyGenerator.generateForComment).not.toHaveBeenCalled();
        // Should NOT send another notification
        expect(notificationService.sendTemplateNotificationToWorkspace).not.toHaveBeenCalled();
    });

    // --- Business profile enrichment tests ---

    it('should append business profile to knowledgeBase when page has businessProfile', async () => {
        const mockPage: PlatformPage = {
            id: 'page-uuid',
            userId: 'user-uuid',
            workspaceId: 'test_workspace_id',
            name: 'Test Page',
            accessToken: 'token-123',
            knowledgeBase: 'We sell shoes.',
            kbActiveVersion: null,
            autoReplyEnabled: true,
            businessProfile: {
                phone: '+961 1 234 567',
                address: '123 Main St',
                city: 'Beirut',
                hours: { mon: ['09:00-18:00'], tue: ['09:00-18:00'] },
            },
        };

        const buildGeneratorContext = vi.fn().mockReturnValue({
            workspaceId: 'test_workspace_id',
            userId: 'user-uuid',
            text: '',
            pageName: 'Test Page',
            knowledgeBase: 'We sell shoes.',
            pageId: 'page-uuid',
        } as CommentReplyContext);

        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue(mockPage),
            buildGeneratorContext,
        });

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'What are your hours?', 'from-1',
        );

        const generatorCall = vi.mocked(replyGenerator.generateForComment).mock.calls[0];
        const contextArg = generatorCall[0];
        expect(contextArg.knowledgeBase).toContain('We sell shoes.');
        expect(contextArg.knowledgeBase).toContain('--- Business Info ---');
        expect(contextArg.knowledgeBase).toContain('Phone: +961 1 234 567');
        expect(contextArg.knowledgeBase).toContain('Location: 123 Main St, Beirut');
        expect(contextArg.knowledgeBase).toContain('Monday: 09:00-18:00');
    });

    it('should use business profile as sole KB when page has no knowledgeBase', async () => {
        const mockPage: PlatformPage = {
            id: 'page-uuid',
            userId: 'user-uuid',
            workspaceId: 'test_workspace_id',
            name: 'Test Page',
            accessToken: 'token-123',
            knowledgeBase: null,
            kbActiveVersion: null,
            autoReplyEnabled: true,
            businessProfile: {
                category: 'Restaurant',
                phone: '+1 555 0000',
            },
        };

        const buildGeneratorContext = vi.fn().mockReturnValue({
            workspaceId: 'test_workspace_id',
            userId: 'user-uuid',
            text: '',
            pageName: 'Test Page',
            knowledgeBase: undefined,
            pageId: 'page-uuid',
        } as CommentReplyContext);

        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue(mockPage),
            buildGeneratorContext,
        });

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'from-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForComment).mock.calls[0][0];
        expect(contextArg.knowledgeBase).toContain('Business type: Restaurant');
        expect(contextArg.knowledgeBase).toContain('Phone: +1 555 0000');
        // No separator when there's no preceding KB text
        expect(contextArg.knowledgeBase).not.toContain('--- Business Info ---');
    });

    it('should NOT modify knowledgeBase when businessProfile is empty object', async () => {
        const mockPage: PlatformPage = {
            id: 'page-uuid',
            userId: 'user-uuid',
            workspaceId: 'test_workspace_id',
            name: 'Test Page',
            accessToken: 'token-123',
            knowledgeBase: 'We sell shoes.',
            kbActiveVersion: null,
            autoReplyEnabled: true,
            businessProfile: {},
        };

        const buildGeneratorContext = vi.fn().mockReturnValue({
            workspaceId: 'test_workspace_id',
            userId: 'user-uuid',
            text: '',
            pageName: 'Test Page',
            knowledgeBase: 'We sell shoes.',
            pageId: 'page-uuid',
        } as CommentReplyContext);

        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue(mockPage),
            buildGeneratorContext,
        });

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'from-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForComment).mock.calls[0][0];
        expect(contextArg.knowledgeBase).toBe('We sell shoes.');
    });

    it('should NOT modify knowledgeBase when businessProfile is null/undefined', async () => {
        const adapter = createMockAdapter(); // default mock page has no businessProfile

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'from-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForComment).mock.calls[0][0];
        // Default mock buildGeneratorContext returns no knowledgeBase
        expect(contextArg.knowledgeBase).toBeUndefined();
    });

    // --- Existing behavior preservation tests ---

    it('should send reply even with low_confidence flag (low confidence is better than no reply)', async () => {
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'Hmm, I think...',
            replyMethod: 'ai',
            needsAttention: true,
            flagReason: 'low_confidence',
        });
        const adapter = createMockAdapter();

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Complex question', 'from-1', 'User',
        );

        expect(result.success).toBe(true);
        // low_confidence reply IS sent — better than leaving the customer unanswered
        expect(adapter.sendReply).toHaveBeenCalled();
    });

    // --- Reply length enforcement tests ---

    it('should truncate AI reply exceeding 280 chars before sending', async () => {
        const longReply = 'Thank you so much for your wonderful question about our products and services. We have a wide variety of items available in our store including electronics, clothing, accessories, and home goods. Our dedicated team is always ready to help you find exactly what you need at the best possible price.';
        expect(longReply.length).toBeGreaterThan(280); // verify test data

        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: longReply,
            replyMethod: 'ai',
            needsAttention: false,
            aiIntent: 'COMPLIMENT',
        });
        const adapter = createMockAdapter();

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Your store is great!', 'from-1',
        );

        expect(result.success).toBe(true);
        // The sent reply should be truncated
        const sendCall = vi.mocked(adapter.sendReply).mock.calls[0][0];
        expect(sendCall.replyText.length).toBeLessThanOrEqual(500);
    });

    it('should NOT truncate AI reply under 500 chars', async () => {
        const shortReply = 'Thank you for your kind words!';

        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: shortReply,
            replyMethod: 'ai',
            needsAttention: false,
            aiIntent: 'COMPLIMENT',
        });
        const adapter = createMockAdapter();

        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Great page!', 'from-1',
        );

        expect(result.success).toBe(true);
        const sendCall = vi.mocked(adapter.sendReply).mock.calls[0][0];
        expect(sendCall.replyText).toBe(shortReply);
    });

    // --- Public comment should NOT append DM CTA (no DM is sent in public mode) ---

    it('should NOT append DM CTA for QUESTION intent in public mode', async () => {
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'Great question!',
            replyMethod: 'ai',
            needsAttention: false,
            aiIntent: 'QUESTION',
        });
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            commentReplyMode: 'public',
        } as any);
        const adapter = createMockAdapter();

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'What are your hours?', 'from-1',
        );

        const sendCall = vi.mocked(adapter.sendReply).mock.calls[0][0];
        expect(sendCall.replyText).toBe('Great question!');
        expect(sendCall.replyText).not.toContain('Send us a message');
    });

    it('should NOT append Arabic DM CTA for QUESTION intent with Arabic comment', async () => {
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'شكراً لسؤالك!',
            replyMethod: 'ai',
            needsAttention: false,
            aiIntent: 'QUESTION',
        });
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            commentReplyMode: 'public',
        } as any);
        const adapter = createMockAdapter();

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'كم سعر المنتج؟', 'from-1',
        );

        const sendCall = vi.mocked(adapter.sendReply).mock.calls[0][0];
        expect(sendCall.replyText).toBe('شكراً لسؤالك!');
        expect(sendCall.replyText).not.toContain('راسلنا على الخاص');
    });

    it('should NOT append DM CTA when AI reply already mentions DM', async () => {
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'Great question! Send us a DM for details.',
            replyMethod: 'ai',
            needsAttention: false,
            aiIntent: 'QUESTION',
        });
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            commentReplyMode: 'public',
        } as any);
        const adapter = createMockAdapter();

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'What is the price?', 'from-1',
        );

        const sendCall = vi.mocked(adapter.sendReply).mock.calls[0][0];
        // Should NOT double-append
        expect(sendCall.replyText).toBe('Great question! Send us a DM for details.');
    });

    it('should NOT append DM CTA for COMPLIMENT intent', async () => {
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'Thank you so much!',
            replyMethod: 'ai',
            needsAttention: false,
            aiIntent: 'COMPLIMENT',
        });
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            commentReplyMode: 'public',
        } as any);
        const adapter = createMockAdapter();

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Love your products!', 'from-1',
        );

        const sendCall = vi.mocked(adapter.sendReply).mock.calls[0][0];
        expect(sendCall.replyText).toBe('Thank you so much!');
        expect(sendCall.replyText).not.toContain('Send us a message');
    });

    it('should NOT append DM CTA in dual mode (DM already sent)', async () => {
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'Great question!',
            replyMethod: 'ai',
            needsAttention: false,
            aiIntent: 'QUESTION',
        });
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            commentReplyMode: 'dual',
        } as any);
        const adapter = createMockAdapter();

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'What are your hours?', 'from-1',
        );

        const sendCall = vi.mocked(adapter.sendReply).mock.calls[0][0];
        expect(sendCall.replyText).toBe('Great question!');
        expect(sendCall.replyText).not.toContain('Send us a message');
    });

    it('should NOT append DM CTA for PURCHASE_INTENT in public mode', async () => {
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'We would love to help you with your order!',
            replyMethod: 'ai',
            needsAttention: false,
            aiIntent: 'PURCHASE_INTENT',
        });
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            commentReplyMode: 'public',
        } as any);
        const adapter = createMockAdapter();

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'I want to buy this!', 'from-1',
        );

        const sendCall = vi.mocked(adapter.sendReply).mock.calls[0][0];
        expect(sendCall.replyText).toBe('We would love to help you with your order!');
        expect(sendCall.replyText).not.toContain('Send us a message');
    });
});

// --- Pure helper function tests ---

describe('shouldSkipReply', () => {
    it('should return true for offensive_or_abusive flag', () => {
        expect(shouldSkipReply('offensive_or_abusive')).toBe(true);
    });

    it('should return true for offensive flag without intent', () => {
        expect(shouldSkipReply('offensive')).toBe(true);
    });

    it('should return true for OFFENSIVE intent', () => {
        expect(shouldSkipReply(undefined, 'OFFENSIVE')).toBe(true);
    });

    it('should return true for mixed case intent', () => {
        expect(shouldSkipReply(undefined, 'Offensive')).toBe(true);
        expect(shouldSkipReply(undefined, ' offensive ')).toBe(true);
    });

    it('should return false for angry_customer flag', () => {
        expect(shouldSkipReply('angry_customer')).toBe(false);
    });

    it('should return false for COMPLAINT intent', () => {
        expect(shouldSkipReply(undefined, 'COMPLAINT')).toBe(false);
    });

    it('should return false when no flags and no intent', () => {
        expect(shouldSkipReply()).toBe(false);
        expect(shouldSkipReply(undefined, undefined)).toBe(false);
    });

    it('should handle comma-separated flags', () => {
        // offensive_or_abusive triggers skip regardless of other flags
        expect(shouldSkipReply('low_confidence,offensive_or_abusive')).toBe(true);
        // low_confidence + angry_customer — neither is a skip flag
        expect(shouldSkipReply('low_confidence,angry_customer')).toBe(false);
    });

    it('should trim whitespace around flags', () => {
        expect(shouldSkipReply(' offensive_or_abusive ')).toBe(true);
        expect(shouldSkipReply('low_confidence, offensive_or_abusive')).toBe(true);
    });
});

describe('CommentProcessor — fromName fallback fetch', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await pipelineMetrics.reset();

        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            commentsAutoReply: true,
            replyDelay: 0,
        } as any);
        vi.mocked(messagesService.isPaused).mockResolvedValue(false);
        vi.mocked(rateLimiter.check).mockResolvedValue({ allowed: true, count: 1 } as any);
        vi.mocked(commentDebounce.isCoolingDown).mockResolvedValue(false);
        vi.mocked(commentDebounce.arm).mockResolvedValue(undefined);
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'Thank you!',
            replyMethod: 'ai',
            needsAttention: false,
        });
    });

    it('should call fetchCommenterName when fromName is missing and update the comment in DB', async () => {
        const fetchCommenterName = vi.fn().mockResolvedValue('Fetched Ali');
        const adapter = createMockAdapter({ fetchCommenterName });

        await commentProcessor.processComment(
            adapter, 'platform-page-1', 'content-1', 'comment-1', 'Hello!', 'user-1',
            // fromName intentionally omitted
        );

        expect(fetchCommenterName).toHaveBeenCalledWith('comment-1', 'token-123');
        expect(commentsService.updateComment).toHaveBeenCalledWith('comment-uuid', { fromName: 'Fetched Ali' });
    });

    it('should NOT call fetchCommenterName when fromName is already provided', async () => {
        const fetchCommenterName = vi.fn().mockResolvedValue('Fetched Ali');
        const adapter = createMockAdapter({ fetchCommenterName });

        await commentProcessor.processComment(
            adapter, 'platform-page-1', 'content-1', 'comment-1', 'Hello!', 'user-1', 'Alice',
        );

        expect(fetchCommenterName).not.toHaveBeenCalled();
    });

    it('should NOT call fetchCommenterName when adapter does not implement it', async () => {
        const adapter = createMockAdapter();
        // Ensure no fetchCommenterName on the adapter
        expect(adapter.fetchCommenterName).toBeUndefined();

        // Should still process successfully without error
        const result = await commentProcessor.processComment(
            adapter, 'platform-page-1', 'content-1', 'comment-1', 'Hello!', 'user-1',
        );

        expect(result.success).toBe(true);
    });

    it('should continue processing even if fetchCommenterName throws', async () => {
        const fetchCommenterName = vi.fn().mockRejectedValue(new Error('API down'));
        const adapter = createMockAdapter({ fetchCommenterName });

        const result = await commentProcessor.processComment(
            adapter, 'platform-page-1', 'content-1', 'comment-1', 'Hello!', 'user-1',
        );

        expect(result.success).toBe(true);
        expect(fetchCommenterName).toHaveBeenCalled();
    });
});

describe('shouldUseFallback', () => {
    it('should return true for price_not_in_kb flag', () => {
        expect(shouldUseFallback('price_not_in_kb')).toBe(true);
    });

    it('should return false for offensive_or_abusive flag', () => {
        expect(shouldUseFallback('offensive_or_abusive')).toBe(false);
    });

    it('should return false when no flag', () => {
        expect(shouldUseFallback()).toBe(false);
        expect(shouldUseFallback(undefined)).toBe(false);
    });

    it('should handle comma-separated flags', () => {
        expect(shouldUseFallback('low_confidence,price_not_in_kb')).toBe(true);
    });
});

describe('CommentProcessor — subscription inactive', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await pipelineMetrics.reset();

        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            commentsAutoReply: true,
            replyDelay: 0,
        } as any);
    });

    it('should skip reply when subscription is inactive', async () => {
        const { subscriptionsService } = await import('../../src/services/subscriptions');
        vi.mocked(subscriptionsService.enforceAutoReplyGate).mockResolvedValue({ allowed: false, reason: 'Subscription is canceled' });

        const adapter = createMockAdapter();
        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'بيشتغل بسوريا؟', 'user-1', 'Anas',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Subscription inactive');
        expect(adapter.sendReply).not.toHaveBeenCalled();
        expect((await pipelineMetrics.getMetrics()).counters['facebook_comment.subscription_inactive']).toBe(1);
    });

    it('should still process comment when subscription is active', async () => {
        const { subscriptionsService } = await import('../../src/services/subscriptions');
        vi.mocked(subscriptionsService.enforceAutoReplyGate).mockResolvedValue({ allowed: true });

        const adapter = createMockAdapter();
        const result = await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'user-1', 'Alice',
        );

        expect(result.success).toBe(true);
        expect(adapter.sendReply).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// CommentProcessor — template reply mode behavior
// Verifies that the correct reply text reaches sendReply in each of the
// 3 comment reply modes (public / private / dual).
// ---------------------------------------------------------------------------

describe('CommentProcessor — template reply mode behavior', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await pipelineMetrics.reset();
        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(messagesService.isPaused).mockResolvedValue(false);
        // Default mock so fire-and-forget .catch() chain doesn't blow up
        vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({} as any);
        vi.mocked(rateLimiter.check).mockResolvedValue({ allowed: true, count: 1 } as any);
        vi.mocked(commentDebounce.isCoolingDown).mockResolvedValue(false);
        vi.mocked(commentDebounce.arm).mockResolvedValue(undefined);

        // Template match returns the price redirect text (old-style template)
        vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
            replyText: 'للاطلاع على الرسوم يرجى مراسلتنا على الخاص 💰',
            replyMethod: 'ai',
            needsAttention: false,
        });
    });

    function settingsWithMode(mode: 'public' | 'private' | 'dual') {
        return {
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            commentsAutoReply: true,
            replyDelay: 0,
            commentReplyMode: mode,
            dualReplyNudge: 'تم إرسال التفاصيل 📩',
            dualReplyNudgeVariations: null,
        } as any;
    }

    it('public mode — sendReply receives the template text directly', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue(settingsWithMode('public'));
        const adapter = createMockAdapter();

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'كم سعر الدورة؟', 'user-1',
        );

        expect(adapter.sendReply).toHaveBeenCalledWith(
            expect.objectContaining({
                replyText: 'للاطلاع على الرسوم يرجى مراسلتنا على الخاص 💰',
                userSettings: expect.objectContaining({ commentReplyMode: 'public' }),
            }),
        );
    });

    it('private mode — sendReply receives the template text (sent as DM by sender)', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue(settingsWithMode('private'));
        const adapter = createMockAdapter();

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'كم سعر الدورة؟', 'user-1',
        );

        expect(adapter.sendReply).toHaveBeenCalledWith(
            expect.objectContaining({
                replyText: 'للاطلاع على الرسوم يرجى مراسلتنا على الخاص 💰',
                userSettings: expect.objectContaining({ commentReplyMode: 'private' }),
            }),
        );
    });

    it('dual mode — sendReply receives template text as DM body; sender posts nudge publicly', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue(settingsWithMode('dual'));
        const adapter = createMockAdapter();

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'كم سعر الدورة؟', 'user-1',
        );

        // Processor passes full template text to sendReply — sender handles splitting
        // (DM gets full text, public comment gets dualReplyNudge — tested in sender.test.ts)
        expect(adapter.sendReply).toHaveBeenCalledWith(
            expect.objectContaining({
                replyText: 'للاطلاع على الرسوم يرجى مراسلتنا على الخاص 💰',
                userSettings: expect.objectContaining({ commentReplyMode: 'dual' }),
            }),
        );
    });

    // Regression: comment-triggered DMs (dual/private mode) used to create conversations
    // with null senderName because fromName — known at webhook time — wasn't passed to
    // storeOutgoingMessage. Surfaced as "Unknown User" in the dashboard inbox.
    it('dual mode — storeOutgoingMessage receives fromName so conversation gets the commenter name', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue(settingsWithMode('dual'));
        const adapter = createMockAdapter({
            sendReply: vi.fn().mockResolvedValue({ success: true, dmRecipientId: 'psid-12345' }),
        });

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'كم السعر؟', 'from-id-7', 'Ali Ahdab',
        );

        expect(messagesService.storeOutgoingMessage).toHaveBeenCalledWith(
            'page-uuid',
            'test_workspace_id',
            'psid-12345',
            expect.any(String),
            'ai',
            undefined,
            'Ali Ahdab',
            'content-uuid',
        );
    });

    it('dual mode — passes undefined fromName through when the webhook did not supply one', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue(settingsWithMode('dual'));
        const adapter = createMockAdapter({
            sendReply: vi.fn().mockResolvedValue({ success: true, dmRecipientId: 'psid-99999' }),
        });

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'كم السعر؟', 'from-id-7',
        );

        const call = vi.mocked(messagesService.storeOutgoingMessage).mock.calls[0];
        // 6th positional arg is senderName; missing → undefined
        expect(call[5]).toBeUndefined();
    });

    // Regression: follow-up DMs on a comment-originated conversation used to lose post
    // context because conversations had no link back to the post. See messageProcessor
    // path for the consumer side. Here we verify the link is persisted on every comment→DM.
    it('dual mode — storeOutgoingMessage receives contentId so follow-up DMs can inherit post context', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue(settingsWithMode('dual'));
        const adapter = createMockAdapter({
            sendReply: vi.fn().mockResolvedValue({ success: true, dmRecipientId: 'psid-12345' }),
        });

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'كم السعر؟', 'from-id-7', 'Ali Ahdab',
        );

        const call = vi.mocked(messagesService.storeOutgoingMessage).mock.calls[0];
        // 8th positional arg is originContentId
        expect(call[7]).toBe('content-uuid');
    });

    it('private mode — storeOutgoingMessage also receives contentId (same rule)', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue(settingsWithMode('private'));
        const adapter = createMockAdapter({
            sendReply: vi.fn().mockResolvedValue({ success: true, dmRecipientId: 'psid-private' }),
        });

        await commentProcessor.processComment(
            adapter, 'page-1', 'content-1', 'comment-1', 'كم السعر؟', 'from-id-7', 'Ali Ahdab',
        );

        const call = vi.mocked(messagesService.storeOutgoingMessage).mock.calls[0];
        expect(call[7]).toBe('content-uuid');
    });

    it('all 3 modes — generateForComment is called with the correct commentReplyMode', async () => {
        for (const mode of ['public', 'private', 'dual'] as const) {
            vi.clearAllMocks();
            vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
            vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue(settingsWithMode(mode));
            vi.mocked(messagesService.isPaused).mockResolvedValue(false);
            vi.mocked(rateLimiter.check).mockResolvedValue({ allowed: true, count: 1 } as any);
        vi.mocked(commentDebounce.isCoolingDown).mockResolvedValue(false);
        vi.mocked(commentDebounce.arm).mockResolvedValue(undefined);
            vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
                replyText: 'reply text',
                replyMethod: 'ai',
                needsAttention: false,
            });

            const adapter = createMockAdapter();
            await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'سؤال؟', 'user-1',
            );

            expect(replyGenerator.generateForComment).toHaveBeenCalledWith(
                expect.anything(),
                true,
                mode,
            );
        }
    });

    describe('Post trigger + preset reply fallthrough', () => {
        it('should fall through to preset replies when trigger keyword does not match', async () => {
            const adapter = createMockAdapter({
                findOrCreateContent: vi.fn().mockResolvedValue({
                    id: 'content-uuid',
                    autoReplyEnabled: true,
                    message: 'Post body',
                    triggerKeyword: 'سجّل',
                    triggerReply: 'مرحباً! سجّل عبر الرابط...',
                }),
            });

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'وين العنوان', 'user-1', 'Ali',
            );

            // Should NOT return early — should fall through to generator
            expect(replyGenerator.generateForComment).toHaveBeenCalled();
            expect(result.success).toBe(true);
        });

        it('should use trigger reply when keyword matches (not fall through)', async () => {
            const adapter = createMockAdapter({
                findOrCreateContent: vi.fn().mockResolvedValue({
                    id: 'content-uuid',
                    autoReplyEnabled: true,
                    message: 'Post body',
                    triggerKeyword: 'سجّل',
                    triggerReply: 'مرحباً! سجّل عبر الرابط...',
                }),
            });

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'سجّل', 'user-1', 'Ali',
            );

            // Should use trigger reply directly, NOT call generator
            expect(replyGenerator.generateForComment).not.toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(result.replyText).toBe('مرحباً! سجّل عبر الرابط...');
        });

        it('trigger match emits comment:received before reply_sent so frontend cache stays in sync', async () => {
            const adapter = createMockAdapter({
                findOrCreateContent: vi.fn().mockResolvedValue({
                    id: 'content-uuid',
                    autoReplyEnabled: true,
                    message: 'Post body',
                    triggerKeyword: 'سجّل',
                    triggerReply: 'مرحباً!',
                }),
            });

            await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'سجّل', 'user-1', 'Ali',
            );

            // Both events should fire, and comment:received must come first so the
            // comment is in the cache when reply_sent tries to patch it.
            const calls = vi.mocked(publishSSEEvent).mock.calls;
            const receivedIdx = calls.findIndex(c => c[1] === 'comment:received');
            const replySentIdx = calls.findIndex(c => c[1] === 'comment:reply_sent');
            expect(receivedIdx).toBeGreaterThanOrEqual(0);
            expect(replySentIdx).toBeGreaterThan(receivedIdx);
        });

        it('trigger path — storeOutgoingMessage receives contentId for follow-up DM context', async () => {
            vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue(settingsWithMode('dual'));
            const adapter = createMockAdapter({
                findOrCreateContent: vi.fn().mockResolvedValue({
                    id: 'content-uuid',
                    autoReplyEnabled: true,
                    message: 'Post body',
                    triggerKeyword: 'سجّل',
                    triggerReply: 'مرحباً!',
                }),
                sendReply: vi.fn().mockResolvedValue({ success: true, dmRecipientId: 'psid-trigger' }),
            });

            await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'سجّل', 'user-1', 'Ali',
            );

            const call = vi.mocked(messagesService.storeOutgoingMessage).mock.calls[0];
            expect(call[7]).toBe('content-uuid');
        });
    });

    describe('Reply-to-all scope', () => {
        it('replyToAll=true with no keywords sends triggerReply to every comment, AI bypassed', async () => {
            const adapter = createMockAdapter({
                findOrCreateContent: vi.fn().mockResolvedValue({
                    id: 'content-uuid',
                    autoReplyEnabled: true,
                    message: 'Post body',
                    triggerKeyword: null,
                    triggerReply: 'اتصل بنا: 0935924472',
                    replyToAll: true,
                }),
            });

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'بالتوفيق 🌹', 'user-1', 'Ali',
            );

            expect(replyGenerator.generateForComment).not.toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(result.replyText).toBe('اتصل بنا: 0935924472');
        });

        it('replyToAll=true with keywords: matching comment uses keyword scope', async () => {
            const adapter = createMockAdapter({
                findOrCreateContent: vi.fn().mockResolvedValue({
                    id: 'content-uuid',
                    autoReplyEnabled: true,
                    message: 'Post body',
                    triggerKeyword: 'سعر',
                    triggerReply: 'السعر 25 ألف',
                    replyToAll: true,
                }),
            });

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'كم السعر', 'user-1', 'Ali',
            );

            expect(replyGenerator.generateForComment).not.toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(result.replyText).toBe('السعر 25 ألف');
        });

        it('replyToAll=true with keywords: non-matching comment still gets triggerReply (all-scope), AI bypassed', async () => {
            const adapter = createMockAdapter({
                findOrCreateContent: vi.fn().mockResolvedValue({
                    id: 'content-uuid',
                    autoReplyEnabled: true,
                    message: 'Post body',
                    triggerKeyword: 'سعر',
                    triggerReply: 'السعر 25 ألف',
                    replyToAll: true,
                }),
            });

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'بالتوفيق 🌹', 'user-1', 'Ali',
            );

            expect(replyGenerator.generateForComment).not.toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(result.replyText).toBe('السعر 25 ألف');
        });

        it('replyToAll=false (default) with no keywords does NOT send the trigger — falls through to AI', async () => {
            const adapter = createMockAdapter({
                findOrCreateContent: vi.fn().mockResolvedValue({
                    id: 'content-uuid',
                    autoReplyEnabled: true,
                    message: 'Post body',
                    triggerKeyword: null,
                    triggerReply: 'اتصل بنا',
                    replyToAll: false,
                }),
            });

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'hello', 'user-1', 'Ali',
            );

            expect(replyGenerator.generateForComment).toHaveBeenCalled();
            expect(result.success).toBe(true);
        });

        it('replyToAll=true respects per-(page, post, sender) debounce — second comment from same sender no-ops', async () => {
            vi.mocked(commentDebounce.isCoolingDown).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

            const adapter = createMockAdapter({
                findOrCreateContent: vi.fn().mockResolvedValue({
                    id: 'content-uuid',
                    autoReplyEnabled: true,
                    message: 'Post body',
                    triggerKeyword: null,
                    triggerReply: 'اتصل بنا: 0935924472',
                    replyToAll: true,
                }),
            });

            // First comment from sender → reply sent
            await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'مرحبا', 'sender-1', 'Ali',
            );
            expect(adapter.sendReply).toHaveBeenCalledTimes(1);

            // Second comment from same sender (debounce now active) → no reply
            await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-2', 'سؤال آخر', 'sender-1', 'Ali',
            );
            expect(adapter.sendReply).toHaveBeenCalledTimes(1);
            expect(replyGenerator.generateForComment).not.toHaveBeenCalled();
        });

        it('replyToAll=true is gated by isCommentsEnabled — when comments auto-reply is off, no reply is sent', async () => {
            vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
                id: 'settings-uuid',
                userId: 'user-uuid',
                aiEnabled: true,
                commentsAutoReply: false,
                replyDelay: 0,
            } as any);
            vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(false);

            const adapter = createMockAdapter({
                findOrCreateContent: vi.fn().mockResolvedValue({
                    id: 'content-uuid',
                    autoReplyEnabled: true,
                    message: 'Post body',
                    triggerKeyword: null,
                    triggerReply: 'اتصل بنا',
                    replyToAll: true,
                }),
            });

            await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'hello', 'user-1', 'Ali',
            );

            expect(adapter.sendReply).not.toHaveBeenCalled();
            expect(replyGenerator.generateForComment).not.toHaveBeenCalled();
        });
    });

    describe('Friend-tag silent skip — runs before trigger-keyword branch', () => {
        const userTagOnly = [
            { type: 'user' as const, id: 'tagged-user-1', name: 'Ali Ahdab', offset: 0, length: 10 },
        ];

        it('skips user-tag comment even when it would match a trigger keyword', async () => {
            const adapter = createMockAdapter({
                findOrCreateContent: vi.fn().mockResolvedValue({
                    id: 'content-uuid',
                    autoReplyEnabled: true,
                    message: 'Post body',
                    triggerKeyword: 'تفاصيل',
                    triggerReply: 'تم إرسال التفاصيل على الخاص 📩',
                }),
            });

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'Ali Ahdab تفاصيل', 'noor-psid', 'Noor', undefined,
                userTagOnly,
            );

            expect(result.success).toBe(true);
            // Neither trigger nor AI path should fire
            expect(replyGenerator.generateForComment).not.toHaveBeenCalled();
            expect(adapter.sendReply).not.toHaveBeenCalled();
            expect(adapter.markAsReplied).not.toHaveBeenCalled();
            // Comment is stored + resolved so the UI auto-dismisses it
            expect(adapter.storeComment).toHaveBeenCalled();
            expect(commentsService.resolveComment).toHaveBeenCalledWith('comment-uuid');
            // SSE event for the frontend cache
            const skippedCall = vi.mocked(publishSSEEvent).mock.calls.find(c => c[1] === 'comment:skipped');
            expect(skippedCall).toBeDefined();
            expect(skippedCall?.[2]).toMatchObject({ reason: 'friend_tag' });
        });

        it('skips user-tag comment on a post with no trigger keyword configured', async () => {
            const adapter = createMockAdapter();

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'Ali Ahdab', 'noor-psid', 'Noor', undefined,
                userTagOnly,
            );

            expect(result.success).toBe(true);
            expect(replyGenerator.generateForComment).not.toHaveBeenCalled();
            expect(adapter.sendReply).not.toHaveBeenCalled();
            expect(commentsService.resolveComment).toHaveBeenCalledWith('comment-uuid');
        });

        it('does NOT skip when the comment also tags our own page (commenter is addressing us)', async () => {
            const adapter = createMockAdapter({
                findOrCreateContent: vi.fn().mockResolvedValue({
                    id: 'content-uuid',
                    autoReplyEnabled: true,
                    message: 'Post body',
                    triggerKeyword: 'تفاصيل',
                    triggerReply: 'تم الإرسال',
                }),
            });

            const tags = [
                { type: 'page' as const, id: 'platform-page-1', name: 'Our Page', offset: 0, length: 8 },
                { type: 'user' as const, id: 'tagged-user-1', name: 'Ali Ahdab', offset: 9, length: 10 },
            ];

            await commentProcessor.processComment(
                adapter, 'platform-page-1', 'content-1', 'comment-1', 'Our Page Ali Ahdab تفاصيل', 'noor-psid', 'Noor', undefined,
                tags,
            );

            // Trigger fires normally — friend-tag skip is bypassed because we're addressed
            expect(adapter.sendReply).toHaveBeenCalled();
            // comment:skipped with friend_tag should NOT be emitted
            const skippedCall = vi.mocked(publishSSEEvent).mock.calls
                .find(c => c[1] === 'comment:skipped' && (c[2] as any)?.reason === 'friend_tag');
            expect(skippedCall).toBeUndefined();
        });

        it('Instagram comment is unaffected by the friend-tag check (no messageTags on IG webhooks)', async () => {
            const adapter = createMockAdapter({ platform: 'instagram' });

            await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'Hello!', 'user-1', 'Alice',
            );

            // Normal AI path runs
            expect(replyGenerator.generateForComment).toHaveBeenCalled();
            expect(adapter.sendReply).toHaveBeenCalled();
        });
    });

    describe('Graph API enrichment — recover tags the webhook dropped', () => {
        // Facebook Page feed webhooks inconsistently omit message_tags for
        // comments that DO carry a structured user tag. The pipeline falls
        // back to Graph API when the webhook is silent AND the text is not
        // confidently not-a-tag (short bare name, no punctuation). Confirmed
        // on prod 2026-04-20 with the Ali-Ahdab case on Graph API v23.0.

        const graphTags = [
            { type: 'user' as const, id: 'tagged-user-1', name: 'Ali Ahdab', offset: 0, length: 9 },
        ];

        it('fetches tags from Graph API when webhook omitted them for a bare-name comment', async () => {
            const fetchCommentWithTags = vi.fn().mockResolvedValue({
                message: 'Ali Ahdab', message_tags: graphTags,
            });
            const adapter = createMockAdapter({
                fetchCommentWithTags,
                findOrCreateContent: vi.fn().mockResolvedValue({
                    id: 'content-uuid', autoReplyEnabled: true, message: 'Post body',
                    triggerKeyword: 'تفاصيل', triggerReply: 'تم الإرسال',
                }),
            });

            const result = await commentProcessor.processComment(
                adapter, 'platform-page-1', 'content-1', 'comment-1',
                'Ali Ahdab', 'noor-psid', 'Noor',
                // no messageTags from webhook
            );

            expect(result.success).toBe(true);
            expect(fetchCommentWithTags).toHaveBeenCalledWith('comment-1', 'token-123');
            // Guard uses the fetched tags → silent skip → no reply
            expect(replyGenerator.generateForComment).not.toHaveBeenCalled();
            expect(adapter.sendReply).not.toHaveBeenCalled();
            const skippedCall = vi.mocked(publishSSEEvent).mock.calls
                .find(c => c[1] === 'comment:skipped' && (c[2] as any)?.reason === 'friend_tag');
            expect(skippedCall).toBeDefined();
        });

        it('does NOT fetch when webhook already included tags (short-circuit)', async () => {
            const fetchCommentWithTags = vi.fn();
            const adapter = createMockAdapter({ fetchCommentWithTags });

            await commentProcessor.processComment(
                adapter, 'platform-page-1', 'content-1', 'comment-1',
                'Ali Ahdab تفاصيل', 'noor-psid', 'Noor', undefined,
                graphTags,
            );

            expect(fetchCommentWithTags).not.toHaveBeenCalled();
        });

        it('does NOT fetch when the comment is confidently not a tag (has a question)', async () => {
            const fetchCommentWithTags = vi.fn();
            const adapter = createMockAdapter({ fetchCommentWithTags });

            await commentProcessor.processComment(
                adapter, 'platform-page-1', 'content-1', 'comment-1',
                'شو السعر؟', 'noor-psid', 'Noor',
            );

            expect(fetchCommentWithTags).not.toHaveBeenCalled();
            // Normal AI flow continues
            expect(replyGenerator.generateForComment).toHaveBeenCalled();
        });

        it('does NOT fetch for Instagram comments (platform gate)', async () => {
            const fetchCommentWithTags = vi.fn();
            const adapter = createMockAdapter({ platform: 'instagram', fetchCommentWithTags });

            await commentProcessor.processComment(
                adapter, 'ig-page-1', 'media-1', 'comment-1',
                'Ali Ahdab', 'user-1', 'Alice',
            );

            expect(fetchCommentWithTags).not.toHaveBeenCalled();
        });

        it('gracefully continues when Graph API fetch fails (fail-open for the reply decision)', async () => {
            // Per product decision: if enrichment fails we let the comment
            // proceed through the normal AI path rather than block. The AI
            // preprocess has its own tag/mention handling.
            const fetchCommentWithTags = vi.fn().mockResolvedValue(null);
            const adapter = createMockAdapter({ fetchCommentWithTags });

            const result = await commentProcessor.processComment(
                adapter, 'platform-page-1', 'content-1', 'comment-1',
                'Ali Ahdab', 'noor-psid', 'Noor',
            );

            expect(result.success).toBe(true);
            expect(fetchCommentWithTags).toHaveBeenCalled();
            // Guard can't fire (no tags) → pipeline continues to AI
            expect(replyGenerator.generateForComment).toHaveBeenCalled();
        });

        it('uses Graph API tags when they return empty (genuine non-tag comment)', async () => {
            // Bare-name comment that isn't actually tagged — Graph returns
            // no message_tags. The friend-tag guard should not fire.
            const fetchCommentWithTags = vi.fn().mockResolvedValue({
                message: 'Sarah', message_tags: [],
            });
            const adapter = createMockAdapter({ fetchCommentWithTags });

            await commentProcessor.processComment(
                adapter, 'platform-page-1', 'content-1', 'comment-1',
                'Sarah', 'user-1', 'Customer',
            );

            expect(fetchCommentWithTags).toHaveBeenCalled();
            // No tag → continues to AI path
            expect(replyGenerator.generateForComment).toHaveBeenCalled();
        });
    });

    describe('Silent skip — SPAM_OR_IRRELEVANT comments are resolved, not left pending', () => {
        it('should call resolveComment and not flagComment when AI returns SPAM_OR_IRRELEVANT', async () => {
            const adapter = createMockAdapter();

            vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
                replyText: null,
                replyMethod: 'ai',
                aiIntent: 'SPAM_OR_IRRELEVANT',
                needsAttention: false,
            });

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', '.', 'user-1', 'Walaa',
            );

            expect(result.success).toBe(true);
            // Should resolve the comment so it doesn't show as "pending" forever
            expect(commentsService.resolveComment).toHaveBeenCalledWith('comment-uuid');
            // Should NOT flag it — silent skip means no merchant notification
            expect(adapter.flagComment).not.toHaveBeenCalled();
        });
    });

    describe('Store routing — skip preset replies for store pages', () => {
        it('should skip template matching when page has ecommerceStoreId', async () => {
            const adapter = createMockAdapter({
                getPage: vi.fn().mockResolvedValue({
                    id: 'page-uuid',
                    userId: 'user-uuid',
                    workspaceId: 'test_workspace_id',
                    name: 'Store Page',
                    accessToken: 'token-123',
                    knowledgeBase: null,
                    kbActiveVersion: null,
                    autoReplyEnabled: true,
                    ecommerceStoreId: 'store-uuid',
                }),
                buildGeneratorContext: vi.fn().mockReturnValue({
                    workspaceId: 'test_workspace_id',
                    userId: 'user-uuid',
                    text: '',
                    pageName: 'Store Page',
                    pageId: 'page-uuid',
                    ecommerceStoreId: 'store-uuid',
                }),
            });

            vi.mocked(replyGenerator.generateForComment).mockResolvedValue({
                replyText: 'AI reply with product info',
                replyMethod: 'ai',
                needsAttention: false,
            });

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'كم السعر', 'user-1', 'Ali',
            );

            expect(result.success).toBe(true);
            // Generator should be called with ecommerceStoreId in context
            expect(replyGenerator.generateForComment).toHaveBeenCalledWith(
                expect.objectContaining({ ecommerceStoreId: 'store-uuid' }),
                expect.anything(),
                expect.anything(),
            );
        });
    });

    describe('Pending-state invariants — no comment left as Pending silently', () => {
        // Regression guards for the class of bugs where a pipeline exit returned
        // { success: false } without touching the DB, leaving comments stuck as
        // "Waiting to reply" in the merchant UI. Every exit below must either
        // resolve or flag the comment.

        it('trigger-match acquires per-comment lock and bails on contention', async () => {
            // Duplicate webhook race: worker A holds the lock; worker B must bail
            // BEFORE calling Graph API so we don't send a duplicate reply that
            // Facebook rejects (leaving the comment stuck at replied=false).
            vi.mocked(acquireReplyLock).mockResolvedValueOnce(null);

            const adapter = createMockAdapter({
                findOrCreateContent: vi.fn().mockResolvedValue({
                    id: 'content-uuid', autoReplyEnabled: true, message: 'Post body',
                    triggerKeyword: 'سجّل', triggerReply: 'مرحباً!',
                }),
            });

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'سجّل', 'user-1', 'Ali',
            );

            expect(adapter.sendReply).not.toHaveBeenCalled();
            expect(result).toMatchObject({ success: false, error: 'Lock held by another worker' });
            expect((await pipelineMetrics.getMetrics()).counters['facebook_comment.lock_contention']).toBe(1);
        });

        it('trigger-match short-circuits when comment already replied', async () => {
            // A delayed duplicate or BullMQ retry must not re-send the reply.
            const adapter = createMockAdapter({
                findOrCreateContent: vi.fn().mockResolvedValue({
                    id: 'content-uuid', autoReplyEnabled: true, message: 'Post body',
                    triggerKeyword: 'سجّل', triggerReply: 'مرحباً!',
                }),
                storeComment: vi.fn().mockResolvedValue({
                    comment: { id: 'comment-uuid', replied: true, needsAttention: false },
                    isNew: false,
                }),
            });

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'سجّل', 'user-1', 'Ali',
            );

            expect(adapter.sendReply).not.toHaveBeenCalled();
            expect(result).toMatchObject({ success: false, error: 'Comment already replied' });
        });

        it('sendAndFinalize flags needsAttention when Graph API send fails', async () => {
            // Previously: send fails → comment stays replied=false/needsAttention=false
            // → shows as Pending forever. Now: flagComment surfaces it in Needs Attention.
            const adapter = createMockAdapter({
                sendReply: vi.fn().mockResolvedValue({ success: false, error: 'rate limited by Graph API' }),
            });

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'Hello', 'user-1', 'Alice',
            );

            // Plain send failure (no dmFailure) flags with generic 'send_failed' key + null meta.
            // autoResolve is false: no bucket → page owner should still see it in Needs Attention.
            expect(adapter.flagComment).toHaveBeenCalledWith('comment-uuid', 'send_failed', undefined, null, false);
            expect(result.success).toBe(false);
            const failedCall = vi.mocked(publishSSEEvent).mock.calls
                .find(c => c[1] === 'comment:reply_failed');
            expect(failedCall).toBeDefined();
        });

        it('sendAndFinalize flags dm_failed with bucket + FB error code in flag_meta on DM failure', async () => {
            const adapter = createMockAdapter({
                sendReply: vi.fn().mockResolvedValue({
                    success: false,
                    error: 'DM failed: window_expired',
                    dmFailure: {
                        bucket: 'window_expired',
                        code: 10,
                        subcode: 2018278,
                        fbMessage: 'This message is sent outside of allowed window.',
                        rawMessage: 'Error validating access token',
                    },
                }),
            });

            await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'Hello', 'user-1', 'Alice',
            );

            expect(adapter.flagComment).toHaveBeenCalledWith(
                'comment-uuid',
                'dm_failed',
                undefined,
                {
                    dm_failed: {
                        bucket: 'window_expired',
                        code: 10,
                        subcode: 2018278,
                        fbMessage: 'This message is sent outside of allowed window.',
                    },
                },
                false,  // window_expired stays actionable in Needs Attention (only customer_refused auto-resolves)
            );
        });

        it('sendAndFinalize auto-resolves on customer_refused so page owner inbox stays clean', async () => {
            const adapter = createMockAdapter({
                sendReply: vi.fn().mockResolvedValue({
                    success: false,
                    error: 'DM failed: customer_refused',
                    dmFailure: {
                        bucket: 'customer_refused',
                        code: 10903,
                        subcode: 1893062,
                        fbMessage: 'This user can\'t reply to this activity',
                        rawMessage: 'OAuthException',
                    },
                }),
            });

            await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'Hello', 'user-1', 'Alice',
            );

            // autoResolve=true: still records flag_reason + flag_meta for analytics, but
            // skips Needs Attention (the page owner can't fix what FB blocks anyway).
            expect(adapter.flagComment).toHaveBeenCalledWith(
                'comment-uuid',
                'dm_failed',
                undefined,
                expect.objectContaining({
                    dm_failed: expect.objectContaining({ bucket: 'customer_refused' }),
                }),
                true,
            );
        });

        it('empty AI reply with no adapter fallback flags for attention', async () => {
            vi.mocked(replyGenerator.generateForComment).mockResolvedValueOnce({
                replyText: null as unknown as string,
                replyMethod: 'ai',
                needsAttention: false,
            });
            const adapter = createMockAdapter({
                getFallbackReply: vi.fn().mockReturnValue(null),
            });

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'ping', 'user-1', 'Alice',
            );

            expect(adapter.flagComment).toHaveBeenCalledWith('comment-uuid', 'no_reply_generated', undefined);
            expect(adapter.sendReply).not.toHaveBeenCalled();
            expect(result).toMatchObject({ success: false, error: 'No reply generated' });
        });

        it('rate-limited comment resolves silently + emits comment:skipped', async () => {
            // Spammer protection: don't reply, don't leave the comment sitting in
            // the merchant's "Needs Action" bucket — rate limit exists to prevent
            // that noise in the first place.
            vi.mocked(rateLimiter.check).mockResolvedValueOnce({ allowed: false, count: 11 });

            const adapter = createMockAdapter();

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'spam', 'spammer-psid', 'Spammer',
            );

            expect(adapter.sendReply).not.toHaveBeenCalled();
            expect(commentsService.resolveComment).toHaveBeenCalledWith('comment-uuid');
            const skippedCall = vi.mocked(publishSSEEvent).mock.calls
                .find(c => c[1] === 'comment:skipped');
            expect(skippedCall).toBeDefined();
            expect(skippedCall?.[2]).toMatchObject({
                reason: 'spam',
                flagReason: 'rate_limited',
            });
            expect(result).toMatchObject({ success: false, error: 'Rate limited' });
        });

        it('workspace auto-reply disabled after store resolves + emits comment:skipped', async () => {
            // Comment is stored so the merchant can still see it in the inbox,
            // but the pipeline exit must resolve — not leave it as "Pending".
            vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValueOnce(false);

            const adapter = createMockAdapter();

            const result = await commentProcessor.processComment(
                adapter, 'page-1', 'content-1', 'comment-1', 'Hello', 'user-1', 'Alice',
            );

            expect(adapter.storeComment).toHaveBeenCalled();
            expect(commentsService.resolveComment).toHaveBeenCalledWith('comment-uuid');
            const skippedCall = vi.mocked(publishSSEEvent).mock.calls
                .find(c => c[1] === 'comment:skipped');
            expect(skippedCall).toBeDefined();
            expect(skippedCall?.[2]).toMatchObject({
                reason: 'spam',
                flagReason: 'comments_auto_reply_disabled',
            });
            expect(adapter.sendReply).not.toHaveBeenCalled();
            expect(result).toMatchObject({ success: false, error: 'Comments auto-reply disabled' });
        });
    });
});
