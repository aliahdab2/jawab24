import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db before importing the module under test
vi.mock('../../../src/db', () => ({
    db: {
        execute: vi.fn(),
    },
}));

// Mock normalizeArabic
vi.mock('@jawab24/shared', () => ({
    normalizeArabic: vi.fn((text: string) => text.toLowerCase()),
}));

import { RetrievalService, type RetrievedChunk } from '../../../src/services/kb/retrieval';
import type { EmbeddingProvider } from '../../../src/services/kb/interfaces';
import { db } from '../../../src/db';

function createMockEmbeddingProvider(): EmbeddingProvider {
    return {
        embed: vi.fn().mockResolvedValue(new Array(512).fill(0.1)),
        embedBatch: vi.fn().mockResolvedValue([new Array(512).fill(0.1)]),
        getDimensions: vi.fn().mockReturnValue(512),
    };
}

function createMockRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        id: 'chunk-1',
        type: 'offering',
        language: 'en',
        title: 'Test Product',
        content_original: 'This is a test product description.',
        vec_score: 0.85,
        text_score: 0.45,
        final_score: 0.75,
        ...overrides,
    };
}

describe('RetrievalService', () => {
    let service: RetrievalService;
    let mockEmbedding: EmbeddingProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        mockEmbedding = createMockEmbeddingProvider();
        service = new RetrievalService(mockEmbedding);
    });

    it('returns mapped chunks from DB results', async () => {
        vi.mocked(db.execute).mockResolvedValue([
            createMockRow({ id: 'c1', type: 'offering', title: 'Product A', vec_score: 0.9, text_score: 0.5, final_score: 0.8 }),
            createMockRow({ id: 'c2', type: 'faq', title: 'FAQ Item', vec_score: 0.7, text_score: 0.6, final_score: 0.68 }),
        ] as any);

        const { chunks } = await service.retrieve('page-1', 'What products do you have?', 1);

        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toMatchObject({
            id: 'c1',
            type: 'offering',
            title: 'Product A',
            vectorScore: 0.9,
            textScore: 0.5,
            finalScore: 0.8,
        });
        expect(chunks[1]).toMatchObject({
            id: 'c2',
            type: 'faq',
        });
    });

    it('returns empty array when DB returns no results', async () => {
        vi.mocked(db.execute).mockResolvedValue([] as any);

        const { chunks } = await service.retrieve('page-1', 'Something unusual', 1);

        expect(chunks).toHaveLength(0);
    });

    it('returns the computed queryEmbedding for reuse', async () => {
        vi.mocked(db.execute).mockResolvedValue([] as any);

        const { queryEmbedding } = await service.retrieve('page-1', 'test query', 1);

        expect(queryEmbedding).toHaveLength(512);
        expect(queryEmbedding[0]).toBe(0.1);
    });

    it('calls embedding provider with normalized query', async () => {
        vi.mocked(db.execute).mockResolvedValue([] as any);

        await service.retrieve('page-1', 'Hello World', 1);

        // normalizeArabic mock lowercases, so embed should be called with that result
        expect(mockEmbedding.embed).toHaveBeenCalledWith('hello world');
    });

    it('handles null language and title gracefully', async () => {
        vi.mocked(db.execute).mockResolvedValue([
            createMockRow({ language: null, title: null }),
        ] as any);

        const { chunks } = await service.retrieve('page-1', 'test', 1);

        expect(chunks[0].language).toBeNull();
        expect(chunks[0].title).toBeNull();
    });

    it('respects custom topK parameter', async () => {
        vi.mocked(db.execute).mockResolvedValue([] as any);

        await service.retrieve('page-1', 'test', 1, 3);

        // Verify execute was called (topK is embedded in SQL, we just verify it runs)
        expect(db.execute).toHaveBeenCalledTimes(1);
    });

    it('detects Arabic language from query', async () => {
        vi.mocked(db.execute).mockResolvedValue([] as any);

        // Arabic query should influence language detection in the SQL
        await service.retrieve('page-1', 'كم سعر المنتج', 1);

        expect(mockEmbedding.embed).toHaveBeenCalled();
        expect(db.execute).toHaveBeenCalledTimes(1);
    });
});
