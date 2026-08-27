/**
 * Tests for RAG query enrichment logic (buildEnrichedQuery + ReplyGenerator.resolveKnowledge).
 *
 * DESIGN (revised 2026-06-25, branch fix/rag-followup-retrieval):
 * Short follow-ups (≤12 words) are enriched with the last 4 conversation turns — BOTH roles —
 * because a follow-up's topic frequently lives NOT in the bare message but in an earlier turn or
 * in the assistant's last reply (customer: "بس بدي اعرف الوقت" / "قديش" after the bot named the
 * course). The previous "last USER message only, ≤6 words" rule left those queries topicless →
 * the wrong course's chunk or none → cross-wire / "غير متوفرة" (the institute prod failures, eval
 * Cat 54). See buildEnrichedQuery for the ordering/budget contract.
 *
 * WHY re-including the assistant tail is safe now (it was removed for these incidents):
 *   - Hallucination self-reinforcement ("باقة الورد", 2026-03-30) and post-reply marketing dumps
 *     biasing a topic-switch follow-up (Doaa, 2026-04-19: address asked after a course post-reply).
 *   The two structural mitigations that did not exist then:
 *     1. The customer's message is placed FIRST, so it dominates the embedding; appended context
 *        adds recall without overriding the customer's own words.
 *     2. top-K was raised 5→10, so even when appended context nudges scores, the chunk the customer
 *        actually asked for stays in range.
 *   Verified on the REAL institute KB (2026-06-25): "العنوان اذا سمحت" after a makeup marketing
 *   dump still returns the ADDRESS, and the same-topic follow-up still returns the schedule. The
 *   behavioral guarantee the old string-level guards protected now holds via these mechanisms and
 *   is locked in by the real-retrieval eval (Doaa topic-switch + Cat 54), which a mocked unit test
 *   cannot prove. Residual risk (a hallucinated name with no matching chunk) is bounded: no chunk
 *   exists for it, so the customer's real query still wins — and the closed-world eval (Cat 51)
 *   guards fabrication broadly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplyGenerator, buildEnrichedQuery } from '../../src/services/reply/generator';
import { aiService } from '../../src/services/ai';

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

// Spread the real module so pure helpers added later (e.g. isCertainDetection, which
// derives from the mocked detectLanguage result) don't break this file.
vi.mock('../../src/utils/language', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/utils/language')>()),
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
        logQuotaEvent: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        getLimitFallbackMessage: vi.fn().mockResolvedValue(null),
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
const mockRetrieveMulti = vi.fn();

// The lazy singleton lives in kb/retrieval since D-092, so the mock owns it too.
// (The factory is hoisted above the `const` mocks, so it must reach them lazily.)
vi.mock('../../src/services/kb/retrieval', () => {
    const instance = () => ({
        setLogger: vi.fn(),
        retrieve: (...args: unknown[]) => mockRetrieve(...args),
        retrieveMulti: (...args: unknown[]) => mockRetrieveMulti(...args),
    });
    return {
        RetrievalService: vi.fn().mockImplementation(instance),
        getRetrievalService: instance,
        ragRetrievalMode: () => 'dual',
    };
});

// The (enriched) RAG query passed to retrieval, regardless of path: dual-retrieve
// (the default when enrichment changes the query) calls retrieveMulti([enriched, raw]),
// so the enriched query is queries[0]; an unenriched query goes via retrieve().
const lastRagQuery = (): string =>
    mockRetrieveMulti.mock.calls.length
        ? mockRetrieveMulti.mock.calls[0][1][0]
        : mockRetrieve.mock.calls[0][1];

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

// ── Pure helper: buildEnrichedQuery ─────────────────────────────────────────────

describe('buildEnrichedQuery', () => {
    it('returns the query unchanged when there is no history', () => {
        expect(buildEnrichedQuery('بكم سعرها')).toBe('بكم سعرها');
        expect(buildEnrichedQuery('بكم سعرها', [])).toBe('بكم سعرها');
    });

    it('does NOT enrich a long (non-follow-up) query', () => {
        const longQuery = 'عندكم باقات للاشتراك الشهري وكم تكون التكلفة الإجمالية مع كل الخدمات والميزات المتوفرة لدى متجركم';
        expect(longQuery.trim().split(/\s+/).length).toBeGreaterThan(12);
        const out = buildEnrichedQuery(longQuery, [{ content: 'مرحبا' }, { content: 'أهلاً بك' }]);
        expect(out).toBe(longQuery);
    });

    it('puts the customer message FIRST and folds in recent context', () => {
        const out = buildEnrichedQuery('كم سعره؟', [
            { content: 'عندكم AirPods Pro؟' },
            { content: 'نعم عندنا AirPods Pro' },
        ]);
        expect(out.startsWith('كم سعره؟')).toBe(true);
        expect(out).toContain('AirPods Pro');
    });

    it('TRUNCATION BUG: keeps the NEWEST turn (the one that named the topic) when history exceeds the 500-char budget', () => {
        // The old code joined oldest→newest then sliced(0,500), dropping the newest turn — exactly
        // the one that just named the course. Reproduce a >500-char history; the newest turn names
        // a unique topic token that MUST survive.
        const filler = 'عندنا دورات كثيرة جداً ومتنوعة ونقدم عروضاً مستمرة طوال العام '.repeat(6); // ~360 chars
        const history = [
            { content: filler },
            { content: 'حابب اعرف اكتر عن الدورات يلي عندكم بشكل عام ' + filler },
            { content: 'دورة التصوير الفوتوغرافي سعرها 75 ألف' }, // newest, names the topic
        ];
        expect(history.reduce((n, t) => n + t.content.length, 0)).toBeGreaterThan(500);
        const out = buildEnrichedQuery('بكم', history);
        expect(out.startsWith('بكم')).toBe(true);
        expect(out).toContain('التصوير'); // newest topic survives
        expect(out.length).toBeLessThanOrEqual(500);
    });

    it('caps each turn so one verbose turn cannot starve the budget', () => {
        // A single 400-char turn must be capped (~200 chars) — a marker past the cap must be absent.
        const verbose = 'أ'.repeat(260) + ' MARKER_PAST_CAP ' + 'ب'.repeat(120);
        const out = buildEnrichedQuery('وين', [{ content: verbose }]);
        expect(out.startsWith('وين')).toBe(true);
        expect(out).not.toContain('MARKER_PAST_CAP');
    });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReplyGenerator - RAG query enrichment', () => {
    let generator: ReplyGenerator;

    beforeEach(() => {
        vi.clearAllMocks();
        // Default: RAG returns no chunks (falls back to static KB)
        mockRetrieve.mockResolvedValue({ chunks: [], queryEmbedding: [] });
        mockRetrieveMulti.mockResolvedValue({ chunks: [], queryEmbedding: [] });
        // Default: no conversation history
        mockGetConversationHistory.mockResolvedValue([]);
        generator = new ReplyGenerator();
    });

    describe('follow-up enrichment (last 4 turns, both roles, query-first)', () => {
        it('enriches a vague follow-up with recent context, customer message first', async () => {
            mockGetConversationHistory.mockResolvedValue(makeHistory([
                { role: 'user', content: 'عندكم AirPods Pro؟' },
                { role: 'assistant', content: 'نعم عندنا AirPods Pro' },
            ]));

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'كم سعره؟', pageId: 'p-1', kbActiveVersion: 1, kbIndexedVersion: 1, senderId: 'sender-1' },
                true,
            );

            const ragQuery: string = lastRagQuery();
            expect(ragQuery.startsWith('كم سعره؟')).toBe(true);
            expect(ragQuery).toContain('AirPods Pro');
        });

        it('does NOT enrich when there is no conversation history', async () => {
            mockGetConversationHistory.mockResolvedValue([]);

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'شوفي', pageId: 'p-1', kbActiveVersion: 1, kbIndexedVersion: 1, senderId: 'sender-1' },
                true,
            );

            const ragQuery: string = lastRagQuery();
            expect(ragQuery).toBe('شوفي');
        });

        it('does NOT enrich when current query is long (not a follow-up, >12 words)', async () => {
            mockGetConversationHistory.mockResolvedValue(makeHistory([
                { role: 'user', content: 'مرحبا' },
                { role: 'assistant', content: 'أهلاً' },
            ]));

            const longQuery = 'عندكم باقات للاشتراك الشهري وكم تكون التكلفة الإجمالية مع كل الخدمات والميزات المتوفرة لديكم';
            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: longQuery, pageId: 'p-1', kbActiveVersion: 1, kbIndexedVersion: 1, senderId: 'sender-1' },
                true,
            );

            const ragQuery: string = lastRagQuery();
            expect(ragQuery).toBe(longQuery);
        });

        it('folds in the assistant tail, but the customer message stays first and dominant', async () => {
            // The assistant tail IS now included (it carries the topic for same-topic follow-ups —
            // eval Cat 54). The old guard excluded it to avoid hallucination self-reinforcement
            // ("باقة الورد", 2026-03-30); that is now mitigated structurally — the customer message
            // is placed FIRST so it dominates the embedding, and no chunk exists for a hallucinated
            // name so the customer's real query still wins (closed-world eval Cat 51 guards this).
            mockGetConversationHistory.mockResolvedValue(makeHistory([
                { role: 'user', content: 'شوفي عندكم باقات' },
                { role: 'assistant', content: 'عنا باقة الورد الفاخرة وباقة النجوم المميزة' },
            ]));

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'وين ألاقيكم', pageId: 'p-1', kbActiveVersion: 1, kbIndexedVersion: 1, senderId: 'sender-1' },
                true,
            );

            const ragQuery: string = lastRagQuery();
            // Customer's own message leads the query (dominant signal); context follows.
            expect(ragQuery.startsWith('وين ألاقيكم')).toBe(true);
            expect(ragQuery).toContain('شوفي عندكم باقات');
        });

        it('Doaa topic-switch: context is folded in, but address retrieval still wins (eval-guarded)', async () => {
            // Customer received a post-reply about a course, then switches topic to ask the address.
            // The course content IS now part of the enriched query — but the behavioral guarantee
            // (the address chunk still wins) no longer relies on excluding it: it holds via
            // query-first ordering + top-K=10, VERIFIED on the real institute KB (2026-06-25, the
            // reply returns the address, not the course) and locked in by the real-retrieval eval
            // Cat 54 Doaa case. A mocked retrieval can only assert the query shape; the behavior is
            // proven in the eval.
            const postReplyText = 'دورة المكياج المبتدئ مدتها شهر، سعرها 25 ألف ليرة سورية بالعملة القديمة خلال فترة العرض. الدروس تقام يومين في الأسبوع.';
            mockGetConversationHistory.mockResolvedValue(makeHistory([
                { role: 'assistant', content: postReplyText },
            ]));

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'العنوان اذا سمحت', pageId: 'p-1', kbActiveVersion: 1, kbIndexedVersion: 1, senderId: 'sender-1' },
                true,
            );

            const ragQuery: string = lastRagQuery();
            // The address request leads the query so it dominates retrieval.
            expect(ragQuery.startsWith('العنوان اذا سمحت')).toBe(true);
        });
    });

    describe('originating-post context forwarding (dual-mode DM)', () => {
        // Regression: when a DM thread started from a comment (dual/private mode),
        // messageProcessor resolves the originating post and passes it as
        // context.postMessage. generateForMessage previously DROPPED it, so the AI
        // never saw the post the customer engaged with — it would ask "which course?"
        // even though the post named the course and price. See promptBuilder's
        // [current_post] block + the DM channel directive that consume it.

        it('forwards postMessage into the DM AI request context when present', async () => {
            mockGetConversationHistory.mockResolvedValue([]);
            const postMessage = 'دورة الإسعافات الأولية بكلفة 25 ألف بالعملة القديمة. سجّل واحجز مقعدك.';

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'كم اشتراك الدورة', pageId: 'p-1', kbActiveVersion: 1, kbIndexedVersion: 1, senderId: 'sender-1', postMessage },
                true,
            );

            const calls = vi.mocked(aiService.generateReply).mock.calls;
            expect(calls.length).toBeGreaterThan(0);
            const ctx = calls[calls.length - 1][0].context;
            expect(ctx?.channel).toBe('dm');
            expect(ctx?.postMessage).toBe(postMessage);
        });

        it('omits postMessage when the DM did not originate from a comment', async () => {
            mockGetConversationHistory.mockResolvedValue([]);

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'مرحبا', pageId: 'p-1', kbActiveVersion: 1, kbIndexedVersion: 1, senderId: 'sender-1' },
                true,
            );

            const calls = vi.mocked(aiService.generateReply).mock.calls;
            const ctx = calls[calls.length - 1][0].context;
            expect(ctx?.postMessage).toBeUndefined();
        });

        it('does NOT enrich the RAG query with postMessage (Doaa regression guard)', async () => {
            // The post is surfaced to the model as optional context only — it must
            // never skew retrieval, or off-topic follow-ups regress (see Doaa case).
            mockGetConversationHistory.mockResolvedValue([]);
            const postMessage = 'دورة المكياج، سعرها 25 ألف، يومين بالأسبوع';

            await generator.generateForMessage(
                { workspaceId: 'ws-1', userId: 'u-1', text: 'العنوان', pageId: 'p-1', kbActiveVersion: 1, kbIndexedVersion: 1, senderId: 'sender-1', postMessage },
                true,
            );

            const ragQuery: string = lastRagQuery();
            expect(ragQuery).toBe('العنوان');
            expect(ragQuery).not.toContain('المكياج');
        });
    });
});
