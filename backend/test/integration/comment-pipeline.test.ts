import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommentProcessor } from '../../src/services/reply/commentProcessor';
import { postsService } from '../../src/services/posts';
import { commentsService } from '../../src/services/comments';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';
import { pipelineMetrics } from '../../src/lib/pipelineMetrics';
import { createTestUser, createTestWorkspace, createTestPage, insertPost, insertComment, insertPause, testDb } from './setup';
import { eq } from 'drizzle-orm';
import { comments } from '../../src/db/schema';
import type { CommentPlatformAdapter, PlatformPage, ContentEntity, CommentReplyContext } from '../../src/interfaces';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mock adapter that stubs external calls (sendReply) but delegates all DB
 * writes to real services — mirroring the pattern in pipeline.test.ts.
 */
function createMockAdapter(
    page: PlatformPage,
    overrides: Partial<CommentPlatformAdapter> = {},
): CommentPlatformAdapter {
    return {
        platform: 'facebook',
        getPage: vi.fn().mockResolvedValue(page),
        findOrCreateContent: vi.fn(async (pageId: string, postId: string): Promise<ContentEntity> => {
            const post = await postsService.findOrCreateFromWebhook(pageId, postId, undefined);
            return {
                id: post.id,
                autoReplyEnabled: post.autoReplyEnabled ?? true,
                message: post.message,
            };
        }),
        storeComment: vi.fn(async (postId, workspaceId, commentId, message, fromId, fromName) => {
            const { comment, isNew } = await commentsService.findOrCreateFromWebhook(
                postId, workspaceId, commentId, message, fromId, fromName,
            );
            return {
                comment: { id: comment.id, replied: comment.replied ?? false, needsAttention: comment.needsAttention ?? false },
                isNew,
            };
        }),
        renderReply: vi.fn((text: string) => text),
        sendReply: vi.fn().mockResolvedValue({ success: true }),
        markAsReplied: vi.fn(async (commentId, replyText, replyMethod, detectedLanguage, needsAttention, flagReason, aiIntent, aiOriginalReply) => {
            await commentsService.markAsReplied(
                commentId, replyText, replyMethod, detectedLanguage,
                needsAttention, flagReason, aiIntent, aiOriginalReply,
            );
        }),
        buildGeneratorContext: vi.fn((p: PlatformPage, _content: ContentEntity, contentId: string): CommentReplyContext => ({
            workspaceId: p.workspaceId!,
            userId: p.userId!,
            text: '',
            pageName: p.name || undefined,
            pageId: p.id,
            postId: contentId,
        })),
        getFallbackReply: vi.fn().mockReturnValue(null),
        flagComment: vi.fn(async (commentId, flagReason, aiIntent) => {
            await commentsService.updateComment(commentId, {
                needsAttention: true,
                flagReason: flagReason ?? null,
                aiIntent: aiIntent ?? null,
            });
        }),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Mocks: external services only — DB services run against real Postgres
// ---------------------------------------------------------------------------

const { mockGenerateForComment } = vi.hoisted(() => ({
    mockGenerateForComment: vi.fn().mockResolvedValue({
        replyText: 'Mocked AI reply',
        replyMethod: 'ai' as const,
        needsAttention: false,
        flagReason: undefined,
        aiIntent: 'GREETING',
    }),
}));

vi.mock('../../src/services/protection', () => ({
    rateLimiter: {
        check: vi.fn().mockResolvedValue({ allowed: true, count: 0 }),
        setLogger: vi.fn(),
    },
    commentDebounce: {
        // #400 replaced the check-then-arm (isCoolingDown/arm) design with an
        // atomic claim: tryAcquire returns a token when the slot is won (proceed)
        // or null when already held (debounce); release frees it on a non-send
        // terminal outcome. Default: always win the slot.
        tryAcquire: vi.fn().mockResolvedValue('debounce-token'),
        release: vi.fn().mockResolvedValue(undefined),
        setLogger: vi.fn(),
    },
    postReplyCap: {
        isOverCap: vi.fn().mockResolvedValue(false),
        increment: vi.fn().mockResolvedValue(undefined),
        setLogger: vi.fn(),
    },
}));

vi.mock('../../src/services/reply/generator', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/services/reply/generator')>();
    return {
        ...actual,
        replyGenerator: {
            generateForComment: mockGenerateForComment,
            setLogger: vi.fn(),
        },
    };
});

vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: vi.fn().mockResolvedValue(undefined),
        sendTemplateNotificationToWorkspace: vi.fn().mockResolvedValue(undefined),
    },
}));

// Reply lock (Redis-backed) — always grant lock
vi.mock('../../src/lib/replyLock', () => ({
    acquireReplyLock: vi.fn().mockResolvedValue('mock-lock-token'),
    releaseReplyLock: vi.fn().mockResolvedValue(undefined),
}));

// Subscription check — always active (subscription logic tested elsewhere)
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        enforceAutoReplyGate: vi.fn().mockResolvedValue({ allowed: true }),
    },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Comment Pipeline — Integration (real Postgres)', () => {
    let processor: CommentProcessor;
    let userId: string;
    let workspaceId: string;
    let pageId: string;
    let facebookPageId: string;
    let platformPage: PlatformPage;
    const fromId = 'sender-comment-test';
    const fromName = 'Test User';

    beforeEach(async () => {
        processor = new CommentProcessor();
        pipelineMetrics.reset();
        mockGenerateForComment.mockClear();
        // Defensive reset — vi.clearAllMocks() doesn't reset implementations.
        // Tests that override the debounce mock would otherwise leak.
        const { commentDebounce } = await import('../../src/services/protection');
        vi.mocked(commentDebounce.tryAcquire).mockReset().mockResolvedValue('debounce-token');
        vi.mocked(commentDebounce.release).mockReset().mockResolvedValue(undefined);
        mockGenerateForComment.mockResolvedValue({
            replyText: 'Mocked AI reply',
            replyMethod: 'ai' as const,
            needsAttention: false,
            flagReason: undefined,
            aiIntent: 'GREETING',
        });

        const user = await createTestUser();
        userId = user.id;
        const workspace = await createTestWorkspace(userId);
        workspaceId = workspace.id;
        facebookPageId = `page-fb-comment-${Date.now()}`;
        const page = await createTestPage(userId, { facebookPageId, autoReplyEnabled: true, workspaceId });
        pageId = page.id;

        platformPage = {
            id: page.id,
            userId: page.userId,
            workspaceId: page.workspaceId,
            name: page.name,
            accessToken: page.accessToken,
            knowledgeBase: null,
            kbActiveVersion: null,
            autoReplyEnabled: true,
        };

        // Ensure workspace settings exist with comments auto-reply ON
        await workspaceSettingsService.updateSettings(workspaceId, { commentsAutoReply: true });
    });

    // =========================================================
    // 1. Happy path: new comment → stored → replied
    // =========================================================
    it('processes a new comment end-to-end: stores post+comment, replies, marks as replied', async () => {
        const adapter = createMockAdapter(platformPage);
        const platformPostId = 'post-fb-happy-001';
        const platformCommentId = 'comment-fb-happy-001';

        const result = await processor.processComment(
            adapter, facebookPageId, platformPostId, platformCommentId,
            'What are your hours?', fromId, fromName,
        );

        expect(result.success).toBe(true);
        expect(result.replyText).toBe('Mocked AI reply');
        expect(result.replyMethod).toBe('ai');

        // Verify comment was stored and marked as replied in DB
        const [row] = await testDb
            .select()
            .from(comments)
            .where(eq(comments.facebookCommentId, platformCommentId));
        expect(row).toBeDefined();
        expect(row.message).toBe('What are your hours?');
        expect(row.fromId).toBe(fromId);
        expect(row.fromName).toBe(fromName);
        expect(row.replied).toBe(true);
        expect(row.replyText).toBe('Mocked AI reply');
        expect(row.replyMethod).toBe('ai');
        expect(row.repliedAt).toBeTruthy();
        // Denormalized workspace_id must land on stored comments — Deploy 1 goal.
        expect(row.workspaceId).toBe(workspaceId);

        // Verify adapter.sendReply was called once
        expect(adapter.sendReply).toHaveBeenCalledOnce();

        // Verify pipeline metric recorded success
        const metrics = await pipelineMetrics.getMetrics();
        expect(metrics.counters['facebook_comment.success']).toBe(1);
    });

    // =========================================================
    // 2. Already replied: duplicate webhook skips
    // =========================================================
    it('skips reply when comment is already marked as replied', async () => {
        // Pre-insert a post and a comment that is already replied
        const post = await insertPost(pageId, { facebookPostId: 'post-fb-dup-001' });
        await insertComment(post.id, {
            facebookCommentId: 'comment-fb-dup-001',
            message: 'Already answered',
            replied: true,
        });

        const adapter = createMockAdapter(platformPage, {
            storeComment: vi.fn().mockResolvedValue({
                comment: { id: 'comment-uuid', replied: true, needsAttention: false },
                isNew: false,
            }),
        });

        const result = await processor.processComment(
            adapter, facebookPageId, 'post-fb-dup-001', 'comment-fb-dup-001',
            'Already answered', fromId, fromName,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('already replied');
        expect(adapter.sendReply).not.toHaveBeenCalled();
        expect(mockGenerateForComment).not.toHaveBeenCalled();
    });

    // =========================================================
    // 3. Comments auto-reply disabled → stores but skips reply
    // =========================================================
    it('stores comment but skips reply when comments auto-reply is disabled', async () => {
        await workspaceSettingsService.updateSettings(workspaceId, { commentsAutoReply: false });

        const adapter = createMockAdapter(platformPage);

        const result = await processor.processComment(
            adapter, facebookPageId, 'post-fb-disabled-001', 'comment-fb-disabled-001',
            'Hello!', fromId, fromName,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('disabled');
        expect(adapter.sendReply).not.toHaveBeenCalled();

        // Comment SHOULD still be stored in DB
        const [row] = await testDb
            .select()
            .from(comments)
            .where(eq(comments.facebookCommentId, 'comment-fb-disabled-001'));
        expect(row).toBeDefined();
        expect(row.replied).toBe(false);
    });

    // =========================================================
    // 4. Paused conversation skips auto-reply
    // =========================================================
    it('skips reply when conversation is paused (handoff active)', async () => {
        const futureDate = new Date(Date.now() + 30 * 60 * 1000);
        await insertPause(pageId, fromId, futureDate);

        const adapter = createMockAdapter(platformPage);

        const result = await processor.processComment(
            adapter, facebookPageId, 'post-fb-pause-001', 'comment-fb-pause-001',
            'Hello!', fromId, fromName,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Handoff active');
        expect(result.handoffDelayMs).toBeGreaterThan(0);
        expect(adapter.sendReply).not.toHaveBeenCalled();
    });

    // =========================================================
    // 5. Offensive comment → flagged in DB, no reply sent
    // =========================================================
    it('flags offensive comment in DB and does NOT send a reply', async () => {
        mockGenerateForComment.mockResolvedValueOnce({
            replyText: 'Some generated reply',
            replyMethod: 'ai' as const,
            needsAttention: true,
            flagReason: 'offensive_or_abusive',
            aiIntent: 'OFFENSIVE',
        });

        const adapter = createMockAdapter(platformPage);

        const result = await processor.processComment(
            adapter, facebookPageId, 'post-fb-offensive-001', 'comment-fb-offensive-001',
            'Go away!', fromId, fromName,
        );

        // Pipeline treats this as success (comment processed, not an error)
        expect(result.success).toBe(true);
        // Reply must NOT be sent
        expect(adapter.sendReply).not.toHaveBeenCalled();

        // Comment should be flagged in DB
        const [row] = await testDb
            .select()
            .from(comments)
            .where(eq(comments.facebookCommentId, 'comment-fb-offensive-001'));
        expect(row).toBeDefined();
        expect(row.replied).toBe(false);
        expect(row.needsAttention).toBe(true);
        expect(row.flagReason).toBe('offensive_or_abusive');

        // Metric recorded
        const metrics = await pipelineMetrics.getMetrics();
        expect(metrics.counters['facebook_comment.skipped_risky']).toBe(1);
    });

    // =========================================================
    // 6. Access token forwarded to findOrCreateContent
    // =========================================================
    it('passes page accessToken to findOrCreateContent so post message can be fetched', async () => {
        const findOrCreateContent = vi.fn(async (_pageId: string, _postId: string, accessToken?: string): Promise<ContentEntity> => {
            const post = await postsService.findOrCreateFromWebhook(_pageId, _postId, undefined, accessToken);
            return {
                id: post.id,
                autoReplyEnabled: post.autoReplyEnabled ?? true,
                message: post.message,
            };
        });

        const adapter = createMockAdapter(platformPage, { findOrCreateContent });

        await processor.processComment(
            adapter, facebookPageId, 'post-fb-token-001', 'comment-fb-token-001',
            'Hello!', fromId, fromName,
        );

        expect(findOrCreateContent).toHaveBeenCalledWith(
            pageId,
            'post-fb-token-001',
            platformPage.accessToken,
        );
    });

    // =========================================================
    // 7. Punctuation-only comment, no post message → silent skip
    // =========================================================
    it('silently resolves a punctuation-only comment when post has no message', async () => {
        mockGenerateForComment.mockResolvedValueOnce({
            replyText: null,
            replyMethod: 'ai' as const,
            needsAttention: false,
            flagReason: undefined,
            aiIntent: 'SPAM_OR_IRRELEVANT',
        });

        const adapter = createMockAdapter(platformPage, {
            findOrCreateContent: vi.fn().mockResolvedValue({
                id: (await postsService.findOrCreateFromWebhook(pageId, 'post-fb-dot-001', undefined)).id,
                autoReplyEnabled: true,
                message: null,
            }),
        });

        const result = await processor.processComment(
            adapter, facebookPageId, 'post-fb-dot-001', 'comment-fb-dot-001',
            '.', fromId, fromName,
        );

        expect(result.success).toBe(true);
        expect(adapter.sendReply).not.toHaveBeenCalled();

        const metrics = await pipelineMetrics.getMetrics();
        expect(metrics.counters['facebook_comment.skipped_spam']).toBe(1);
    });

    // =========================================================
    // 8. Punctuation-only comment, post HAS message → AI reply sent
    // =========================================================
    it('sends AI reply for punctuation-only comment when post has an engagement message', async () => {
        const post = await postsService.findOrCreateFromWebhook(
            pageId, 'post-fb-dot-engagement-001', 'علق لتصلك الأسعار',
        );

        const adapter = createMockAdapter(platformPage, {
            findOrCreateContent: vi.fn().mockResolvedValue({
                id: post.id,
                autoReplyEnabled: true,
                message: 'علق لتصلك الأسعار',
            }),
        });

        const result = await processor.processComment(
            adapter, facebookPageId, 'post-fb-dot-engagement-001', 'comment-fb-dot-engagement-001',
            '.', fromId, fromName,
        );

        expect(result.success).toBe(true);
        expect(result.replyText).toBe('Mocked AI reply');
        expect(adapter.sendReply).toHaveBeenCalledOnce();
    });

    // =========================================================
    // 9. Price hallucination → safe fallback text sent
    // =========================================================
    it('replaces hallucinated price with safe fallback text', async () => {
        mockGenerateForComment.mockResolvedValueOnce({
            replyText: 'It costs only $9999!',
            replyMethod: 'ai' as const,
            needsAttention: true,
            flagReason: 'price_not_in_kb',
            aiIntent: 'PURCHASE_INTENT',
        });

        const adapter = createMockAdapter(platformPage);

        const result = await processor.processComment(
            adapter, facebookPageId, 'post-fb-price-001', 'comment-fb-price-001',
            'How much does it cost?', fromId, fromName,
        );

        expect(result.success).toBe(true);
        expect(adapter.sendReply).toHaveBeenCalledOnce();
        // Should NOT contain the hallucinated price
        expect(result.replyText).not.toContain('$9999');
        // Should be the safe fallback
        expect(result.replyText).toContain('Thank you for your interest');

        // Verify marked as replied in DB with fallback text
        const [row] = await testDb
            .select()
            .from(comments)
            .where(eq(comments.facebookCommentId, 'comment-fb-price-001'));
        expect(row.replied).toBe(true);
        expect(row.replyText).toContain('Thank you for your interest');
        expect(row.needsAttention).toBe(true);
        expect(row.flagReason).toBe('price_not_in_kb');
    });

    // =========================================================
    // Post Reply (per-post keyword trigger): persists reply_method='post_reply',
    // not 'template'. The dashboard 'Smart Replies' counter sums only ai —
    // bucketing trigger sends as 'template' would conflate them with AI fallbacks
    // and contradict the AI quota-exhausted banner.
    // =========================================================
    it('persists reply_method="post_reply" when a post-reply trigger keyword matches, and skips AI generation', async () => {
        const platformPostId = 'post-fb-trigger-001';
        const platformCommentId = 'comment-fb-trigger-001';
        const triggerReplyText = 'Check the catalog at example.com/shop';

        // Pre-create the post with trigger keyword + reply configured.
        // Post stamps its DB id from the platform id via the adapter's findOrCreateContent.
        const post = await insertPost(pageId, {
            facebookPostId: platformPostId,
            triggerKeyword: 'price, info',
            triggerReply: triggerReplyText,
        });

        // Override findOrCreateContent so the mock adapter forwards the trigger
        // fields (the real adapter does this in production; the default test
        // helper omits them).
        const adapter = createMockAdapter(platformPage, {
            findOrCreateContent: vi.fn(async (): Promise<ContentEntity> => ({
                id: post.id,
                autoReplyEnabled: true,
                message: post.message,
                triggerKeyword: post.triggerKeyword,
                triggerReply: post.triggerReply,
            })),
        });

        const result = await processor.processComment(
            adapter, facebookPageId, platformPostId, platformCommentId,
            'price please', fromId, fromName,
        );

        expect(result.success).toBe(true);
        expect(result.replyText).toBe(triggerReplyText);
        // Trigger path bypasses AI generator entirely
        expect(mockGenerateForComment).not.toHaveBeenCalled();

        const [row] = await testDb
            .select()
            .from(comments)
            .where(eq(comments.facebookCommentId, platformCommentId));
        expect(row).toBeDefined();
        expect(row.replied).toBe(true);
        expect(row.replyText).toBe(triggerReplyText);
        // Critical: 'post_reply' (not 'template') so dashboard analytics can
        // tell trigger sends apart from AI fallbacks.
        expect(row.replyMethod).toBe('post_reply');
    });

    // =========================================================
    // Per-(page, post, sender) auto-reply debounce
    // (real Postgres + real commentsService; tryAcquire mocked to
    // win the slot on the first call and return null on the second)
    // =========================================================
    describe('per-(page, post, sender) debounce', () => {
        it('first comment fires an AI reply, back-to-back duplicate from same sender is silently resolved with no AI call', async () => {
            const { commentDebounce } = await import('../../src/services/protection');
            // First call wins the slot (token); second finds it held (null) — the
            // first comment claimed it atomically at the start of processing.
            vi.mocked(commentDebounce.tryAcquire)
                .mockResolvedValueOnce('debounce-token')
                .mockResolvedValueOnce(null);

            const adapter = createMockAdapter(platformPage);
            const platformPostId = 'post-fb-debounce-001';

            // First comment — full pipeline runs, AI replies
            const r1 = await processor.processComment(
                adapter, facebookPageId, platformPostId, 'comment-debounce-1',
                '..', fromId, fromName,
            );
            expect(r1.success).toBe(true);
            expect(r1.replyMethod).toBe('ai');
            expect(mockGenerateForComment).toHaveBeenCalledTimes(1);

            // Second comment from same sender on same post — debounced
            const r2 = await processor.processComment(
                adapter, facebookPageId, platformPostId, 'comment-debounce-2',
                '..', fromId, fromName,
            );
            expect(r2.success).toBe(true);
            // AI was NOT called again
            expect(mockGenerateForComment).toHaveBeenCalledTimes(1);
            // sendReply was NOT called for the second comment (still 1 from #1)
            expect(adapter.sendReply).toHaveBeenCalledTimes(1);

            // Both rows exist in DB. First: replied. Second: resolved (no reply).
            const [row1] = await testDb.select().from(comments).where(eq(comments.facebookCommentId, 'comment-debounce-1'));
            const [row2] = await testDb.select().from(comments).where(eq(comments.facebookCommentId, 'comment-debounce-2'));
            expect(row1.replied).toBe(true);
            expect(row1.replyText).toBe('Mocked AI reply');
            expect(row2.replied).toBe(false);
            expect(row2.resolved).toBe(true);
            expect(row2.replyText).toBeNull();

            // Pipeline metric: 1 success + 1 debounce_skipped
            const metrics = await pipelineMetrics.getMetrics();
            expect(metrics.counters['facebook_comment.success']).toBe(1);
            expect(metrics.counters['facebook_comment.debounce_skipped']).toBe(1);

            // The slot was claimed once per comment (both webhooks tried); the
            // second lost the claim and was debounced.
            expect(commentDebounce.tryAcquire).toHaveBeenCalledTimes(2);
            expect(commentDebounce.tryAcquire).toHaveBeenCalledWith(pageId, expect.any(String), fromId);
        });

        it('a duplicate webhook for the SAME comment_id hits already_replied, not debounce', async () => {
            // Both deliveries win the debounce slot (default mock) — the second is
            // caught earlier by comment-level idempotency (already_replied), so the
            // debounce path is never reached.
            const { commentDebounce } = await import('../../src/services/protection');

            const adapter = createMockAdapter(platformPage);
            const platformPostId = 'post-fb-dup-debounce';
            const platformCommentId = 'comment-fb-dup-debounce';

            await processor.processComment(
                adapter, facebookPageId, platformPostId, platformCommentId,
                'Hello!', fromId, fromName,
            );
            const r2 = await processor.processComment(
                adapter, facebookPageId, platformPostId, platformCommentId,
                'Hello!', fromId, fromName,
            );

            // Duplicate webhook short-circuits via already_replied — NOT debounce.
            expect(r2.success).toBe(false);
            expect(r2.error).toBe('Comment already replied');

            const metrics = await pipelineMetrics.getMetrics();
            expect(metrics.counters['facebook_comment.already_replied']).toBe(1);
            expect(metrics.counters['facebook_comment.debounce_skipped']).toBeUndefined();
        });

        it('different senders on the same post are NOT gated against each other', async () => {
            const { commentDebounce } = await import('../../src/services/protection');
            // Both win their slot — different senders → different keys (default mock).

            const adapter = createMockAdapter(platformPage);
            const platformPostId = 'post-fb-debounce-multi';

            const r1 = await processor.processComment(
                adapter, facebookPageId, platformPostId, 'comment-multi-A',
                'First!', 'sender-A', 'Alice',
            );
            const r2 = await processor.processComment(
                adapter, facebookPageId, platformPostId, 'comment-multi-B',
                'Second!', 'sender-B', 'Bob',
            );

            expect(r1.success).toBe(true);
            expect(r2.success).toBe(true);
            expect(mockGenerateForComment).toHaveBeenCalledTimes(2);
            expect(adapter.sendReply).toHaveBeenCalledTimes(2);

            // Slot claimed for each distinct sender id (different keys → both win)
            expect(commentDebounce.tryAcquire).toHaveBeenCalledWith(pageId, expect.any(String), 'sender-A');
            expect(commentDebounce.tryAcquire).toHaveBeenCalledWith(pageId, expect.any(String), 'sender-B');
        });
    });
});
