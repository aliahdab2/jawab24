import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, createTestUser, createTestPage } from './setup';
import { reingestDriftedPages } from '../../src/services/kb/reingestReconciler';
import { pagesService } from '../../src/services/pages';
import { KbIngestionService } from '../../src/services/kb/ingestion';
import { RetrievalService } from '../../src/services/kb/retrieval';
import { PgVectorStore } from '../../src/services/kb/pgvector-store';
import * as schema from '../../src/db/schema';
import type { EmbeddingProvider } from '../../src/services/kb/interfaces';

/** Deterministic 512-dim embedder — exercises the real SQL/ingestion without calling OpenAI. */
class FakeEmbeddingProvider implements EmbeddingProvider {
    embed(): Promise<number[]> { return Promise.resolve(Array(512).fill(0.1)); }
    embedBatch(texts: string[]): Promise<number[][]> { return Promise.resolve(texts.map(() => Array(512).fill(0.1))); }
    getDimensions(): number { return 512; }
}
const fakeIngestion = () => new KbIngestionService(new FakeEmbeddingProvider(), new PgVectorStore());

describe('KB re-ingest reconciler — Integration (real Postgres)', () => {
    let userId: string;
    beforeEach(async () => {
        userId = (await createTestUser()).id;
    });

    it('scan selects ONLY drifted pages that have content (skips in-sync + content-less)', async () => {
        const drifted = await createTestPage(userId, {
            name: 'Drifted', knowledgeBase: 'We sell laptops. Warranty is 2 years.',
            kbVersion: 2, kbActiveVersion: 1,
        });
        await createTestPage(userId, {
            name: 'InSync', knowledgeBase: 'In sync content.', kbVersion: 1, kbActiveVersion: 1,
        });
        await createTestPage(userId, {
            name: 'EmptyDrifted', knowledgeBase: '   ', kbVersion: 2, kbActiveVersion: 1,
        });

        const seen: string[] = [];
        const result = await reingestDriftedPages({ reingest: async (id) => { seen.push(id); return true; } });

        expect(seen).toEqual([drifted.id]);          // only the drifted page WITH content
        expect(result).toEqual({ scanned: 1, reingested: 1, failed: 0 });
    });

    it('treats a never-activated page (kbActiveVersion null) as drift', async () => {
        const page = await createTestPage(userId, {
            name: 'NeverActivated', knowledgeBase: 'Free shipping over $50.',
            kbVersion: 1, kbActiveVersion: null,
        });
        const seen: string[] = [];
        await reingestDriftedPages({ reingest: async (id) => { seen.push(id); return true; } });
        expect(seen).toContain(page.id);
    });

    it('does NOT flag active > version (seed/manual artifact, not stale KB)', async () => {
        const ahead = await createTestPage(userId, {
            name: 'ActiveAhead', knowledgeBase: 'Some content.', kbVersion: 1, kbActiveVersion: 9,
        });
        const seen: string[] = [];
        await reingestDriftedPages({ reingest: async (id) => { seen.push(id); return true; } });
        expect(seen).not.toContain(ahead.id);
    });

    it('reingestPage rebuilds chunks at the current version, activates it, and retrieval serves the new content', async () => {
        // Drifted page: kb_version=2 (current KB) but kb_active_version=1 (stale). Seed a stale v1 chunk.
        const page = await createTestPage(userId, {
            name: 'Heal', knowledgeBase: 'The warranty is two years on all laptops.',
            kbVersion: 2, kbActiveVersion: 1,
        });
        const embedding = `[${Array(512).fill(0.1).join(',')}]`;
        await testDb.execute(sql`
            INSERT INTO kb_chunks (page_id, type, language, title, title_normalized,
                content_original, content_normalized, token_count, kb_version, embedding)
            VALUES (${page.id}, 'info', 'en', 'StaleOld', 'staleold',
                'old stale content', 'old stale content', 5, 1, ${embedding}::vector)`);

        const ok = await pagesService.reingestPage(page.id, { ingestion: fakeIngestion() });
        expect(ok).toBe(true);

        // active version caught up to the current version
        const [after] = await testDb.select({ active: schema.pages.kbActiveVersion })
            .from(schema.pages).where(sql`id = ${page.id}`);
        expect(after.active).toBe(2);

        // fresh chunks exist at v2 and carry the new content
        const v2 = await testDb.select().from(schema.kbChunks)
            .where(sql`page_id = ${page.id} AND kb_version = 2`);
        expect(v2.length).toBeGreaterThan(0);
        expect(v2.some(c => c.contentOriginal.includes('warranty'))).toBe(true);

        // retrieval at the now-active version returns the new content
        const result = await new RetrievalService(new FakeEmbeddingProvider()).retrieve(page.id, 'warranty', 2);
        expect(result.chunks.some(c => c.content.includes('warranty'))).toBe(true);
    });

    it('full sweep heals a drifted page end-to-end', async () => {
        const page = await createTestPage(userId, {
            name: 'SweepHeal', knowledgeBase: 'Returns accepted within 30 days.',
            kbVersion: 3, kbActiveVersion: 1,
        });
        const result = await reingestDriftedPages({
            reingest: (id) => pagesService.reingestPage(id, { ingestion: fakeIngestion() }),
        });
        expect(result.reingested).toBeGreaterThanOrEqual(1);

        const [after] = await testDb.select({ active: schema.pages.kbActiveVersion })
            .from(schema.pages).where(sql`id = ${page.id}`);
        expect(after.active).toBe(3); // active == current version → drift cleared
    });
});
