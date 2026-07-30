/**
 * Cost-logging behavior for leadExtractor.callExtractionAI.
 *
 * Invariant: every successful extraction call writes exactly one ai_usage_log
 * row with pipeline='lead_extraction'. Without this test, a refactor that
 * silently drops the log call would not fail CI — defeating the cost-attribution
 * work it's part of.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logAiUsageMock, openaiCreateMock } = vi.hoisted(() => {
    const logAiUsageMock = vi.fn().mockResolvedValue(undefined);
    const openaiCreateMock = vi.fn();
    return { logAiUsageMock, openaiCreateMock };
});

vi.mock('../../src/services/aiUsageLog', () => ({
    logAiUsage: logAiUsageMock,
}));

vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
        chat: { completions: { create: openaiCreateMock } },
    })),
}));

vi.mock('../../src/config', () => ({
    config: { openai: { apiKey: 'test-key' } },
}));

vi.mock('../../src/db', () => ({ db: {} }));
vi.mock('../../src/lib/redis', () => ({ redis: { incr: vi.fn(), expire: vi.fn() } }));
vi.mock('../../src/lib/eventBus', () => ({ publishSSEEvent: vi.fn() }));
vi.mock('../../src/services/messages', () => ({ messagesService: {} }));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));
// Stub model resolver — per-user override isn't the subject under test here.
vi.mock('../../src/services/aiModelResolver', () => ({
    getModelForUser: vi.fn().mockResolvedValue('gpt-4.1-mini'),
    clearAiModelCache: vi.fn(),
}));

// callExtractionAI is private — invoke it through a small accessor so we test
// the production code path rather than re-implementing it.
import { leadExtractorService } from '../../src/services/leadExtractor';

beforeEach(() => {
    logAiUsageMock.mockClear();
    openaiCreateMock.mockReset();
});

describe('leadExtractor cost logging', () => {
    it('writes one ai_usage_log row per extraction call', async () => {
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ phone: '+1234', summary: 's', fields: [] }) } }],
            usage: {
                prompt_tokens: 800,
                completion_tokens: 50,
                prompt_tokens_details: { cached_tokens: 200 },
            },
        });

        // Access the private method via the service instance (intentional: we
        // want to verify the LLM-call code path, not the gating in maybeCaptureLead).
        const callExtractionAI = (leadExtractorService as unknown as {
            callExtractionAI: (c: string, ctx: { userId: string; pageId: string }) => Promise<unknown>;
        }).callExtractionAI.bind(leadExtractorService);

        await callExtractionAI('Customer: hi', { userId: 'user-1', pageId: 'page-1' });

        expect(logAiUsageMock).toHaveBeenCalledTimes(1);
        expect(logAiUsageMock).toHaveBeenCalledWith({
            userId: 'user-1',
            pageId: 'page-1',
            model: 'gpt-4.1-mini',
            tokensIn: 800,
            cachedInputTokens: 200,
            tokensOut: 50,
            cached: false,
            pipeline: 'lead_extraction',
        });
    });

    it('uses an overridden OpenAI model when the resolver returns one', async () => {
        const resolverMod = await import('../../src/services/aiModelResolver');
        vi.mocked(resolverMod.getModelForUser).mockResolvedValueOnce('gpt-4o-mini');

        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ phone: '+1234', fields: [] }) } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
        });

        const callExtractionAI = (leadExtractorService as unknown as {
            callExtractionAI: (c: string, ctx: { userId: string; pageId: string }) => Promise<unknown>;
        }).callExtractionAI.bind(leadExtractorService);

        await callExtractionAI('Customer: hi', { userId: 'u-override', pageId: 'p1' });

        expect(openaiCreateMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o-mini' }));
        expect(logAiUsageMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o-mini' }));
    });

    it('falls back to default when the resolver returns a non-OpenAI model (Claude)', async () => {
        // Lead extraction calls the OpenAI SDK directly; Claude IDs would 404.
        // The guard must fall back to DEFAULT_AI_MODEL so the pipeline keeps working
        // for Claude-overridden customers.
        const resolverMod = await import('../../src/services/aiModelResolver');
        vi.mocked(resolverMod.getModelForUser).mockResolvedValueOnce('claude-haiku-4-5-20251001');

        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ phone: '+1234', fields: [] }) } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
        });

        const callExtractionAI = (leadExtractorService as unknown as {
            callExtractionAI: (c: string, ctx: { userId: string; pageId: string }) => Promise<unknown>;
        }).callExtractionAI.bind(leadExtractorService);

        await callExtractionAI('Customer: hi', { userId: 'u-claude', pageId: 'p1' });

        expect(openaiCreateMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4.1-mini' }));
        expect(logAiUsageMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4.1-mini' }));
    });

    // Regression: JAWAB24-BACKEND-1N (prod 2026-07-29). max_tokens was 500, a
    // re-extraction hit the cap, and the cut JSON surfaced as a bare
    // "SyntaxError: Unexpected end of JSON input" at the JSON.parse line — no
    // signal that the cap was the cause. Two invariants below: the cap is large
    // enough for a real multi-person card, and truncation names itself.
    it('requests enough output tokens for a full bilingual card', async () => {
        openaiCreateMock.mockResolvedValue({
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ phone: '+1234', fields: [] }) } }],
            usage: undefined,
        });

        const callExtractionAI = (leadExtractorService as unknown as {
            callExtractionAI: (c: string, ctx: { userId: string; pageId: string }) => Promise<unknown>;
        }).callExtractionAI.bind(leadExtractorService);

        await callExtractionAI('Customer: hi', { userId: 'user-1', pageId: 'page-1' });

        const { max_tokens: maxTokens } = openaiCreateMock.mock.calls[0][0];
        expect(maxTokens).toBeGreaterThanOrEqual(1500);
    });

    it('throws a truncation-specific error when the model hits max_tokens', async () => {
        // finish_reason='length' → the JSON-mode object is cut mid-token. Half an
        // object is what prod actually returned; the guard must fire before parse.
        openaiCreateMock.mockResolvedValue({
            choices: [{ finish_reason: 'length', message: { content: '{"phone":"+1234","fields":[{"key":"na' } }],
            usage: { prompt_tokens: 900, completion_tokens: 1500, prompt_tokens_details: { cached_tokens: 0 } },
        });

        const callExtractionAI = (leadExtractorService as unknown as {
            callExtractionAI: (c: string, ctx: { userId: string; pageId: string }) => Promise<unknown>;
        }).callExtractionAI.bind(leadExtractorService);

        await expect(callExtractionAI('Customer: hi', { userId: 'user-1', pageId: 'page-1' }))
            .rejects.toThrow(/truncated at max_tokens/);

        // The call was billed even though the content is unusable — cost must still
        // be attributed, so the guard sits after logAiUsage.
        expect(logAiUsageMock).toHaveBeenCalledWith(expect.objectContaining({
            pipeline: 'lead_extraction',
            tokensOut: 1500,
        }));
    });

    it('reports unparseable JSON without leaking the transcript-derived content', async () => {
        openaiCreateMock.mockResolvedValue({
            choices: [{ finish_reason: 'stop', message: { content: 'not json — 0912345678 Majd' } }],
            usage: undefined,
        });

        const callExtractionAI = (leadExtractorService as unknown as {
            callExtractionAI: (c: string, ctx: { userId: string; pageId: string }) => Promise<unknown>;
        }).callExtractionAI.bind(leadExtractorService);

        await expect(callExtractionAI('Customer: hi', { userId: 'user-1', pageId: 'page-1' }))
            .rejects.toThrow(/unparseable JSON \(26 chars\)/);

        // The error message reaches Sentry — it must not carry the phone/name.
        await callExtractionAI('Customer: hi', { userId: 'user-1', pageId: 'page-1' }).catch((err: Error) => {
            expect(err.message).not.toContain('0912345678');
            expect(err.message).not.toContain('Majd');
        });
    });

    it('skips logging when OpenAI returns no usage (defensive)', async () => {
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ phone: '', fields: [] }) } }],
            usage: undefined,
        });

        const callExtractionAI = (leadExtractorService as unknown as {
            callExtractionAI: (c: string, ctx: { userId: string; pageId: string }) => Promise<unknown>;
        }).callExtractionAI.bind(leadExtractorService);

        await callExtractionAI('Customer: hi', { userId: 'user-1', pageId: 'page-1' });

        expect(logAiUsageMock).not.toHaveBeenCalled();
    });
});
