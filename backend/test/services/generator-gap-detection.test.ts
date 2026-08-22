import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config first — must be before importing generator
vi.mock('../../src/config', () => ({
    config: {
        ragMode: 'on',
        openai: { apiKey: 'test-key' },
    },
}));

// Mock all generator dependencies
vi.mock('../../src/services/ai', () => ({
    aiService: {
        generateReply: vi.fn().mockResolvedValue({
            reply: 'Fallback reply',
            language: 'en',
            cached: false,
            intent: 'OTHER',
            confidence: 'high',
            flags: [],
        }),
    },
}));

vi.mock('../../src/services/messages', () => ({
    messagesService: {
        getConversationHistory: vi.fn().mockResolvedValue([]),
        getCustomerSummary: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/posts', () => ({
    postsService: {
        findOrCreateFromWebhook: vi.fn(),
    },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canUseAiReplies: vi.fn().mockResolvedValue({ allowed: true, limit: 1500, used: 100, remaining: 1400 }),
        incrementAiReplies: vi.fn().mockResolvedValue(undefined),
        logQuotaEvent: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        getLimitFallbackMessage: vi.fn().mockResolvedValue(null),
    },
}));

// Mock the RetrievalService class
const mockRetrieve = vi.fn();
const mockSetLogger = vi.fn();
// The lazy singleton lives in kb/retrieval since D-092, so the mock owns it too.
// (The factory is hoisted above the `const` mocks, so it must reach them lazily.)
vi.mock('../../src/services/kb/retrieval', () => {
    const instance = () => ({
        retrieve: (...args: unknown[]) => mockRetrieve(...args),
        setLogger: (...args: unknown[]) => mockSetLogger(...args),
    });
    return {
        RetrievalService: vi.fn().mockImplementation(instance),
        getRetrievalService: instance,
        ragRetrievalMode: () => 'dual',
    };
});

// Mock the EmbeddingProvider class
vi.mock('../../src/services/kb/embedding', () => ({
    OpenAIEmbeddingProvider: vi.fn().mockImplementation(() => ({})),
}));

// Mock the gap detector service
vi.mock('../../src/services/kb/gap-detector', () => ({
    gapDetectorService: {
        setLogger: vi.fn(),
        recordGap: vi.fn().mockResolvedValue(undefined),
    },
}));

import { ReplyGenerator } from '../../src/services/reply/generator';
import { gapDetectorService } from '../../src/services/kb/gap-detector';
import { aiService } from '../../src/services/ai';

describe('ReplyGenerator - Gap detection wiring in resolveKnowledge', () => {
    let generator: ReplyGenerator;

    // KB must be >= 5000 chars so the small-KB optimization doesn't skip RAG.
    // (KBs under the threshold bypass RAG and use full static text instead.)
    const LARGE_KB = 'Product and service information. '.repeat(160); // ~5280 chars
    const baseContext = {
        userId: 'user-1',
        text: 'What is your return policy?',
        pageName: 'Test Shop',
        pageId: 'page-1',
        kbActiveVersion: 3,
        knowledgeBase: LARGE_KB,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        generator = new ReplyGenerator();
        // Reset AI mock to default high-confidence response
        (aiService.generateReply as ReturnType<typeof vi.fn>).mockResolvedValue({
            reply: 'Fallback reply',
            language: 'en',
            cached: false,
            intent: 'OTHER',
            confidence: 'high',
            flags: [],
        });
    });

    it('does NOT record gap when RAG returns zero chunks but AI answers confidently', async () => {
        mockRetrieve.mockResolvedValue({ chunks: [], queryEmbedding: [0.1, 0.2] });

        const result = await generator.generateForComment(baseContext, true);

        // AI answered with high confidence using static KB — no gap should be recorded
        expect(gapDetectorService.recordGap).not.toHaveBeenCalled();
        expect(result.replyText).toBeTruthy();
        expect(result.replyMethod).toBe('ai');
    });

    it('records gap when RAG returns zero chunks AND AI flags info_not_in_kb with low confidence', async () => {
        mockRetrieve.mockResolvedValue({ chunks: [], queryEmbedding: [0.1, 0.2] });
        (aiService.generateReply as ReturnType<typeof vi.fn>).mockResolvedValue({
            reply: "I'm not sure about that, please contact us directly.",
            language: 'en',
            cached: false,
            intent: 'QUESTION',
            confidence: 'low',
            flags: ['info_not_in_kb'],
        });

        await generator.generateForComment(baseContext, true);

        expect(gapDetectorService.setLogger).toHaveBeenCalled();
        expect(gapDetectorService.recordGap).toHaveBeenCalledWith(
            'page-1',
            'What is your return policy?',
            { type: 'comment', context: undefined },
        );
    });

    it('records gap when AI has medium confidence with info_not_in_kb flag', async () => {
        mockRetrieve.mockResolvedValue({ chunks: [], queryEmbedding: [0.1, 0.2] });
        (aiService.generateReply as ReturnType<typeof vi.fn>).mockResolvedValue({
            reply: 'I have some info but not complete details.',
            language: 'en',
            cached: false,
            intent: 'QUESTION',
            confidence: 'medium',
            flags: ['info_not_in_kb'],
        });

        await generator.generateForComment(baseContext, true);

        // Medium confidence but AI says info not in KB — still a gap
        expect(gapDetectorService.recordGap).toHaveBeenCalledWith(
            'page-1',
            'What is your return policy?',
            { type: 'comment', context: undefined },
        );
    });

    it('does NOT record gap when AI has low confidence but no info_not_in_kb flag', async () => {
        mockRetrieve.mockResolvedValue({ chunks: [], queryEmbedding: [0.1, 0.2] });
        (aiService.generateReply as ReturnType<typeof vi.fn>).mockResolvedValue({
            reply: 'Some reply',
            language: 'en',
            cached: false,
            intent: 'OTHER',
            confidence: 'low',
            flags: ['angry_customer'],
        });

        await generator.generateForComment(baseContext, true);

        expect(gapDetectorService.recordGap).not.toHaveBeenCalled();
    });

    it('does NOT call gapDetectorService.recordGap when RAG returns chunks', async () => {
        mockRetrieve.mockResolvedValue({
            chunks: [{
                id: 'chunk-1',
                type: 'policy',
                title: 'Return Policy',
                content: 'Returns accepted within 14 days.',
                finalScore: 0.85,
            }],
            queryEmbedding: [0.1, 0.2],
        });

        await generator.generateForComment(baseContext, true);

        expect(gapDetectorService.recordGap).not.toHaveBeenCalled();
    });

    it('gap detection error does not block reply generation', async () => {
        mockRetrieve.mockResolvedValue({ chunks: [], queryEmbedding: [0.1, 0.2] });
        (aiService.generateReply as ReturnType<typeof vi.fn>).mockResolvedValue({
            reply: 'Not sure about that.',
            language: 'en',
            cached: false,
            intent: 'OTHER',
            confidence: 'low',
            flags: ['info_not_in_kb'],
        });
        (gapDetectorService.recordGap as ReturnType<typeof vi.fn>)
            .mockRejectedValue(new Error('DB down'));

        // Should still return a reply without throwing
        const result = await generator.generateForComment(baseContext, true);

        expect(result.replyText).toBeTruthy();
        expect(result.replyMethod).toBe('ai');
    });

    it('gap detection works in DM channel when AI flags info_not_in_kb', async () => {
        mockRetrieve.mockResolvedValue({ chunks: [], queryEmbedding: [0.1, 0.2] });
        (aiService.generateReply as ReturnType<typeof vi.fn>).mockResolvedValue({
            reply: 'Not sure.',
            language: 'en',
            cached: false,
            intent: 'OTHER',
            confidence: 'low',
            flags: ['info_not_in_kb'],
        });

        const dmContext = {
            ...baseContext,
            senderId: 'sender-1',
        };

        await generator.generateForMessage(dmContext, true);

        expect(gapDetectorService.recordGap).toHaveBeenCalledWith(
            'page-1',
            'What is your return policy?',
            { type: 'dm', context: undefined },
        );
    });

    it('does NOT record gap in DM channel when AI answers confidently', async () => {
        mockRetrieve.mockResolvedValue({ chunks: [], queryEmbedding: [0.1, 0.2] });

        const dmContext = {
            ...baseContext,
            senderId: 'sender-1',
        };

        await generator.generateForMessage(dmContext, true);

        expect(gapDetectorService.recordGap).not.toHaveBeenCalled();
    });

    it('does NOT trigger gap detection when kbActiveVersion is null (RAG skipped)', async () => {
        const contextNoVersion = { ...baseContext, kbActiveVersion: null };

        await generator.generateForComment(contextNoVersion, true);

        // RAG is skipped entirely — no retrieval, no gap detection
        expect(mockRetrieve).not.toHaveBeenCalled();
        expect(gapDetectorService.recordGap).not.toHaveBeenCalled();
    });

    it('does NOT trigger gap detection when pageId is missing', async () => {
        const contextNoPage = { ...baseContext, pageId: undefined };

        await generator.generateForComment(contextNoPage, true);

        expect(mockRetrieve).not.toHaveBeenCalled();
        expect(gapDetectorService.recordGap).not.toHaveBeenCalled();
    });
});
