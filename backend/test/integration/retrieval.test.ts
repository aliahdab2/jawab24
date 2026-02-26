import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, createTestUser, createTestPage } from './setup';
import { RetrievalService } from '../../src/services/kb/retrieval';
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
