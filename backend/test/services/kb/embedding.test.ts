import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIEmbeddingProvider } from '../../../src/services/kb/embedding';

// Mock OpenAI client
vi.mock('openai', () => {
    const mockCreate = vi.fn().mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
    });
    return {
        default: vi.fn().mockImplementation(() => ({
            embeddings: { create: mockCreate },
        })),
    };
});

describe('OpenAIEmbeddingProvider', () => {
    let provider: OpenAIEmbeddingProvider;
    let mockCreate: ReturnType<typeof vi.fn>;
    const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    beforeEach(async () => {
        vi.clearAllMocks();
        provider = new OpenAIEmbeddingProvider('test-key');
        provider.setLogger(mockLogger);
        // Access the mock
        const OpenAI = (await import('openai')).default;
        const instance = new OpenAI({ apiKey: 'test' });
        mockCreate = instance.embeddings.create as ReturnType<typeof vi.fn>;
    });

    describe('truncation', () => {
        it('passes short text through unchanged', async () => {
            await provider.embed('hello world');
            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({ input: 'hello world' }),
            );
            expect(mockLogger.warn).not.toHaveBeenCalled();
        });

        it('truncates text exceeding 28000 chars', async () => {
            const longText = 'x'.repeat(35000);
            await provider.embed(longText);
            const calledInput = mockCreate.mock.calls[0][0].input;
            expect(calledInput.length).toBe(28000);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Truncating text for embedding API',
                { originalLength: 35000, truncatedTo: 28000 },
            );
        });

        it('does not truncate text at exactly 28000 chars', async () => {
            const exactText = 'a'.repeat(28000);
            await provider.embed(exactText);
            const calledInput = mockCreate.mock.calls[0][0].input;
            expect(calledInput.length).toBe(28000);
            expect(mockLogger.warn).not.toHaveBeenCalled();
        });

        it('truncates each text in embedBatch', async () => {
            mockCreate.mockResolvedValue({
                data: [
                    { embedding: [0.1], index: 0 },
                    { embedding: [0.2], index: 1 },
                ],
            });
            const texts = ['short', 'y'.repeat(35000)];
            await provider.embedBatch(texts);
            const calledInput = mockCreate.mock.calls[0][0].input;
            expect(calledInput[0]).toBe('short');
            expect(calledInput[1].length).toBe(28000);
        });
    });

    describe('embed', () => {
        it('returns embedding array', async () => {
            mockCreate.mockResolvedValueOnce({
                data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
            });
            const result = await provider.embed('test');
            expect(result).toEqual([0.1, 0.2, 0.3]);
        });
    });

    describe('embedBatch', () => {
        it('returns empty array for empty input', async () => {
            const result = await provider.embedBatch([]);
            expect(result).toEqual([]);
            expect(mockCreate).not.toHaveBeenCalled();
        });
    });

    describe('getDimensions', () => {
        it('returns 512', () => {
            expect(provider.getDimensions()).toBe(512);
        });
    });
});
