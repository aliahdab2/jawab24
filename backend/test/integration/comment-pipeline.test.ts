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
        storeComment: vi.fn(async (postId, commentId, message, fromId, fromName) => {
            const { comment, isNew } = await commentsService.findOrCreateFromWebhook(
                postId, commentId, message, fromId, fromName,
            );
            return {
                comment: { id: comment.id, replied: comment.replied ?? false, needsAttention: comment.needsAttention ?? false },
                isNew,
            };
        }),
        sendReply: vi.fn().mockResolvedValue({ success: true }),
        markAsReplied: vi.fn(async (commentId, replyText, replyMethod, detectedLanguage, templateId, needsAttention, flagReason, aiIntent) => {
            await commentsService.markAsReplied(
                commentId, replyText, replyMethod, templateId,
                detectedLanguage, needsAttention, flagReason, aiIntent,
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
    // 6. Price hallucination → safe fallback text sent
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
});
