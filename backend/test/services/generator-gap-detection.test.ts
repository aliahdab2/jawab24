import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config first — must be before importing generator
vi.mock('../../src/config', () => ({
    config: {
        ragMode: 'on',
        openai: { apiKey: 'test-key' },
    },
}));

// Mock all generator dependencies
vi.mock('../../src/services/rules', () => ({
    rulesService: {
        findMatchingRule: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../../src/services/templates', () => ({
    templatesService: {
        getTemplate: vi.fn(),
    },
}));

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
        logAiUsage: vi.fn().mockResolvedValue(undefined),
    },
}));

// Mock the RetrievalService class
const mockRetrieve = vi.fn();
const mockSetLogger = vi.fn();
vi.mock('../../src/services/kb/retrieval', () => ({
    RetrievalService: vi.fn().mockImplementation(() => ({
        retrieve: mockRetrieve,
        setLogger: mockSetLogger,
    })),
}));

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

describe('ReplyGenerator - Gap detection wiring in resolveKnowledge', () => {
    let generator: ReplyGenerator;

    const baseContext = {
        userId: 'user-1',
        text: 'What is your return policy?',
        pageName: 'Test Shop',
        pageId: 'page-1',
        kbActiveVersion: 3,
        knowledgeBase: 'Static KB fallback text',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        generator = new ReplyGenerator();
    });

    it('calls gapDetectorService.recordGap when RAG returns zero chunks', async () => {
        mockRetrieve.mockResolvedValue({ chunks: [], queryEmbedding: [0.1, 0.2] });

        await generator.generateForComment(baseContext, true);

        expect(gapDetectorService.setLogger).toHaveBeenCalled();
        expect(gapDetectorService.recordGap).toHaveBeenCalledWith('page-1', 'What is your return policy?');
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
        (gapDetectorService.recordGap as ReturnType<typeof vi.fn>)
            .mockRejectedValue(new Error('DB down'));

        // Should still return a reply without throwing
        const result = await generator.generateForComment(baseContext, true);

        expect(result.replyText).toBeTruthy();
        expect(result.replyMethod).toBe('ai');
    });

    it('gap detection is also triggered in DM channel when RAG returns zero chunks', async () => {
        mockRetrieve.mockResolvedValue({ chunks: [], queryEmbedding: [0.1, 0.2] });

        const dmContext = {
            ...baseContext,
            senderId: 'sender-1',
        };

        await generator.generateForMessage(dmContext, true);

        expect(gapDetectorService.recordGap).toHaveBeenCalledWith('page-1', 'What is your return policy?');
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
