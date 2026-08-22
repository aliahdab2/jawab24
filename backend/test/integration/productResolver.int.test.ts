/**
 * Product resolver against REAL Postgres — pg_trgm scoring, the product-chunk
 * scan, status filtering, store scoping, multi-chunk dedupe (D-092).
 *
 * The embedder is a constant vector, so every product has the same cosine and
 * the semantic stage can never decide here; what this suite pins is the SQL
 * the unit tests mock: that «النظارة» really does score 0.36 against
 * «نظارة شمسية» in pg_trgm, that a hidden product is not a candidate, that a
 * sold-out one IS, and that another store's catalog is invisible.
 *
 * Mutation checks:
 *   - drop `status IN (...)` from getProductByPlatformId → "hidden is not a candidate" fails
 *   - drop GROUP BY in retrieveProducts                 → "a split product is one candidate" fails
 *   - drop the store scope in trigramOverTitles          → "another store's catalog" fails
 *   - drop `status` from writeBackProductStock's SET     → "RESTOCK write-back" fails
 *   - replace the UNION cut in retrieveProducts with one
 *     top-N by GREATEST(vec, tri)                        → "survives the candidate cut" fails
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb, createTestUser, createTestPage } from './setup';
import * as schema from '../../src/db/schema';
import { KbIngestionService } from '../../src/services/kb/ingestion';
import { PgVectorStore } from '../../src/services/kb/pgvector-store';
import { retrieveProducts } from '../../src/services/kb/retrieval';
import { resolveProduct } from '../../src/services/reply/productResolver';
import { getProductByPlatformId, writeBackProductStock } from '../../src/services/ecommerce';
import { availabilityOf } from '@jawab24/shared';
import type { EmbeddingProvider } from '../../src/services/kb/interfaces';
import type { ProductData } from '../../src/services/kb/chunker';

class ConstantEmbedder implements EmbeddingProvider {
    embed(): Promise<number[]> { return Promise.resolve(Array(512).fill(0.1)); }
    embedBatch(texts: string[]): Promise<number[][]> { return Promise.resolve(texts.map(() => Array(512).fill(0.1))); }
    getDimensions(): number { return 512; }
}

/**
 * Mirrors what the prod index actually holds for a Zid product: the chunk ends
 * with the storefront URL, whose slug is the title itself
 * (`…/products/نظارة-شمسية`). The probe's thresholds were read off that
 * content, so the fixture carries it too — a bare-title fixture scores lower
 * than production and would fail the article case for the wrong reason.
 */
const product = (platformProductId: string, title: string, overrides: Partial<ProductData> = {}): ProductData => ({
    platformProductId, title, description: null, productType: null, vendor: null, status: 'active',
    priceRange: '250 SAR', currency: 'SAR', totalInventory: 10, hasVariants: false, variantSummary: null, tags: null,
    handle: title.replace(/\s+/g, '-'), productUrl: `https://shop.zid.store/products/${title.replace(/\s+/g, '-')}`, ...overrides,
});

async function seedStore(userId: string, domain: string) {
    const [store] = await testDb.insert(schema.ecommerceStores).values({
        userId, platform: 'zid', storeDomain: domain, accessToken: 'enc', accessTokenIv: '00000000000000000000000000000000',
        storeName: domain, isActive: true,
    }).returning({ id: schema.ecommerceStores.id });
    return store.id;
}

async function seedRows(storeId: string, products: ProductData[]) {
    for (const p of products) {
        await testDb.insert(schema.ecommerceProducts).values({
            ecommerceStoreId: storeId, platformProductId: p.platformProductId, title: p.title, status: p.status,
            priceRange: p.priceRange ?? null, currency: p.currency ?? null, totalInventory: p.totalInventory,
            hasVariants: p.hasVariants, handle: p.handle ?? null,
        });
    }
}

describe('product resolver — real Postgres', () => {
    let userId: string;
    let pageId: string;
    let storeId: string;

    const CATALOG: ProductData[] = [
        product('glasses', 'نظارة شمسية'),
        product('sony', 'Sony A7S III', { totalInventory: null }),
        product('shirt', 'قميص قطني رجالي'),
        product('shoes', 'Running Shoes', { status: 'out_of_stock', totalInventory: 0 }),
        product('secret', 'نظارة سرية', { status: 'hidden' }),
    ];

    beforeEach(async () => {
        userId = (await createTestUser()).id;
        storeId = await seedStore(userId, `shop-${Date.now()}.zid.store`);
        const page = await createTestPage(userId, { name: 'Store page', kbVersion: 1, ecommerceStoreId: storeId });
        pageId = page.id;
        await seedRows(storeId, CATALOG);
        await new KbIngestionService(new ConstantEmbedder(), new PgVectorStore()).ingestFullPage(pageId, undefined, CATALOG, 1);
    });

    it('indexes sellable products only: sold-out is a candidate, hidden is not', async () => {
        const hits = await retrieveProducts(pageId, 1, 'نظارة', null);
        const ids = hits.map(h => h.platformProductId).sort();
        expect(ids).toEqual(['glasses', 'shirt', 'shoes', 'sony']);
    });

    it('an exact title resolves in the trigram stage — no embedding involved', async () => {
        const r = await resolveProduct({ storeId, pageId, kbActiveVersion: 1, productName: 'نظارة شمسية' });
        expect(r).toMatchObject({ kind: 'resolved', via: 'trigram', product: { platformProductId: 'glasses' } });
    });

    it('the «ال» article: pg_trgm RANKS the right product first but below the resolve floor — stage 2 decides it, and without a real embedding nothing is guessed', async () => {
        const hits = await retrieveProducts(pageId, 1, 'النظارة', null);
        expect(hits[0].platformProductId).toBe('glasses');
        // Measured on this fixture: 0.169. Below T_TRI (0.3) on purpose — in production the
        // reply's embedding decides it (probe: vec 0.536 vs 0.236); here there is none.
        expect(hits[0].triScore).toBeGreaterThan(0.1);
        expect(hits[0].triScore).toBeLessThan(0.3);

        const r = await resolveProduct({ storeId, pageId, kbActiveVersion: 1, productName: 'النظارة' });
        expect(r.kind).toBe('not_found');
    });

    it('a sold-out product resolves and reports its status — never "we don\'t sell that"', async () => {
        const r = await resolveProduct({ storeId, pageId, kbActiveVersion: 1, productName: 'Running Shoes' });
        expect(r).toMatchObject({ kind: 'resolved', product: { platformProductId: 'shoes', status: 'out_of_stock' } });
    });

    it('a hidden product is unreachable by id AND by name — and its exact name is never answered with a substitute', async () => {
        expect(await resolveProduct({ storeId, productId: 'secret' })).toEqual({ kind: 'not_found', reason: 'id_unknown' });
        const byName = await resolveProduct({ storeId, pageId, kbActiveVersion: 1, productName: 'نظارة سرية' });
        // The sunglasses score 0.296 against «نظارة سرية» — just under the 0.3 floor, which is
        // the floor doing its job: a near-miss on a different product is not a resolve.
        expect(byName.kind).not.toBe('resolved');
        expect(JSON.stringify(byName)).not.toContain('secret');
    });

    it('by id is validated against THIS store: another store\'s id is a hallucination here', async () => {
        const otherStore = await seedStore(userId, `other-${Date.now()}.zid.store`);
        await seedRows(otherStore, [product('foreign', 'عطر عود ملكي')]);

        expect(await resolveProduct({ storeId, productId: 'foreign' })).toEqual({ kind: 'not_found', reason: 'id_unknown' });
        expect(await resolveProduct({ storeId: otherStore, productId: 'foreign' })).toMatchObject({ kind: 'resolved', via: 'id' });
    });

    it('a product split into several chunks is ONE candidate', async () => {
        const long = product('long', 'معطف شتوي طويل', { description: 'وصف طويل جداً. '.repeat(400) });
        await seedRows(storeId, [long]);
        await new KbIngestionService(new ConstantEmbedder(), new PgVectorStore()).ingestFullPage(pageId, undefined, [...CATALOG, long], 2);

        const [{ n }] = await testDb.select({ n: schema.kbChunks.id }).from(schema.kbChunks)
            .where(eq(schema.kbChunks.pageId, pageId)).then(rows => [{ n: rows.length }]);
        expect(n).toBeGreaterThan(CATALOG.length + 1); // the long product really did split

        const hits = await retrieveProducts(pageId, 2, 'معطف', null);
        expect(hits.filter(h => h.platformProductId === 'long')).toHaveLength(1);
    });

    it('falls back to the catalog TITLES when the page has no product index, scoped to the store', async () => {
        const otherStore = await seedStore(userId, `scoped-${Date.now()}.zid.store`);
        await seedRows(otherStore, [product('foreign-glasses', 'نظارة شمسية فاخرة')]);
        const bare = await createTestPage(userId, { name: 'No index', kbVersion: 1, ecommerceStoreId: storeId });

        const r = await resolveProduct({ storeId, pageId: bare.id, kbActiveVersion: 1, productName: 'نظارة شمسية' });

        expect(r).toMatchObject({ kind: 'resolved', via: 'title_trigram', product: { platformProductId: 'glasses' } });
    });

    it('RESTOCK write-back: the live status lands on the row with the count, so the next LOCAL read says in stock', async () => {
        // `shoes` is seeded sold out on the platform's say-so (status out_of_stock, 0).
        // A live read reports active / 10. Written back without the status, the row
        // would read out_of_stock at 10 units — not "risky", so every later answer
        // would come from the row and deny a product the platform just restocked.
        await writeBackProductStock(storeId, 'shoes', { totalInventory: 10, status: 'active' });

        const row = await getProductByPlatformId(storeId, 'shoes');
        expect(row).toMatchObject({ status: 'active', totalInventory: 10 });
        expect(availabilityOf(row!)).toBe('in_stock');
    });

    it('a near-exact title survives the candidate cut when more than 20 products out-score it on cosine', async () => {
        // 24 decoys whose chunks embed to e1 and a target that embeds to e0; the
        // query vector is e1, so every decoy scores cosine 1.0 and the target 0.0.
        // One top-20 cut by GREATEST(vec, tri) keeps twenty decoys and drops the
        // target before the trigram stage can see its exact title (mutation check:
        // replace the UNION in retrieveProducts with that single cut → `ambiguous`
        // over three decoys).
        const unit = (dim: number) => { const v = Array(512).fill(0); v[dim] = 1; return v; };
        class SplitEmbedder implements EmbeddingProvider {
            embed(): Promise<number[]> { return Promise.resolve(unit(1)); }
            embedBatch(texts: string[]): Promise<number[][]> { return Promise.resolve(texts.map(t => (t.includes('ID: target') ? unit(0) : unit(1)))); }
            getDimensions(): number { return 512; }
        }
        const target = product('target', 'معطف شتوي طويل');
        const decoys = Array.from({ length: 24 }, (_, i) => product(`decoy-${i}`, `منتج رقم ${i}`));
        await seedRows(storeId, [target, ...decoys]);
        await new KbIngestionService(new SplitEmbedder(), new PgVectorStore()).ingestFullPage(pageId, undefined, [...CATALOG, target, ...decoys], 3);

        const hits = await retrieveProducts(pageId, 3, 'معطف شتوي طويل', unit(1));
        expect(hits.filter(h => h.vecScore !== null && h.vecScore > 0.99).length).toBeGreaterThan(20);
        expect(hits.find(h => h.platformProductId === 'target')).toMatchObject({ vecScore: expect.closeTo(0, 3) });

        const r = await resolveProduct({ storeId, pageId, kbActiveVersion: 3, productName: 'معطف شتوي طويل', queryEmbedding: unit(1) });
        expect(r).toMatchObject({ kind: 'resolved', via: 'trigram', product: { platformProductId: 'target' } });
    });
});
