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

const { mockChatCreate, mockEmbedCreate } = vi.hoisted(() => ({
    mockChatCreate: vi.fn(),
    mockEmbedCreate: vi.fn(),
}));

vi.mock('openai', () => ({
    default: class {
        chat = { completions: { create: mockChatCreate } };
        embeddings = { create: mockEmbedCreate };
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
import { recordAiFailedBeforeLog } from '../lib/aiMetrics';

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
