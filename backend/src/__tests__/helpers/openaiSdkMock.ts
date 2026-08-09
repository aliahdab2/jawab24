import { vi, type Mock } from 'vitest';

/**
 * ONE home for the `vi.mock('openai')` module shape.
 *
 * `makeTrackedOpenAI` binds `chat.completions.create`, `embeddings.create`
 * AND `images.generate` eagerly at construction — so every module-level mock
 * of the SDK on a code path that constructs a tracked client must carry ALL
 * of them, even when the test never calls one. That contract broke 8
 * file-extractor tests at build time when the `images` accessor landed; a
 * shared factory means the NEXT accessor (`audio` for transcription is the
 * obvious candidate) is added here once instead of file-by-file.
 *
 * Usage — the factory is designed for `vi.mock` hoisting (the mock factory
 * runs lazily when `'openai'` is first imported, so an async factory can
 * import this helper):
 *
 *   const { mockChatCreate } = vi.hoisted(() => ({ mockChatCreate: vi.fn() }));
 *   vi.mock('openai', async () => {
 *       const { makeOpenAiSdkMock } = await import('./helpers/openaiSdkMock');
 *       return makeOpenAiSdkMock({ chatCreate: mockChatCreate }).module;
 *   });
 */

export interface OpenAiSdkMock {
    /** The value to return from the `vi.mock('openai', …)` factory. */
    module: Record<string, unknown>;
    chatCreate: Mock;
    embedCreate: Mock;
    imagesGenerate: Mock;
}

export function makeOpenAiSdkMock(spies?: {
    chatCreate?: Mock;
    embedCreate?: Mock;
    imagesGenerate?: Mock;
}): OpenAiSdkMock {
    const chatCreate = spies?.chatCreate ?? vi.fn();
    const embedCreate = spies?.embedCreate ?? vi.fn();
    const imagesGenerate = spies?.imagesGenerate ?? vi.fn();

    // A class works for both `new OpenAI(...)` shapes in use (default import
    // constructed with an options object); tests assert on the method spies,
    // never on the constructor itself.
    const module = {
        default: class OpenAIMock {
            chat = { completions: { create: chatCreate } };
            embeddings = { create: embedCreate };
            images = { generate: imagesGenerate };
        },
        APIError: class APIErrorMock extends Error {},
        BadRequestError: class BadRequestErrorMock extends Error {},
        RateLimitError: class RateLimitErrorMock extends Error {},
    };

    return { module, chatCreate, embedCreate, imagesGenerate };
}
