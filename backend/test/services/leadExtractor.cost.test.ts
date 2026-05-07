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
            callExtractionAI: (c: string, p: string, ctx: { userId: string; pageId: string }) => Promise<unknown>;
        }).callExtractionAI.bind(leadExtractorService);

        await callExtractionAI('Customer: hi', '+1234', { userId: 'user-1', pageId: 'page-1' });

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

    it('skips logging when OpenAI returns no usage (defensive)', async () => {
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ phone: '', fields: [] }) } }],
            usage: undefined,
        });

        const callExtractionAI = (leadExtractorService as unknown as {
            callExtractionAI: (c: string, p: string, ctx: { userId: string; pageId: string }) => Promise<unknown>;
        }).callExtractionAI.bind(leadExtractorService);

        await callExtractionAI('Customer: hi', '+1234', { userId: 'user-1', pageId: 'page-1' });

        expect(logAiUsageMock).not.toHaveBeenCalled();
    });
});
