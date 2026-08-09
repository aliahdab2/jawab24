/**
 * Coverage for the tracked client's `failed_before_log` classification.
 *
 * JAWAB24-BACKEND-1J: an aborted OpenAI request throws an error that carries no
 * distinguishing `name`, so this wrapper hardcoded `OpenAIApiError` and every
 * timeout on a tracked pipeline (vision, Business Info audit) was booked as a
 * generic API error — hiding it from the Phase-6.5 A−R/R−L gap analysis. The
 * signal the call site owns is the only reliable evidence, so these tests assert
 * the classification against the SDK's real error shape (a bare `Error`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockChatCreate, mockEmbedCreate, mockImagesGenerate } = vi.hoisted(() => ({
    mockChatCreate: vi.fn(),
    mockEmbedCreate: vi.fn(),
    mockImagesGenerate: vi.fn(),
}));

vi.mock('openai', () => ({
    default: class {
        chat = { completions: { create: mockChatCreate } };
        embeddings = { create: mockEmbedCreate };
        images = { generate: mockImagesGenerate };
    },
    APIError: class APIErrorMock extends Error {},
    BadRequestError: class BadRequestErrorMock extends Error {},
    RateLimitError: class RateLimitErrorMock extends Error {},
}));
vi.mock('../services/aiUsageLog', () => ({ logAiUsage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/aiMetrics', () => ({
    recordAiAttempt: vi.fn(),
    recordAiReturn: vi.fn(),
    recordAiFailedBeforeLog: vi.fn(),
}));

import { makeTrackedOpenAI } from '../services/openaiClient';
import { recordAiAttempt, recordAiReturn, recordAiFailedBeforeLog } from '../lib/aiMetrics';
import { logAiUsage } from '../services/aiUsageLog';

const CTX = { userId: 'u1', pageId: 'p1', pipeline: 'image_understanding' as const };
/** The SDK's real abort shape: a bare Error named "Error", not "AbortError". */
const abortError = () => new Error('Request was aborted.');

beforeEach(() => vi.clearAllMocks());

describe('makeTrackedOpenAI — failed_before_log classification', () => {
    it('books AiTimeoutError when the caller-owned signal aborted (chat)', async () => {
        const controller = new AbortController();
        controller.abort();
        mockChatCreate.mockRejectedValue(abortError());
        const client = makeTrackedOpenAI('k', CTX);

        await expect(client.chat.completions.create(
            { model: 'gpt-4.1-mini', messages: [] },
            { signal: controller.signal },
        )).rejects.toThrow();

        expect(recordAiFailedBeforeLog).toHaveBeenCalledWith('image_understanding', 'gpt-4.1-mini', 'AiTimeoutError');
    });

    it('books OpenAIApiError when the signal is still live (real API failure)', async () => {
        const controller = new AbortController();
        mockChatCreate.mockRejectedValue(new Error('503 service unavailable'));
        const client = makeTrackedOpenAI('k', CTX);

        await expect(client.chat.completions.create(
            { model: 'gpt-4.1-mini', messages: [] },
            { signal: controller.signal },
        )).rejects.toThrow();

        expect(recordAiFailedBeforeLog).toHaveBeenCalledWith('image_understanding', 'gpt-4.1-mini', 'OpenAIApiError');
    });

    it('books OpenAIApiError when the call site passes no signal at all', async () => {
        mockChatCreate.mockRejectedValue(abortError());
        const client = makeTrackedOpenAI('k', CTX);

        await expect(client.chat.completions.create({ model: 'gpt-4.1-mini', messages: [] })).rejects.toThrow();

        // No signal of ours means no timeout of ours to claim — even for an error
        // whose message *looks* like an abort.
        expect(recordAiFailedBeforeLog).toHaveBeenCalledWith('image_understanding', 'gpt-4.1-mini', 'OpenAIApiError');
    });

    it('classifies image generation calls the same way', async () => {
        const controller = new AbortController();
        controller.abort();
        mockImagesGenerate.mockRejectedValue(abortError());
        const client = makeTrackedOpenAI('k', { ...CTX, pipeline: 'post_image_generation' });

        await expect(client.images.generate(
            { model: 'gpt-image-2', prompt: 'a cafe scene' },
            { signal: controller.signal },
        )).rejects.toThrow();

        expect(recordAiFailedBeforeLog).toHaveBeenCalledWith('post_image_generation', 'gpt-image-2', 'AiTimeoutError');
    });

    it('classifies embedding calls the same way', async () => {
        const controller = new AbortController();
        controller.abort();
        mockEmbedCreate.mockRejectedValue(abortError());
        const client = makeTrackedOpenAI('k', { ...CTX, pipeline: 'embedding_rag' });

        await expect(client.embeddings.create(
            { model: 'text-embedding-3-small', input: 'x' },
            { signal: controller.signal },
        )).rejects.toThrow();

        expect(recordAiFailedBeforeLog).toHaveBeenCalledWith('embedding_rag', 'text-embedding-3-small', 'AiTimeoutError');
    });
});

describe('makeTrackedOpenAI — images.generate usage logging', () => {
    it('books attempts/returns and logs gpt-image token usage against the requested model', async () => {
        // ImagesResponse carries no `model` field, so the wrapper must log the
        // REQUESTED model — a regression here books image spend as "unknown".
        mockImagesGenerate.mockResolvedValue({
            created: 1,
            data: [{ b64_json: 'aGVsbG8=' }],
            usage: { input_tokens: 120, output_tokens: 1056 },
        });
        const client = makeTrackedOpenAI('k', { ...CTX, pipeline: 'post_image_generation' });

        await client.images.generate({ model: 'gpt-image-2', prompt: 'a cafe scene', size: '1024x1024' });

        expect(recordAiAttempt).toHaveBeenCalledWith('post_image_generation', 'gpt-image-2');
        expect(recordAiReturn).toHaveBeenCalledWith('post_image_generation', 'gpt-image-2');
        expect(logAiUsage).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gpt-image-2',
            pipeline: 'post_image_generation',
            tokensIn: 120,
            tokensOut: 1056,
            cached: false,
        }));
    });

    it('skips logging when the response has no usage (streamed / non-token models)', async () => {
        mockImagesGenerate.mockResolvedValue({ created: 1, data: [{ url: 'https://x' }] });
        const client = makeTrackedOpenAI('k', { ...CTX, pipeline: 'post_image_generation' });

        await client.images.generate({ model: 'gpt-image-2', prompt: 'p' });

        expect(recordAiReturn).toHaveBeenCalled();
        expect(logAiUsage).not.toHaveBeenCalled();
    });
});
