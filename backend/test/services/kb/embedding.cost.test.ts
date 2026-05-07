/**
 * Cost-logging behavior for OpenAIEmbeddingProvider.
 *
 * Invariant: embed/embedBatch write one ai_usage_log row per OpenAI API call
 * when a logCtx is provided, and zero rows when it isn't. Without this test,
 * a refactor that drops the log call inside the provider would silently
 * regress the cost-attribution work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logAiUsageMock, embeddingsCreateMock } = vi.hoisted(() => {
    const logAiUsageMock = vi.fn().mockResolvedValue(undefined);
    const embeddingsCreateMock = vi.fn();
    return { logAiUsageMock, embeddingsCreateMock };
});

vi.mock('../../../src/services/aiUsageLog', () => ({
    logAiUsage: logAiUsageMock,
}));

vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
        embeddings: { create: embeddingsCreateMock },
    })),
}));

import { OpenAIEmbeddingProvider } from '../../../src/services/kb/embedding';

beforeEach(() => {
    logAiUsageMock.mockClear();
    embeddingsCreateMock.mockReset();
});

describe('embedding cost logging', () => {
    it('embed() writes one row when logCtx is provided', async () => {
        embeddingsCreateMock.mockResolvedValue({
            data: [{ embedding: new Array(512).fill(0.1) }],
            usage: { prompt_tokens: 25 },
        });

        const provider = new OpenAIEmbeddingProvider('test-key');
        await provider.embed('hello', { userId: 'u1', pageId: 'p1', pipeline: 'embedding_rag' });

        expect(logAiUsageMock).toHaveBeenCalledTimes(1);
        expect(logAiUsageMock).toHaveBeenCalledWith({
            userId: 'u1',
            pageId: 'p1',
            model: 'text-embedding-3-small',
            tokensIn: 25,
            tokensOut: 0,
            cached: false,
            pipeline: 'embedding_rag',
        });
    });

    it('embed() writes zero rows when logCtx is omitted', async () => {
        embeddingsCreateMock.mockResolvedValue({
            data: [{ embedding: new Array(512).fill(0.1) }],
            usage: { prompt_tokens: 25 },
        });

        const provider = new OpenAIEmbeddingProvider('test-key');
        await provider.embed('hello');

        expect(logAiUsageMock).not.toHaveBeenCalled();
    });

    it('embedBatch() writes one row per OpenAI API call (not per chunk)', async () => {
        // 150 texts → 2 API calls (MAX_BATCH_SIZE = 100), so 2 rows expected.
        const texts = new Array(150).fill('chunk');
        embeddingsCreateMock.mockResolvedValue({
            data: new Array(100).fill(null).map((_, i) => ({ embedding: [0.1], index: i })),
            usage: { prompt_tokens: 1000 },
        });

        const provider = new OpenAIEmbeddingProvider('test-key');
        await provider.embedBatch(texts, { userId: 'u1', pageId: 'p1', pipeline: 'embedding_ingestion' });

        expect(logAiUsageMock).toHaveBeenCalledTimes(2);
        expect(logAiUsageMock.mock.calls[0][0]).toMatchObject({
            pipeline: 'embedding_ingestion',
            model: 'text-embedding-3-small',
            tokensIn: 1000,
            tokensOut: 0,
        });
    });
});
