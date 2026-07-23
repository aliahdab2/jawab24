import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb, createTestUser, createTestPage } from './setup';
import { KbIngestionService } from '../../src/services/kb/ingestion';
import { PgVectorStore } from '../../src/services/kb/pgvector-store';
import { gapDetectorService } from '../../src/services/kb/gap-detector';
import * as schema from '../../src/db/schema';
import type { EmbeddingProvider } from '../../src/services/kb/interfaces';

/** Deterministic embedder — exercises real ingestion SQL without OpenAI. */
class FakeEmbeddingProvider implements EmbeddingProvider {
    embed(): Promise<number[]> { return Promise.resolve(Array(512).fill(0.1)); }
    embedBatch(texts: string[]): Promise<number[][]> { return Promise.resolve(texts.map(() => Array(512).fill(0.1))); }
    getDimensions(): number { return 512; }
}
const ingestion = () => new KbIngestionService(new FakeEmbeddingProvider(), new PgVectorStore());

async function seedGap(pageId: string, query: string) {
    await testDb.insert(schema.kbGaps).values({
        pageId,
        queryText: query,
        queryNormalized: query,
        detectedIntent: 'delivery',
        // 3 = the gap notification threshold (gap-detector DEDUP/alert). A gap
        // only exists once it's been asked enough to matter, so seed at the
        // threshold rather than an arbitrary larger number.
        occurrenceCount: 3,
        resolved: false,
    });
}

describe('Phase C — KB cleanup preserves the customer-question backlog (the red trap)', () => {
    let userId: string;
    beforeEach(async () => { userId = (await createTestUser()).id; });

    it('resolveGaps:false — a cleanup re-ingest LEAVES unresolved gaps untouched', async () => {
        const page = await createTestPage(userId, {
            name: 'Moto', knowledgeBase: 'زيت موتول ٢٢ ألف\nحامل جوال ٣٥ ألف', kbVersion: 2,
        });
        await seedGap(page.id, 'بتشحنوا لحلب؟');

        await ingestion().ingestFullPage(page.id, 'حامل جوال ٣٥ ألف', [], 2, { resolveGaps: false });

        const gaps = await gapDetectorService.getUnresolvedGaps(page.id, 10);
        expect(gaps).toHaveLength(1);
        expect(gaps[0].queryText).toBe('بتشحنوا لحلب؟');
        expect(gaps[0].occurrenceCount).toBe(3);

        // Re-ingestion still happened: the version was activated.
        const [row] = await testDb.select({ v: schema.pages.kbActiveVersion })
            .from(schema.pages).where(eq(schema.pages.id, page.id));
        expect(row.v).toBe(2);
    });

    it('default (resolveGaps omitted) — a normal KB edit STILL resolves gaps (no regression)', async () => {
        const page = await createTestPage(userId, {
            name: 'Moto2', knowledgeBase: 'زيت موتول ٢٢ ألف', kbVersion: 3,
        });
        await seedGap(page.id, 'بتشحنوا لحلب؟');

        await ingestion().ingestFullPage(page.id, 'زيت موتول ٢٢ ألف', [], 3);

        const gaps = await gapDetectorService.getUnresolvedGaps(page.id, 10);
        expect(gaps).toHaveLength(0);
    });
});
