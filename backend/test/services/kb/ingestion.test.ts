import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KbIngestionService } from '../../../src/services/kb/ingestion';
import type { EmbeddingProvider, VectorStore, ChunkWithEmbedding } from '../../../src/services/kb/interfaces';

vi.mock('../../../src/db', () => ({
    db: {
        update: vi.fn(() => ({
            set: vi.fn(() => ({
                where: vi.fn().mockResolvedValue(undefined),
            })),
        })),
        execute: vi.fn().mockResolvedValue(undefined),
        // userId lookup for cost-attribution: returns no row → embedding logger is skipped
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn().mockResolvedValue([]),
                })),
            })),
        })),
    },
}));

vi.mock('../../../src/services/kb/gap-detector', () => ({
    gapDetectorService: {
        setLogger: vi.fn(),
        resolveAllForPage: vi.fn().mockResolvedValue(undefined),
    },
}));

describe('KbIngestionService', () => {
    let mockEmbedding: EmbeddingProvider;
    let mockStore: VectorStore;
    let capturedChunks: ChunkWithEmbedding[];

    beforeEach(() => {
        vi.clearAllMocks();
        capturedChunks = [];

        mockEmbedding = {
            embed: vi.fn().mockResolvedValue(new Array(512).fill(0.1)),
            embedBatch: vi.fn().mockImplementation((texts: string[]) =>
                Promise.resolve(texts.map(() => new Array(512).fill(0.1)))
            ),
            getDimensions: () => 512,
        };

        mockStore = {
            upsertChunks: vi.fn().mockImplementation((_pageId: string, chunks: ChunkWithEmbedding[]) => {
                capturedChunks.push(...chunks);
                return Promise.resolve();
            }),
            searchSimilar: vi.fn().mockResolvedValue([]),
            deleteByPage: vi.fn().mockResolvedValue(undefined),
            deleteByPageVersion: vi.fn().mockResolvedValue(undefined),
        };
    });

    it('chunks, embeds, and stores KB text', async () => {
        const service = new KbIngestionService(mockEmbedding, mockStore);

        await service.ingestKnowledgeBase(
            'page-1',
            'Our restaurant serves the best pizza\n\nDelivery available across Dubai',
            2,
        );

        // Should have called embedBatch with chunk texts
        expect(mockEmbedding.embedBatch).toHaveBeenCalledTimes(1);

        // Should have stored chunks
        expect(mockStore.upsertChunks).toHaveBeenCalledTimes(1);
        expect(capturedChunks.length).toBeGreaterThanOrEqual(2);

        // All chunks should have the correct pageId and version
        for (const chunk of capturedChunks) {
            expect(chunk.pageId).toBe('page-1');
            expect(chunk.kbVersion).toBe(2);
            expect(chunk.embedding).toHaveLength(512);
        }
    });

    it('does nothing for empty KB text', async () => {
        const service = new KbIngestionService(mockEmbedding, mockStore);

        await service.ingestKnowledgeBase('page-1', '', 1);

        expect(mockEmbedding.embedBatch).not.toHaveBeenCalled();
        expect(mockStore.upsertChunks).not.toHaveBeenCalled();
    });

    it('ingests business profile chunks (hours, location, contact)', async () => {
        const service = new KbIngestionService(mockEmbedding, mockStore);

        await service.ingestBusinessProfile('page-1', {
            phone: '0501234567',
            address: 'Dubai Marina',
            city: 'Dubai',
            hours: { mon: ['09:00-18:00'] },
            about: 'A great restaurant',
        }, 1);

        expect(mockStore.upsertChunks).toHaveBeenCalledTimes(1);
        expect(capturedChunks.length).toBeGreaterThanOrEqual(3); // hours, location, contact, info

        const types = new Set(capturedChunks.map(c => c.type));
        expect(types.has('hours')).toBe(true);
        expect(types.has('location')).toBe(true);
        expect(types.has('contact')).toBe(true);
    });

    it('does nothing for empty business profile', async () => {
        const service = new KbIngestionService(mockEmbedding, mockStore);

        await service.ingestBusinessProfile('page-1', {}, 1);

        expect(mockStore.upsertChunks).not.toHaveBeenCalled();
    });

    it('embeds with title + content concatenated', async () => {
        const service = new KbIngestionService(mockEmbedding, mockStore);

        await service.ingestKnowledgeBase(
            'page-1',
            'Our Menu\nPizza: 45 AED\nBurger: 30 AED',
            1,
        );

        // Check what was passed to embedBatch
        const embedCall = (mockEmbedding.embedBatch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
        // First text should include the title
        expect(embedCall[0]).toContain('Our Menu');
    });

    it('resolves all KB gaps after successful ingestion', async () => {
        const { gapDetectorService } = await import('../../../src/services/kb/gap-detector');
        const service = new KbIngestionService(mockEmbedding, mockStore);

        await service.ingestKnowledgeBase(
            'page-1',
            'Our restaurant serves the best pizza\n\nDelivery available across Dubai',
            2,
        );

        expect(gapDetectorService.resolveAllForPage).toHaveBeenCalledWith('page-1');
    });

    it('does NOT resolve gaps when ingestion is skipped (empty text)', async () => {
        const { gapDetectorService } = await import('../../../src/services/kb/gap-detector');
        const service = new KbIngestionService(mockEmbedding, mockStore);

        await service.ingestKnowledgeBase('page-1', '', 1);

        expect(gapDetectorService.resolveAllForPage).not.toHaveBeenCalled();
    });

    it('ingestion succeeds even if gap resolution fails', async () => {
        const { gapDetectorService } = await import('../../../src/services/kb/gap-detector');
        (gapDetectorService.resolveAllForPage as ReturnType<typeof vi.fn>)
            .mockRejectedValueOnce(new Error('DB down'));

        const service = new KbIngestionService(mockEmbedding, mockStore);

        // Should not throw — gap resolution failure is non-critical
        await expect(
            service.ingestKnowledgeBase(
                'page-1',
                'Our restaurant serves the best pizza\n\nDelivery available across Dubai',
                2,
            )
        ).resolves.not.toThrow();

        // Chunks should still be stored and version activated
        expect(mockStore.upsertChunks).toHaveBeenCalledTimes(1);
    });

    it('cleans up old versions', async () => {
        const service = new KbIngestionService(mockEmbedding, mockStore);
        const { db } = await import('../../../src/db');

        await service.cleanupOldVersions('page-1', 3);

        expect(db.execute).toHaveBeenCalled();
    });

    describe('ingestFullPage', () => {
        it('combines KB text chunks and product chunks in single upsertChunks call', async () => {
            const service = new KbIngestionService(mockEmbedding, mockStore);
            await service.ingestFullPage(
                'page-1',
                'Our restaurant serves pizza\n\nDelivery is free',
                [{ platformProductId: 'p1', title: 'Margherita', status: 'active', totalInventory: 99, hasVariants: false }],
                4,
            );

            expect(mockStore.upsertChunks).toHaveBeenCalledTimes(1);
            const types = capturedChunks.map(c => c.type);
            expect(types).toContain('product');
            // KB text should also produce chunks
            expect(capturedChunks.length).toBeGreaterThan(1);
        });

        it('all chunks share the same kbVersion', async () => {
            const service = new KbIngestionService(mockEmbedding, mockStore);
            await service.ingestFullPage(
                'page-1',
                'FAQ section\n\nPolicy section',
                [
                    { platformProductId: 'p1', title: 'Product A', status: 'active', totalInventory: 10, hasVariants: false },
                    { platformProductId: 'p2', title: 'Product B', status: 'active', totalInventory: 5, hasVariants: false },
                ],
                7,
            );

            for (const chunk of capturedChunks) {
                expect(chunk.kbVersion).toBe(7);
            }
        });

        it('works with KB text only (no products)', async () => {
            const service = new KbIngestionService(mockEmbedding, mockStore);
            await service.ingestFullPage('page-1', 'Some KB text about our business', [], 2);

            expect(mockStore.upsertChunks).toHaveBeenCalledTimes(1);
            expect(capturedChunks.every(c => c.type !== 'product')).toBe(true);
        });

        it('works with products only (no KB text)', async () => {
            const service = new KbIngestionService(mockEmbedding, mockStore);
            await service.ingestFullPage('page-1', undefined, [
                { platformProductId: 'p1', title: 'Test Product', status: 'active', totalInventory: 10, hasVariants: false },
            ], 5);

            expect(mockStore.upsertChunks).toHaveBeenCalledTimes(1);
            expect(capturedChunks.every(c => c.type === 'product')).toBe(true);
        });

        it('skips when both KB and products are empty', async () => {
            const service = new KbIngestionService(mockEmbedding, mockStore);
            await service.ingestFullPage('page-1', '', [], 1);

            expect(mockStore.upsertChunks).not.toHaveBeenCalled();
            expect(mockEmbedding.embedBatch).not.toHaveBeenCalled();
        });

        it('resolves gaps after full page ingestion', async () => {
            const { gapDetectorService } = await import('../../../src/services/kb/gap-detector');
            const service = new KbIngestionService(mockEmbedding, mockStore);

            await service.ingestFullPage(
                'page-1',
                'Some KB text',
                [{ platformProductId: 'p1', title: 'Product', status: 'active', totalInventory: 10, hasVariants: false }],
                3,
            );

            expect(gapDetectorService.resolveAllForPage).toHaveBeenCalledWith('page-1');
        });
    });
});
