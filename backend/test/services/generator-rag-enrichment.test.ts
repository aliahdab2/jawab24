/**
 * Tests for RAG query enrichment logic in ReplyGenerator.resolveKnowledge.
 *
 * Regression suite for the "باقة الورد" hallucination incident (2026-03-30):
 * The AI invented package names, they entered conversation history, and the
 * RAG enrichment (which used the last ASSISTANT reply) fed those invented names
 * back into the next retrieval query — creating a self-reinforcing hallucination loop.
 *
 * Fix: enrichment now uses the last USER message (ground truth) instead of the
 * last ASSISTANT reply (can contain hallucinated content).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplyGenerator } from '../../src/services/reply/generator';

// ── Dependency mocks ──────────────────────────────────────────────────────────

vi.mock('../../src/services/rules', () => ({
    rulesService: { findMatchingRule: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../src/services/templates', () => ({
    templatesService: { getTemplate: vi.fn() },
}));

vi.mock('../../src/services/ai', () => ({
    aiService: {
        generateReply: vi.fn().mockResolvedValue({
            reply: 'Test reply',
            language: 'ar',
            cached: false,
            intent: 'QUESTION',
            confidence: 'low',
            flags: ['info_not_in_kb'],
        }),
    },
}));

vi.mock('../../src/utils/language', () => ({
    detectLanguageCode: vi.fn().mockReturnValue('ar'),
}));

// getConversationHistory is re-mocked per test to control conversation context
const mockGetConversationHistory = vi.fn().mockResolvedValue([]);
vi.mock('../../src/services/messages', () => ({
    messagesService: {
        getConversationHistory: (...args: unknown[]) => mockGetConversationHistory(...args),
        getCustomerSummary: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/posts', () => ({
    postsService: { findOrCreateFromWebhook: vi.fn() },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canUseAiReplies: vi.fn().mockResolvedValue({ allowed: true, limit: 1500, used: 0, remaining: 1500 }),
        incrementAiReplies: vi.fn().mockResolvedValue(undefined),
        logAiUsage: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/kb/gap-detector', () => ({
    gapDetectorService: {
        setLogger: vi.fn(),
        recordGap: vi.fn().mockResolvedValue(undefined),
    },
}));

// ── RAG retrieval mock ────────────────────────────────────────────────────────

const mockRetrieve = vi.fn();

vi.mock('../../src/services/kb/retrieval', () => ({
    RetrievalService: vi.fn().mockImplementation(() => ({
        setLogger: vi.fn(),
        retrieve: mockRetrieve,
    })),
}));

vi.mock('../../src/services/kb/embedding', () => ({
    OpenAIEmbeddingProvider: vi.fn(),
}));

// Enable RAG mode with a fake API key so getRetrievalService() returns the mock
vi.mock('../../src/config', () => ({
    config: {
        ragMode: 'on',
        openai: { apiKey: 'sk-test' },
    },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHistory(turns: { role: 'user' | 'assistant'; content: string }[]) {
    return turns;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReplyGenerator - RAG query enrichment', () => {
    let generator: ReplyGenerator;

    beforeEach(() => {
        vi.clearAllMocks();
        // Default: RAG returns no chunks (falls back to static KB)
        mockRetrieve.mockResolvedValue({ chunks: [], queryEmbedding: [] });
        // Default: no conversation history
        mockGetConversationHistory.mockResolvedValue([]);
        generator = new ReplyGenerator();
    });

    describe('enrichment uses user message, not assistant reply', () => {
        it('enriches vague follow-up with the last USER question, not the AI reply', async () => {
            mockGetConversationHistory.mockResolvedValue(makeHistory([
                { role: 'user', content: 'شوفي عندكم باقات' },
                { role: 'assistant', content: 'عنا باقة الورد وباقة النجوم' }, // hallucinated names
            ]));

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'شوفي عندكم باقات', pageId: 'p-1', kbActiveVersion: 1, senderId: 'sender-1' },
                true,
            );

            expect(mockRetrieve).toHaveBeenCalledOnce();
            const ragQuery: string = mockRetrieve.mock.calls[0][1];

            // Must contain the USER's prior question
            expect(ragQuery).toContain('شوفي عندكم باقات');
            // Must NOT contain the AI-hallucinated names
            expect(ragQuery).not.toContain('باقة الورد');
            expect(ragQuery).not.toContain('باقة النجوم');
        });

        it('does NOT enrich when there is no conversation history', async () => {
            mockGetConversationHistory.mockResolvedValue([]);

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'شوفي', pageId: 'p-1', kbActiveVersion: 1, senderId: 'sender-1' },
                true,
            );

            expect(mockRetrieve).toHaveBeenCalledOnce();
            const ragQuery: string = mockRetrieve.mock.calls[0][1];
            expect(ragQuery).toBe('شوفي');
        });

        it('does NOT enrich when current query is long (not vague)', async () => {
            mockGetConversationHistory.mockResolvedValue(makeHistory([
                { role: 'user', content: 'مرحبا' },
                { role: 'assistant', content: 'أهلاً' },
            ]));

            const longQuery = 'عندكم باقات للاشتراك الشهري وكم تكون التكلفة';

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: longQuery, pageId: 'p-1', kbActiveVersion: 1, senderId: 'sender-1' },
                true,
            );

            expect(mockRetrieve).toHaveBeenCalledOnce();
            const ragQuery: string = mockRetrieve.mock.calls[0][1];
            expect(ragQuery).toBe(longQuery); // sent as-is, no enrichment
        });

        it('enriches using user question that mentions a real product name', async () => {
            mockGetConversationHistory.mockResolvedValue(makeHistory([
                { role: 'user', content: 'عندكم AirPods Pro؟' },
                { role: 'assistant', content: 'نعم عندنا AirPods Pro' },
            ]));

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'كم سعره؟', pageId: 'p-1', kbActiveVersion: 1, senderId: 'sender-1' },
                true,
            );

            expect(mockRetrieve).toHaveBeenCalledOnce();
            const ragQuery: string = mockRetrieve.mock.calls[0][1];

            // Should contain the user's prior question (which has the product name)
            expect(ragQuery).toContain('AirPods Pro');
            expect(ragQuery).toContain('كم سعره؟');
        });
    });
});
