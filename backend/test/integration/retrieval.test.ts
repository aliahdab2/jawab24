import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, createTestUser, createTestPage } from './setup';
import { RetrievalService } from '../../src/services/kb/retrieval';
import { KbIngestionService } from '../../src/services/kb/ingestion';
import { PgVectorStore } from '../../src/services/kb/pgvector-store';
import { gapDetectorService } from '../../src/services/kb/gap-detector';
import * as schema from '../../src/db/schema';
import type { EmbeddingProvider } from '../../src/services/kb/interfaces';

/**
 * Fake embedding provider that returns a deterministic 512-dim vector.
 * Avoids calling OpenAI while exercising the real SQL (float params, vector ops).
 */
class FakeEmbeddingProvider implements EmbeddingProvider {
    embed(): Promise<number[]> {
        return Promise.resolve(Array(512).fill(0.1));
    }
    embedBatch(texts: string[]): Promise<number[][]> {
        return Promise.resolve(texts.map(() => Array(512).fill(0.1)));
    }
    getDimensions(): number {
        return 512;
    }
}

describe('Retrieval — Integration (real Postgres)', () => {
    let userId: string;
    let pageId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        userId = user.id;
        const page = await createTestPage(userId, {
            knowledgeBase: 'We sell electronics. Free shipping on orders over $50.',
            kbActiveVersion: 1,
        });
        pageId = page.id;
    });

    it('should run hybrid retrieval SQL without float parameter errors (empty table)', async () => {
        // This test guards against the PostgreSQL float-as-integer parameter bug.
        // The retrieval SQL uses float constants (0.7, 0.3, 0.02, 0.3) that must
        // be inlined via sql.raw() — parameterized floats cause "invalid input
        // syntax for type integer" on some PostgreSQL versions/driver combos.
        const service = new RetrievalService(new FakeEmbeddingProvider());
        const result = await service.retrieve(pageId, 'how much is shipping?', 1);

        expect(result.chunks).toEqual([]);
        expect(result.queryEmbedding).toHaveLength(512);
    });

    it('should retrieve chunks when data exists', async () => {
        // Insert a chunk with a real embedding vector
        const embedding = Array(512).fill(0.1);
        await testDb.execute(sql`
            INSERT INTO kb_chunks (page_id, type, language, title, title_normalized,
                content_original, content_normalized, token_count, kb_version, embedding)
            VALUES (
                ${pageId}, 'info', 'en', 'Shipping Policy', 'shipping policy',
                'Free shipping on orders over $50', 'free shipping on orders over $50',
                8, 1, ${`[${embedding.join(',')}]`}::vector
            )
        `);

        const service = new RetrievalService(new FakeEmbeddingProvider());
        const result = await service.retrieve(pageId, 'shipping', 1);

        expect(result.chunks.length).toBeGreaterThan(0);
        expect(result.chunks[0].content).toContain('shipping');
        expect(result.chunks[0].finalScore).toBeGreaterThan(0);
    });

    it('should record KB gap when retrieval returns 0 chunks', async () => {
        const service = new RetrievalService(new FakeEmbeddingProvider());
        const result = await service.retrieve(pageId, 'do you have a warranty?', 1);
        expect(result.chunks).toEqual([]);

        // Now record the gap (same flow as admin.ts playground)
        await gapDetectorService.recordGap(pageId, 'do you have a warranty?');

        // Verify gap was recorded in DB
        const gaps = await testDb
            .select()
            .from(schema.kbGaps)
            .where(sql`page_id = ${pageId}`);

        expect(gaps).toHaveLength(1);
        expect(gaps[0].queryText).toBe('do you have a warranty?');
        expect(gaps[0].occurrenceCount).toBe(1);
        expect(gaps[0].resolved).toBe(false);
    });

    it('should rank higher-authority tiers above raw narrative when content is similar', async () => {
        const embedding = Array(512).fill(0.1);
        const embeddingStr = `[${embedding.join(',')}]`;

        await testDb.execute(sql`
            INSERT INTO kb_chunks (page_id, type, language, title, title_normalized,
                content_original, content_normalized, token_count, kb_version, embedding, source_tier)
            VALUES
                (${pageId}, 'info', 'en', 'RawA', 'raw a',
                 'shipping policy raw', 'shipping policy raw',
                 5, 1, ${embeddingStr}::vector, 4),
                (${pageId}, 'info', 'en', 'Approved', 'approved',
                 'shipping policy approved', 'shipping policy approved',
                 5, 1, ${embeddingStr}::vector, 3),
                (${pageId}, 'info', 'en', 'Catalog', 'catalog',
                 'shipping policy catalog', 'shipping policy catalog',
                 5, 1, ${embeddingStr}::vector, 2)
        `);

        const service = new RetrievalService(new FakeEmbeddingProvider());
        const result = await service.retrieve(pageId, 'shipping policy', 1);

        // Higher authority (lower tier number) should rank first
        expect(result.chunks[0].title).toBe('Catalog');
        expect(result.chunks[0].sourceTier).toBe(2);
        // All three should be present (none excluded)
        expect(result.chunks.map(c => c.title).sort()).toEqual(['Approved', 'Catalog', 'RawA']);
    });

    it('should exclude tier-5 (pending) chunks from retrieval entirely', async () => {
        const embedding = Array(512).fill(0.1);
        const embeddingStr = `[${embedding.join(',')}]`;

        await testDb.execute(sql`
            INSERT INTO kb_chunks (page_id, type, language, title, title_normalized,
                content_original, content_normalized, token_count, kb_version, embedding, source_tier)
            VALUES
                (${pageId}, 'info', 'en', 'PendingExtract', 'pendingextract',
                 'shipping policy pending', 'shipping policy pending',
                 5, 1, ${embeddingStr}::vector, 5),
                (${pageId}, 'info', 'en', 'Approved', 'approved',
                 'shipping policy approved', 'shipping policy approved',
                 5, 1, ${embeddingStr}::vector, 3)
        `);

        const service = new RetrievalService(new FakeEmbeddingProvider());
        const result = await service.retrieve(pageId, 'shipping policy', 1);

        const titles = result.chunks.map(c => c.title);
        expect(titles).toContain('Approved');
        expect(titles).not.toContain('PendingExtract');
    });

    it('should filter chunks past valid_until and keep current/null ones', async () => {
        const embedding = Array(512).fill(0.1);
        const embeddingStr = `[${embedding.join(',')}]`;

        await testDb.execute(sql`
            INSERT INTO kb_chunks (page_id, type, language, title, title_normalized,
                content_original, content_normalized, token_count, kb_version, embedding, valid_until)
            VALUES
                (${pageId}, 'info', 'en', 'Expired', 'expired',
                 'shipping is expired info', 'shipping is expired info',
                 5, 1, ${embeddingStr}::vector, NOW() - INTERVAL '1 day'),
                (${pageId}, 'info', 'en', 'Future', 'future',
                 'shipping is future info', 'shipping is future info',
                 5, 1, ${embeddingStr}::vector, NOW() + INTERVAL '7 days'),
                (${pageId}, 'info', 'en', 'Evergreen', 'evergreen',
                 'shipping is evergreen info', 'shipping is evergreen info',
                 5, 1, ${embeddingStr}::vector, NULL)
        `);

        const service = new RetrievalService(new FakeEmbeddingProvider());
        const result = await service.retrieve(pageId, 'shipping', 1);

        const titles = result.chunks.map(c => c.title);
        expect(titles).toContain('Future');
        expect(titles).toContain('Evergreen');
        expect(titles).not.toContain('Expired');
    });

    it('projects a kb_fact into a tier-2 chunk via ingestFullPage (the gap-fill write path)', async () => {
        // What resolveGapWithFact / pagesService.addFact persists: a structured fact row.
        const [fact] = await testDb.insert(schema.kbFacts).values({
            pageId,
            title: 'دورة المكياج',
            content: 'دورة المكياج: التكلفة ٤٠ ألف ل.س، المدة شهر، غير مختلطة.',
            type: 'offering',
        }).returning({ id: schema.kbFacts.id });

        // Re-ingest (fake embedder → no OpenAI cost). ingestFullPage fetches kb_facts internally
        // and projects each into one tier-2 chunk, then activates the new version.
        const ingestion = new KbIngestionService(new FakeEmbeddingProvider(), new PgVectorStore());
        await ingestion.ingestFullPage(pageId, 'We sell courses.', [], 2);

        // The fact must now exist as a tier-2 chunk at the active version.
        const factChunks = await testDb
            .select()
            .from(schema.kbChunks)
            .where(sql`page_id = ${pageId} AND kb_version = 2 AND source_tier = 2`);
        expect(factChunks.length).toBeGreaterThan(0);
        expect(factChunks.some(c => c.contentOriginal.includes('٤٠'))).toBe(true);
        // The projected chunk carries factId → kb_facts.id (chunk→fact traceability).
        expect(factChunks.some(c => (c.metadata as { factId?: string } | null)?.factId === fact.id)).toBe(true);

        // And retrieval surfaces it (tier-2 is boosted above the raw narrative chunk).
        const service = new RetrievalService(new FakeEmbeddingProvider());
        const result = await service.retrieve(pageId, 'كم سعر دورة المكياج؟', 2);
        expect(result.chunks.some(c => c.content.includes('٤٠'))).toBe(true);
    });

    it('should deduplicate similar gaps via trigram similarity', async () => {
        // Use very similar phrasing to ensure trigram similarity >= 0.5
        await gapDetectorService.recordGap(pageId, 'what is the warranty policy?');
        await gapDetectorService.recordGap(pageId, 'what is your warranty policy?');
        await gapDetectorService.recordGap(pageId, 'what is the warranty policy here?');

        const gaps = await testDb
            .select()
            .from(schema.kbGaps)
            .where(sql`page_id = ${pageId} AND resolved = false`);

        // Very similar questions should be deduplicated into fewer records
        expect(gaps.length).toBeLessThan(3);
        // At least one gap should have occurrence_count > 1
        const maxCount = Math.max(...gaps.map(g => g.occurrenceCount ?? 1));
        expect(maxCount).toBeGreaterThan(1);
    });
});
