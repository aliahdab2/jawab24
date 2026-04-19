/**
 * Tests for RAG query enrichment logic in ReplyGenerator.resolveKnowledge.
 *
 * Current design: enrichment uses ONLY the customer's last user message — never
 * the assistant tail. The assistant tail proved to be an unreliable signal that
 * caused multiple bug classes:
 *   - Hallucination self-reinforcement ("باقة الورد" incident, 2026-03-30)
 *   - Post-reply marketing dumps biasing retrieval away from off-topic follow-ups
 *     (Doaa case, 2026-04-19: address question after course-price post-reply
 *     missed the address chunk)
 *   - AI mid-reply tangents poisoning subsequent retrievals
 *
 * The customer's own prior message is the truest signal of what they care about.
 * When customers do follow up on AI-introduced topics, they almost always re-name
 * the keyword explicitly — it lands in lastUserMessage on the next turn.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplyGenerator } from '../../src/services/reply/generator';

// ── Dependency mocks ──────────────────────────────────────────────────────────

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
    detectLanguage: vi.fn().mockReturnValue({ language: 'ar', confidence: 0.9, script: 'Arabic', isRTL: true }),
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

    describe('enrichment uses last user message only', () => {
        it('enriches vague follow-up with last user message (not assistant tail)', async () => {
            mockGetConversationHistory.mockResolvedValue(makeHistory([
                { role: 'user', content: 'عندكم AirPods Pro؟' },
                { role: 'assistant', content: 'نعم عندنا AirPods Pro' },
            ]));

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'كم سعره؟', pageId: 'p-1', kbActiveVersion: 1, senderId: 'sender-1' },
                true,
            );

            const ragQuery: string = mockRetrieve.mock.calls[0][1];
            expect(ragQuery).toContain('AirPods Pro');
            expect(ragQuery).toContain('كم سعره؟');
        });

        it('does NOT enrich when there is no conversation history', async () => {
            mockGetConversationHistory.mockResolvedValue([]);

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'شوفي', pageId: 'p-1', kbActiveVersion: 1, senderId: 'sender-1' },
                true,
            );

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

            const ragQuery: string = mockRetrieve.mock.calls[0][1];
            expect(ragQuery).toBe(longQuery);
        });

        it('does NOT use assistant tail — even hallucinated content stays out', async () => {
            // The AI hallucinated product names in the previous reply. These must NOT
            // leak into the next retrieval embedding. Only the customer's own prior
            // message is used for enrichment.
            mockGetConversationHistory.mockResolvedValue(makeHistory([
                { role: 'user', content: 'شوفي عندكم باقات' },
                { role: 'assistant', content: 'عنا باقة الورد الفاخرة وباقة النجوم المميزة' },
            ]));

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'وين ألاقيكم', pageId: 'p-1', kbActiveVersion: 1, senderId: 'sender-1' },
                true,
            );

            const ragQuery: string = mockRetrieve.mock.calls[0][1];
            expect(ragQuery).toContain('شوفي عندكم باقات');
            expect(ragQuery).toContain('وين ألاقيكم');
            expect(ragQuery).not.toContain('باقة الورد');
            expect(ragQuery).not.toContain('باقة النجوم');
        });

        it('post-reply marketing dump does NOT bias retrieval (Doaa case)', async () => {
            // Customer received a post-reply about a course, then asks for the address.
            // The post-reply's course/price content must NOT contaminate the retrieval
            // query — otherwise the address chunk gets missed.
            const postReplyText = 'دورة المكياج المبتدئ مدتها شهر، سعرها 25 ألف ليرة سورية بالعملة القديمة خلال فترة العرض. الدروس تقام يومين في الأسبوع.';
            mockGetConversationHistory.mockResolvedValue(makeHistory([
                { role: 'assistant', content: postReplyText },
            ]));

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'العنوان اذا سمحت', pageId: 'p-1', kbActiveVersion: 1, senderId: 'sender-1' },
                true,
            );

            const ragQuery: string = mockRetrieve.mock.calls[0][1];
            // No prior user message exists in this thread → no enrichment at all
            expect(ragQuery).toBe('العنوان اذا سمحت');
            expect(ragQuery).not.toContain('المكياج');
            expect(ragQuery).not.toContain('25 ألف');
            expect(ragQuery).not.toContain('سعرها');
        });
    });
});
