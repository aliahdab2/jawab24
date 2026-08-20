import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import pagesRoutes from '../../src/routes/pages';
import { pagesService } from '../../src/services/pages';
import { buildPlaygroundContext } from '../../src/services/reply/playgroundContext';

// Mock services
vi.mock('../../src/services/pages');
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canAddPage: vi.fn().mockResolvedValue({ allowed: true }),
        canEnablePage: vi.fn().mockResolvedValue({ allowed: true }),
        canUseAiReplies: vi.fn().mockResolvedValue({ allowed: true, limit: 100, used: 5, remaining: 95 }),
    }
}));
vi.mock('../../src/middleware/auth', () => ({
    authenticate: async (req: any) => {
        req.user = { userId: 'test_user_id', facebookId: 'test_fb_id' };
    }
}));
vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: async (req: any) => {
        req.workspaceId = 'test_workspace_id';
        req.workspaceOwnerId = 'test_owner_id';
        req.workspaceRole = 'owner';
    },
    requireRole: () => async () => {},
}));

vi.mock('../../src/services/reply/generator', () => ({
    replyGenerator: {
        setLogger: vi.fn(),
        generateForPlayground: vi.fn().mockResolvedValue({
            reply: 'Our prices start from $10.',
            replyMethod: 'ai',
            ragMode: 'off',
            chunksRetrieved: 0,
            chunks: [],
            intent: 'PRODUCT_INQUIRY',
            confidence: 'high',
            flags: [],
            needsAttention: false,
            cached: false,
            detectedLanguage: 'en',
            tokensUsed: 150,
            model: 'gpt-4.1-mini',
            gapRecorded: false,
        }),
    },
}));

vi.mock('../../src/services/reply/playgroundContext', () => ({
    buildPlaygroundContext: vi.fn().mockResolvedValue({
        playgroundInput: { pageId: 'page_1', question: 'test', channel: 'comment' },
        commentReplyMode: 'public',
        nudgeText: null,
    }),
}));

const mockPage = {
    id: 'page_1',
    name: 'Test Page',
    userId: 'test_user_id',
    workspaceId: 'test_workspace_id',
    knowledgeBase: 'We sell products starting from $10.',
    kbActiveVersion: 1,
    ecommerceStoreId: null,
    accessToken: 'tok',
};

describe('POST /pages/:id/test-reply', () => {
    let app: any;

    beforeEach(async () => {
        app = fastify();
        app.register(pagesRoutes);
        await app.ready();
        vi.clearAllMocks();

        vi.mocked(pagesService.getPage).mockResolvedValue(mockPage as any);
    });

    /**
     * The reply-mode override (D-087). It exists so the settings card can PREVIEW
     * a mode the merchant picked but has not saved — otherwise the only way to
     * see what info mode does is to save it live on every page, the very defect
     * the preview removes. Two boundaries carry it and neither was asserted:
     * drop `replyMode` from the controller's `buildPlaygroundContext` call and
     * every other test in this file still passes with the feature inert.
     */
    describe('reply-mode override', () => {
        const post = (payload: Record<string, unknown>) => app.inject({
            method: 'POST', url: '/pages/page_1/test-reply', payload,
        });

        it('forwards an explicit mode to the playground', async () => {
            const res = await post({ question: 'q', channel: 'comment', replyMode: 'info' });
            expect(res.statusCode).toBe(200);
            expect(vi.mocked(buildPlaygroundContext)).toHaveBeenCalledWith(
                expect.objectContaining({ replyMode: 'info' }),
            );
        });

        // The kill for a `?? 'sales'` mutation: absent must stay ABSENT. A
        // default here would force sales over a page's own 'info' pin, so the
        // merchant would preview a reply that page never produces.
        it('passes undefined when the caller sends none — never a default', async () => {
            const res = await post({ question: 'q', channel: 'comment' });
            expect(res.statusCode).toBe(200);
            const arg = vi.mocked(buildPlaygroundContext).mock.calls[0][0] as Record<string, unknown>;
            expect(arg.replyMode).toBeUndefined();
        });

        it.each(['support', '', 'INFO', 'sales ', 42, null])('400s on %o and generates nothing', async (bad) => {
            const res = await post({ question: 'q', channel: 'comment', replyMode: bad });
            expect(res.statusCode).toBe(400);
            expect(vi.mocked(buildPlaygroundContext)).not.toHaveBeenCalled();
        });

        // Scoped to ONE generation: a preview must never reach a write path.
        it('never persists the mode it previews', async () => {
            await post({ question: 'q', channel: 'comment', replyMode: 'info' });
            expect(vi.mocked(pagesService.updateReplyMode)).not.toHaveBeenCalled();
        });
    });

    it('should return a stripped reply for valid input', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/pages/page_1/test-reply',
            payload: { question: 'What are your prices?', channel: 'comment' },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body.success).toBe(true);
        expect(body.data.reply).toBe('Our prices start from $10.');
        expect(body.data.replyMethod).toBe('ai');
        expect(body.data.latencyMs).toBeTypeOf('number');
        expect(body.data.commentReplyMode).toBe('public');

        // Verify internal metadata is NOT exposed
        expect(body.data.chunks).toBeUndefined();
        expect(body.data.intent).toBeUndefined();
        expect(body.data.confidence).toBeUndefined();
        expect(body.data.flags).toBeUndefined();
        expect(body.data.tokensUsed).toBeUndefined();
        expect(body.data.model).toBeUndefined();
        expect(body.data.cached).toBeUndefined();
        expect(body.data.ragMode).toBeUndefined();
        expect(body.data.gapRecorded).toBeUndefined();
    });

    it('should return 400 if question is missing', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/pages/page_1/test-reply',
            payload: { question: '', channel: 'comment' },
        });

        expect(response.statusCode).toBe(400);
    });

    it('should return 400 if question exceeds 500 chars', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/pages/page_1/test-reply',
            payload: { question: 'x'.repeat(501), channel: 'comment' },
        });

        expect(response.statusCode).toBe(400);
    });

    it('should return 400 if channel is invalid', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/pages/page_1/test-reply',
            payload: { question: 'test', channel: 'invalid' },
        });

        expect(response.statusCode).toBe(400);
    });

    it('should return 404 if page not found', async () => {
        vi.mocked(pagesService.getPage).mockResolvedValue(null);

        const response = await app.inject({
            method: 'POST',
            url: '/pages/page_1/test-reply',
            payload: { question: 'test', channel: 'comment' },
        });

        expect(response.statusCode).toBe(404);
    });

    it('should return 403 if AI quota exceeded', async () => {
        const { subscriptionsService } = await import('../../src/services/subscriptions');
        vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValueOnce({
            allowed: false,
            reason: 'Monthly AI reply limit reached',
            limit: 100,
            used: 100,
            remaining: 0,
        });

        const response = await app.inject({
            method: 'POST',
            url: '/pages/page_1/test-reply',
            payload: { question: 'test', channel: 'comment' },
        });

        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.payload);
        expect(body.code).toBe('AI_QUOTA_EXCEEDED');
    });

    it('should accept DM channel', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/pages/page_1/test-reply',
            payload: { question: 'Hello, I need help', channel: 'dm' },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body.data.commentReplyMode).toBeNull();
        expect(body.data.nudgeText).toBeNull();
    });

    it('should accept optional postMessage for comment mode', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/pages/page_1/test-reply',
            payload: {
                question: 'How much?',
                channel: 'comment',
                postMessage: 'Check out our new product!',
            },
        });

        expect(response.statusCode).toBe(200);
    });

    it('should return 400 if postMessage exceeds 1000 chars', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/pages/page_1/test-reply',
            payload: {
                question: 'test',
                channel: 'comment',
                postMessage: 'x'.repeat(1001),
            },
        });

        expect(response.statusCode).toBe(400);
    });

    // Regression: playground must match production. When the generator returns 'skipped'
    // (SPAM_OR_IRRELEVANT — pure @mention, punctuation-only w/o post context, etc.),
    // production's commentProcessor posts nothing — not the full reply, not the nudge.
    // The playground used to surface a phantom nudge in that case; the UI displayed it
    // under "Public comment" which misled the merchant into thinking it would actually post.
    it('should return nudgeText=null when generator returns replyMethod=skipped', async () => {
        const { replyGenerator } = await import('../../src/services/reply/generator');
        const { buildPlaygroundContext } = await import('../../src/services/reply/playgroundContext');

        vi.mocked(replyGenerator.generateForPlayground).mockResolvedValueOnce({
            reply: null,
            replyMethod: 'skipped',
            ragMode: 'off',
            chunksRetrieved: 0,
            chunks: [],
            intent: 'SPAM_OR_IRRELEVANT',
            confidence: null,
            flags: [],
            needsAttention: false,
            cached: false,
            detectedLanguage: null,
            tokensUsed: 0,
            model: null,
            gapRecorded: false,
        } as any);

        vi.mocked(buildPlaygroundContext).mockResolvedValueOnce({
            playgroundInput: { pageId: 'page_1', question: '.', channel: 'comment' },
            commentReplyMode: 'dual',
            nudgeText: 'شيّك الرسائل الخاصة للتفاصيل 💬',
        } as any);

        const response = await app.inject({
            method: 'POST',
            url: '/pages/page_1/test-reply',
            payload: { question: '.', channel: 'comment' },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body.data.replyMethod).toBe('skipped');
        expect(body.data.reply).toBeNull();
        // Counter-assertion: no phantom nudge, matches production behavior.
        expect(body.data.nudgeText).toBeNull();
    });

    // Regression: the test modal is a multi-turn chat UI. Each turn was sent as an isolated
    // single-message request, so vague follow-ups ("يعني متوفرة"؟) lost their topic context
    // and RAG retrieved the wrong KB chunk. conversationHistory now flows through for DM.
    it('should pass conversationHistory through to buildPlaygroundContext for DM', async () => {
        const { buildPlaygroundContext } = await import('../../src/services/reply/playgroundContext');
        const history = [
            { role: 'user' as const, content: 'دورة إعداد محاسب مالي' },
            { role: 'assistant' as const, content: 'سعرها 150,000 ل.س، أيام الخميس 3-5 مساءً.' },
        ];

        const response = await app.inject({
            method: 'POST',
            url: '/pages/page_1/test-reply',
            payload: { question: 'يعني متوفرة', channel: 'dm', conversationHistory: history },
        });

        expect(response.statusCode).toBe(200);
        expect(buildPlaygroundContext).toHaveBeenCalledWith(
            expect.objectContaining({ conversationHistory: history }),
        );
    });

    it('should drop conversationHistory for comment channel (single-turn in production)', async () => {
        const { buildPlaygroundContext } = await import('../../src/services/reply/playgroundContext');
        const history = [
            { role: 'user' as const, content: 'first' },
            { role: 'assistant' as const, content: 'reply' },
        ];

        const response = await app.inject({
            method: 'POST',
            url: '/pages/page_1/test-reply',
            payload: { question: 'follow up', channel: 'comment', conversationHistory: history },
        });

        expect(response.statusCode).toBe(200);
        expect(buildPlaygroundContext).toHaveBeenCalledWith(
            expect.objectContaining({ conversationHistory: undefined }),
        );
    });

    it('should return 400 if conversationHistory exceeds 20 messages', async () => {
        const history = Array.from({ length: 21 }, (_, i) => ({
            role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
            content: `msg ${i}`,
        }));

        const response = await app.inject({
            method: 'POST',
            url: '/pages/page_1/test-reply',
            payload: { question: 'test', channel: 'dm', conversationHistory: history },
        });

        expect(response.statusCode).toBe(400);
    });

    it('should return 400 if conversationHistory is not an array', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/pages/page_1/test-reply',
            payload: { question: 'test', channel: 'dm', conversationHistory: 'not-an-array' },
        });

        expect(response.statusCode).toBe(400);
    });
});
