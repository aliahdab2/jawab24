/**
 * Unit tests for OpenAIAdapter — the LLMProvider implementation used by the
 * non-default-model code path (`generateReplyWithProvider`). Mirrors the
 * cached-token plumbing tests in openai.test.ts so the provider abstraction
 * doesn't silently drop cache info on the failover/explicit-model path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/node', () => ({
    startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
    captureException: vi.fn(),
}));

vi.mock('../src/config', () => ({
    config: { openai: { apiKey: 'test-key' } },
}));

const mockCreate = vi.fn();
vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
    })),
}));

const baseParams = {
    messages: [{ role: 'user' as const, content: 'hi' }],
    maxTokens: 100,
    temperature: 0.7,
    timeoutMs: 5000,
};

const validReplyJson = JSON.stringify({
    reply: 'Hi!', intent: 'GREETING', confidence: 'high', flags: [],
});

beforeEach(() => {
    mockCreate.mockReset();
});

describe('OpenAIAdapter', () => {
    it('forwards prompt_tokens_details.cached_tokens as tokensInCached', async () => {
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: validReplyJson } }],
            usage: {
                prompt_tokens: 1500,
                completion_tokens: 100,
                total_tokens: 1600,
                prompt_tokens_details: { cached_tokens: 1200 },
            },
        });

        const { OpenAIAdapter } = await import('../src/services/providers/openai-adapter');
        const adapter = new OpenAIAdapter('gpt-4.1-mini');
        const result = await adapter.chat(baseParams);

        expect(result.tokensIn).toBe(1500);
        expect(result.tokensInCached).toBe(1200);
        expect(result.tokensOut).toBe(100);
        expect(result.tokensTotal).toBe(1600);
    });

    it('returns tokensInCached=undefined when OpenAI omits prompt_tokens_details', async () => {
        // Cold prompts (< 1024 tokens) — OpenAI doesn't bother sending the field.
        // Adapter must surface this as undefined, not 0, so backend cost math
        // doesn't claim a discount that wasn't there.
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: validReplyJson } }],
            usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
        });

        const { OpenAIAdapter } = await import('../src/services/providers/openai-adapter');
        const adapter = new OpenAIAdapter('gpt-4.1-mini');
        const result = await adapter.chat(baseParams);

        expect(result.tokensIn).toBe(80);
        expect(result.tokensInCached).toBeUndefined();
    });

    it('returns tokensInCached=0 when prompt_tokens_details reports a cache miss explicitly', async () => {
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: validReplyJson } }],
            usage: {
                prompt_tokens: 1500,
                completion_tokens: 50,
                total_tokens: 1550,
                prompt_tokens_details: { cached_tokens: 0 },
            },
        });

        const { OpenAIAdapter } = await import('../src/services/providers/openai-adapter');
        const adapter = new OpenAIAdapter('gpt-4.1-mini');
        const result = await adapter.chat(baseParams);

        expect(result.tokensInCached).toBe(0);
    });

    it('converts OpenAI APIUserAbortError into a typed AiTimeoutError', async () => {
        // Internal timeout aborts via AbortController → OpenAI SDK throws
        // APIUserAbortError. Without normalization the raw "Request was aborted."
        // leaks to Sentry as an unhandled OpenAIApiError; the backend can't tell
        // it's a timeout. Adapter must re-throw as AiTimeoutError (matching the
        // legacy openai.ts path).
        const abortErr = Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' });
        mockCreate.mockRejectedValue(abortErr);

        const { OpenAIAdapter } = await import('../src/services/providers/openai-adapter');
        const { AiTimeoutError } = await import('../src/lib/errors');
        const adapter = new OpenAIAdapter('gpt-4.1-mini');

        await expect(adapter.chat(baseParams)).rejects.toBeInstanceOf(AiTimeoutError);
    });
});
