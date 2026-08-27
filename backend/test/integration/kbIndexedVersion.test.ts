/**
 * D-106 — the chunk-generation pointer is split from the reply-cache token.
 *
 * `pages.kb_active_version` is the cache scope token: every prompt-injected write bumps it
 * (business_profile, catalog_items, fact_collections — all through invalidatePageCaches).
 * It used to double as the value retrieval filtered chunks by, so one of those writes
 * silently orphaned the entire chunk index. Prod 2026-08-27: 16 of 57 live pages had every
 * chunk stranded below the pointer, retrieval matched nothing forever, and
 * `reingestDriftedPages` could not see it because both counters moved together.
 *
 * `pages.kb_indexed_version` is now the only value retrieval reads, and ingestion is its
 * only writer (plus updatePage, which clears it the moment the KB text changes).
 *
 * Mutation checks (each must turn the named test red):
 *   - drop `kbIndexedVersion` from the two `.set()` calls in ingestFullPage
 *       → "ingestion sets both pointers" fails
 *   - add `kbIndexedVersion` to invalidatePageCaches' `.set()`
 *       → "a prompt-only save leaves the index readable" fails
 *   - remove `setData.kbIndexedVersion = null` from updatePage's knowledgeBase branch
 *       → "a KB text edit retires the pointer" fails
 *   - make hasLiveProductChunks ignore `type`
 *       → "hasLiveProductChunks" KB-text case fails
 *   - drop `{ resolveGaps: false }` from reingestPage
 *       → "reingestPage leaves the gap backlog alone" fails
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { testDb, createTestUser, createTestWorkspace, createTestPage } from './setup';
import { KbIngestionService } from '../../src/services/kb/ingestion';
import { PgVectorStore } from '../../src/services/kb/pgvector-store';
import { RetrievalService, hasLiveProductChunks } from '../../src/services/kb/retrieval';
import { pagesService } from '../../src/services/pages';
import { adminUsersService } from '../../src/services/admin/users';
import * as schema from '../../src/db/schema';
import type { EmbeddingProvider } from '../../src/services/kb/interfaces';

class FakeEmbeddingProvider implements EmbeddingProvider {
    calls = 0;
    embed(): Promise<number[]> { this.calls++; return Promise.resolve(Array(512).fill(0.1)); }
    embedBatch(texts: string[]): Promise<number[][]> { this.calls++; return Promise.resolve(texts.map(() => Array(512).fill(0.1))); }
    getDimensions(): number { return 512; }
}

const KB = 'نشحن لكل سوريا خلال ٣ أيام. رقم التواصل 0999888777. الدوام من ٩ صباحًا حتى ٦ مساءً.';

const ingestion = () => new KbIngestionService(new FakeEmbeddingProvider(), new PgVectorStore());

async function pointers(pageId: string) {
    const [row] = await testDb
        .select({
            active: schema.pages.kbActiveVersion,
            indexed: schema.pages.kbIndexedVersion,
            version: schema.pages.kbVersion,
        })
        .from(schema.pages)
        .where(eq(schema.pages.id, pageId));
    return row;
}

async function chunksAt(pageId: string, version: number): Promise<number> {
    const rows = await testDb.select({ id: schema.kbChunks.id }).from(schema.kbChunks)
        .where(and(eq(schema.kbChunks.pageId, pageId), eq(schema.kbChunks.kbVersion, version)));
    return rows.length;
}

describe('D-106 — kb_indexed_version', () => {
    let userId: string;
    let workspaceId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        userId = user.id;
        workspaceId = (await createTestWorkspace(userId)).id;
    });

    it('ingestion sets both pointers to the version it just stored', async () => {
        const page = await createTestPage(userId, { workspaceId, knowledgeBase: KB, kbVersion: 4, kbActiveVersion: 3 });

        await ingestion().ingestFullPage(page.id, KB, [], 4, { resolveGaps: false });

        const p = await pointers(page.id);
        expect(p.active).toBe(4);
        expect(p.indexed).toBe(4);
        expect(await chunksAt(page.id, 4)).toBeGreaterThan(0);
    });

    it('a prompt-only save leaves the index readable (the production defect)', async () => {
        const page = await createTestPage(userId, { workspaceId, knowledgeBase: KB, kbVersion: 1 });
        await ingestion().ingestFullPage(page.id, KB, [], 1, { resolveGaps: false });

        // Exactly what happened to a paying page on 2026-08-19 at 16:29 and 16:31: a
        // business_profile save and a catalog_items insert, five minutes after the last
        // ingestion. Neither writes chunks.
        await pagesService.invalidatePageCaches(page.id);
        await pagesService.invalidatePageCaches(page.id);

        const p = await pointers(page.id);
        expect(p.active).toBe(3);          // the cache token moved, as it must
        expect(p.indexed).toBe(1);         // the index pointer did NOT
        expect(await chunksAt(page.id, 1)).toBeGreaterThan(0);

        // And the chunks are still reachable through the real retrieval SQL.
        const retrieval = new RetrievalService(new FakeEmbeddingProvider());
        const { chunks } = await retrieval.retrieve(page.id, 'وقت الشحن', p.indexed!, undefined, userId);
        expect(chunks.length).toBeGreaterThan(0);

        // Filtering by the cache token instead — the pre-D-106 behaviour — finds nothing.
        const { chunks: viaToken } = await retrieval.retrieve(page.id, 'وقت الشحن', p.active!, undefined, userId);
        expect(viaToken).toHaveLength(0);
    });

    it('a KB text edit retires the pointer at once, so old-text chunks cannot be served', async () => {
        const page = await createTestPage(userId, { workspaceId, knowledgeBase: KB, kbVersion: 1 });
        await ingestion().ingestFullPage(page.id, KB, [], 1, { resolveGaps: false });
        expect((await pointers(page.id)).indexed).toBe(1);

        // updatePage fires ingestion fire-and-forget; the pointer must already be NULL when
        // it returns, or the window between the write and the embeddings serves chunks built
        // from the text the merchant just replaced.
        await pagesService.updatePage(workspaceId, page.id, { knowledgeBase: 'نص جديد تمامًا' }, { skipGapResolution: true });

        const p = await pointers(page.id);
        expect(p.indexed).toBeNull();
        expect(p.version).toBe(2);
    });

    it('hasLiveProductChunks: false for a KB-text-only page, true once a product chunk exists', async () => {
        const page = await createTestPage(userId, { workspaceId, knowledgeBase: KB, kbVersion: 1 });
        await ingestion().ingestFullPage(page.id, KB, [], 1, { resolveGaps: false });
        const indexed = (await pointers(page.id)).indexed!;

        // A merchant-authored catalog row is prompt-injected, never chunked (D-004), so a
        // page like this has nothing for retrieval to fetch — the gate must say no.
        expect(await hasLiveProductChunks(page.id, indexed)).toBe(false);

        await ingestion().ingestFullPage(page.id, KB, [{
            platformProductId: 'p1',
            title: 'خلاط جداري',
            description: 'ستانلس',
            status: 'active',
            price: '30',
            currency: 'USD',
        } as never], 2, { resolveGaps: false });

        const indexed2 = (await pointers(page.id)).indexed!;
        expect(indexed2).toBe(2);
        expect(await hasLiveProductChunks(page.id, indexed2)).toBe(true);
    });

    it('reingestPage leaves the gap backlog alone (a self-heal answers nothing)', async () => {
        const page = await createTestPage(userId, { workspaceId, knowledgeBase: KB, kbVersion: 1 });
        await ingestion().ingestFullPage(page.id, KB, [], 1, { resolveGaps: false });

        await testDb.insert(schema.kbGaps).values({
            pageId: page.id,
            queryText: 'هل عندكم فروع في حلب؟',
            queryNormalized: 'هل عندكم فروع في حلب',
            occurrenceCount: 3,   // the real gap threshold, not an arbitrary number
            resolved: false,
        });

        await pagesService.reingestPage(page.id, { ingestion: ingestion() });

        const gaps = await testDb.select({ resolved: schema.kbGaps.resolved })
            .from(schema.kbGaps).where(eq(schema.kbGaps.pageId, page.id));
        expect(gaps).toHaveLength(1);
        expect(gaps[0].resolved).toBe(false);
    });

    it("the console's onRetrievalPath mirrors the generator's gate", async () => {
        // A page with a merchant-typed catalog row and NO product chunks reads no chunk,
        // so a stale index costs it nothing and the console must not flag it. This used to
        // read `store || catalogItems > 0` and over-reported the moment the reply-path gate
        // was narrowed — support chasing bookkeeping no customer can feel (the D-088 class).
        const page = await createTestPage(userId, { workspaceId, knowledgeBase: KB, kbVersion: 1 });
        await ingestion().ingestFullPage(page.id, KB, [], 1, { resolveGaps: false });
        await testDb.insert(schema.catalogItems).values({
            pageId: page.id, type: 'service', name: 'نقل مجاني للنزلاء',
        });

        let detail = await adminUsersService.getUserDetail(userId);
        let kb = detail!.pages.find((p: { id: string }) => p.id === page.id)!.kb;
        expect(kb.catalogItems).toBe(1);
        expect(kb.onRetrievalPath).toBe(false);

        // Give it a real product chunk — now it genuinely reads the index.
        await ingestion().ingestFullPage(page.id, KB, [{
            platformProductId: 'p1', title: 'خلاط جداري', description: 'ستانلس',
            status: 'active', price: '30', currency: 'USD',
        } as never], 2, { resolveGaps: false });

        detail = await adminUsersService.getUserDetail(userId);
        kb = detail!.pages.find((p: { id: string }) => p.id === page.id)!.kb;
        expect(kb.onRetrievalPath).toBe(true);
    });
});
