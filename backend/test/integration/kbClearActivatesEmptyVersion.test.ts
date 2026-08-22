/**
 * Clearing Business Info must make the deleted facts disappear from retrieval.
 *
 * Found on prod 2026-08-22: a page whose knowledge_base was set to '' at 13:54
 * kept serving its old `info`/`location` chunks until an unrelated product sync
 * replaced the version at 19:25. Two layers conspired:
 *   1. pagesService.updatePage skipped ingestion when the new text was empty.
 *   2. ingestFullPage returned before activating a version with zero chunks,
 *      so even a re-ingest left the previous version active — and
 *      reingestDriftedPages retried the page every cycle, forever.
 *
 * This suite pins layer 2 against real Postgres (real pgvector store, fake
 * embedder). Layer 1 is pinned in test/services/pages.updatePage-kb-clear.test.ts.
 *
 * Mutation checks:
 *   - restore the early `return` before activation in ingestFullPage → "activates" fails
 *   - same in ingestKnowledgeBase                                  → "ingestKnowledgeBase" fails
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { testDb, createTestUser, createTestPage } from './setup';
import { KbIngestionService } from '../../src/services/kb/ingestion';
import { PgVectorStore } from '../../src/services/kb/pgvector-store';
import * as schema from '../../src/db/schema';
import type { EmbeddingProvider } from '../../src/services/kb/interfaces';

class FakeEmbeddingProvider implements EmbeddingProvider {
    embed(): Promise<number[]> { return Promise.resolve(Array(512).fill(0.1)); }
    embedBatch(texts: string[]): Promise<number[][]> { return Promise.resolve(texts.map(() => Array(512).fill(0.1))); }
    getDimensions(): number { return 512; }
}
const ingestion = () => new KbIngestionService(new FakeEmbeddingProvider(), new PgVectorStore());

async function activeVersion(pageId: string): Promise<number | null> {
    const [row] = await testDb.select({ v: schema.pages.kbActiveVersion })
        .from(schema.pages).where(eq(schema.pages.id, pageId));
    return row.v;
}

async function chunksAt(pageId: string, version: number): Promise<number> {
    const rows = await testDb.select({ id: schema.kbChunks.id }).from(schema.kbChunks)
        .where(and(eq(schema.kbChunks.pageId, pageId), eq(schema.kbChunks.kbVersion, version)));
    return rows.length;
}

describe('clearing the KB activates an EMPTY version', () => {
    let userId: string;
    beforeEach(async () => { userId = (await createTestUser()).id; });

    it('ingestFullPage: activates the empty version so the previous chunks stop being the active ones', async () => {
        const page = await createTestPage(userId, {
            name: 'Cleared', knowledgeBase: 'نشحن لكل سوريا خلال ٣ أيام', kbVersion: 1,
        });

        // Version 1: real content, real chunks, activated.
        await ingestion().ingestFullPage(page.id, 'نشحن لكل سوريا خلال ٣ أيام', [], 1);
        expect(await activeVersion(page.id)).toBe(1);
        expect(await chunksAt(page.id, 1)).toBeGreaterThan(0);

        // Version 2: the merchant deleted everything, and the page sells nothing.
        await ingestion().ingestFullPage(page.id, '', [], 2);

        // The active version moved on, and it holds nothing — retrieval filters on
        // the active version, so the old shipping claim is no longer reachable.
        expect(await activeVersion(page.id)).toBe(2);
        expect(await chunksAt(page.id, 2)).toBe(0);
        // The old chunks are not deleted here (cleanupOldVersions owns that); they
        // are simply no longer active.
        expect(await chunksAt(page.id, 1)).toBeGreaterThan(0);
    });

    it('ingestKnowledgeBase: same guarantee on the admin / createPage path', async () => {
        const page = await createTestPage(userId, {
            name: 'Cleared2', knowledgeBase: 'الدفع عند الاستلام متاح', kbVersion: 1,
        });
        await ingestion().ingestKnowledgeBase(page.id, 'الدفع عند الاستلام متاح', 1);
        expect(await activeVersion(page.id)).toBe(1);

        await ingestion().ingestKnowledgeBase(page.id, '', 2);

        expect(await activeVersion(page.id)).toBe(2);
        expect(await chunksAt(page.id, 2)).toBe(0);
    });

    it('an empty version with PRODUCTS still ingests the products (the store-linked page case)', async () => {
        const page = await createTestPage(userId, { name: 'Store', knowledgeBase: 'نص قديم', kbVersion: 1 });
        await ingestion().ingestFullPage(page.id, 'نص قديم', [], 1);

        await ingestion().ingestFullPage(page.id, '', [{
            platformProductId: 'p-1', title: 'Sony A7S III', description: null, productType: null, vendor: null,
            status: 'active', priceRange: '10000 SAR', currency: 'SAR', totalInventory: null,
            hasVariants: false, variantSummary: null, tags: null, handle: null, productUrl: null,
        }], 2);

        expect(await activeVersion(page.id)).toBe(2);
        const rows = await testDb.select({ type: schema.kbChunks.type }).from(schema.kbChunks)
            .where(and(eq(schema.kbChunks.pageId, page.id), eq(schema.kbChunks.kbVersion, 2)));
        expect(rows.map(r => r.type)).toEqual(['product']);
    });
});
