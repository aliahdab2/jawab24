/**
 * Tests for RAG query enrichment logic in ReplyGenerator.resolveKnowledge.
 *
 * Context: the "باقة الورد" hallucination incident (2026-03-30) showed that
 * using the full assistant reply for enrichment creates a self-reinforcing loop
 * when the AI invents product names.
 *
 * Current design: enrichment uses BOTH the last user message (ground truth)
 * AND the last 80 chars of the assistant reply (tail). The tail captures new
 * topics the AI introduced (e.g., "وبالمناسبة عندنا MacBook Air M3"), while
 * the 80-char cap limits how much mid-reply hallucinated content can leak in.
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
    detectCommentLanguage: vi.fn().mockReturnValue('ar'),
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

    describe('enrichment uses user message and assistant tail', () => {
        it('enriches vague follow-up with both last USER question and assistant reply tail', async () => {
            mockGetConversationHistory.mockResolvedValue(makeHistory([
                { role: 'user', content: 'شوفي عندكم باقات' },
                { role: 'assistant', content: 'عنا باقة الورد وباقة النجوم' },
            ]));

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'شوفي عندكم باقات', pageId: 'p-1', kbActiveVersion: 1, senderId: 'sender-1' },
                true,
            );

            expect(mockRetrieve).toHaveBeenCalledOnce();
            const ragQuery: string = mockRetrieve.mock.calls[0][1];

            // Must contain the USER's prior question
            expect(ragQuery).toContain('شوفي عندكم باقات');
            // Must contain assistant tail (last 80 chars) for context continuity
            expect(ragQuery).toContain('باقة الورد');
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

        it('hallucinated mid-reply content is excluded when reply is long (only tail used)', async () => {
            // The AI hallucinated "باقة الورد" and "باقة النجوم" in the middle of a long reply.
            // Only the last 80 chars (tail) should enter the enrichment query — the hallucinated
            // names in the middle are excluded.
            const hallucinated = 'عنا باقة الورد الفاخرة بسعر 500 ريال وباقة النجوم المميزة بسعر 300 ريال';
            const safeTail = 'تقدر تزورنا بالمعرض وتشوف جميع الخيارات المتاحة عندنا';
            const longAssistantReply = `${hallucinated}. ${safeTail}`;
            // Verify our test data: the full reply is longer than 80 chars
            expect(longAssistantReply.length).toBeGreaterThan(80);

            mockGetConversationHistory.mockResolvedValue(makeHistory([
                { role: 'user', content: 'شوفي عندكم باقات' },
                { role: 'assistant', content: longAssistantReply },
            ]));

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'وين ألاقيكم', pageId: 'p-1', kbActiveVersion: 1, senderId: 'sender-1' },
                true,
            );

            expect(mockRetrieve).toHaveBeenCalledOnce();
            const ragQuery: string = mockRetrieve.mock.calls[0][1];

            // Tail content (safe) MUST be in the enriched query
            expect(ragQuery).toContain('المتاحة عندنا');
            // Hallucinated names from mid-reply MUST NOT be in the enriched query
            expect(ragQuery).not.toContain('باقة الورد');
            expect(ragQuery).not.toContain('باقة النجوم');
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
