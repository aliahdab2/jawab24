/**
 * Product resolver — decision layer + flow (D-092).
 *
 * The thresholds are the probe's (docs/integrations/product-resolver-probe-2026-08-22.md);
 * the numbers in these cases are lifted from its per-query table so a threshold
 * drift fails here with the real phrasing that would regress.
 *
 * Mutation checks (each must turn a test red):
 *   - G_TRI = 0                                  → "two lexical hits close together" fails
 *   - T_CAND floor dropped (T_VEC = 0)           → "nothing above the floor" fails
 *   - semantic resolves without T_SOLO           → "«شماغ»" fails (0.298 vs 0.226 resolved a wrong product)
 *   - trigram stage skipped when embedding absent→ "never embeds" fails
 *   - by-id path trusts the id without the row   → "hallucinated id" fails
 *   - stale hit not re-validated against the row → "index lags the catalog" fails
 *   - lone candidate resolved without T_SOLO    → "lone survivor" and "«العود»" fail (the probe never resolved those)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProductHit } from '../../src/services/kb/retrieval';

const mockRetrieveProducts = vi.fn();
const mockEmbedForResolver = vi.fn();
vi.mock('../../src/services/kb/retrieval', () => ({
    retrieveProducts: (...args: unknown[]) => mockRetrieveProducts(...args),
    getRetrievalService: () => ({ embedForResolver: (...args: unknown[]) => mockEmbedForResolver(...args) }),
}));

const mockGetProductByPlatformId = vi.fn();
vi.mock('../../src/services/ecommerce', () => ({
    getProductByPlatformId: (...args: unknown[]) => mockGetProductByPlatformId(...args),
}));

const mockExecute = vi.fn();
vi.mock('../../src/db', () => ({ db: { execute: (...args: unknown[]) => mockExecute(...args) } }));

vi.mock('../../src/lib/redis', () => ({ redis: { incr: vi.fn().mockResolvedValue(1) } }));

import {
    resolveProduct, decideTrigram, decideSemantic, sanitizeProductId,
    T_TRI, G_TRI, T_SOLO, G_VEC,
} from '../../src/services/reply/productResolver';

const hit = (id: string, triScore: number, vecScore: number | null = null): ProductHit =>
    ({ platformProductId: id, title: id, triScore, vecScore });

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
    id: `row-${id}`, ecommerceStoreId: 'store-1', platformProductId: id, handle: id, title: `title ${id}`,
    description: null, productType: null, vendor: null, status: 'active', priceRange: '100 SAR', currency: 'SAR',
    totalInventory: 10, hasVariants: false, variantSummary: null, tags: null, imageUrl: null, ...overrides,
});

beforeEach(() => {
    vi.clearAllMocks();
    mockGetProductByPlatformId.mockImplementation(async (_s: string, id: string) => row(id));
    mockExecute.mockResolvedValue([]);
});

describe('decideTrigram — stage 1', () => {
    it('resolves an exact title: «نظارة شمسية» (tri 0.64 vs 0.00)', () => {
        expect(decideTrigram([hit('glasses', 0.64), hit('sony', 0.0), hit('shoes', 0.0)])?.platformProductId).toBe('glasses');
    });

    it('resolves a near-exact title with a clear lead: «عباية سوداء» (0.40 vs 0.16)', () => {
        expect(decideTrigram([hit('abayaBlack', 0.40), hit('abayaEmb', 0.16)])?.platformProductId).toBe('abayaBlack');
    });

    it('does NOT resolve the «ال» article on its own — «النظارة» scores 0.16, the semantic stage decides it', () => {
        expect(decideTrigram([hit('glasses', 0.16), hit('sony', 0.01)])).toBeNull();
    });

    it('does NOT resolve two lexical hits close together — «عباية» matches both abayas', () => {
        // Both clear T_TRI; the lead is below G_TRI → the semantic stage decides.
        expect(decideTrigram([hit('abayaEmb', T_TRI + 0.1), hit('abayaBlack', T_TRI + 0.1 - G_TRI + 0.01)])).toBeNull();
    });

    it('does NOT resolve below the floor — cross-script «سوني» has no trigram overlap with "Sony"', () => {
        expect(decideTrigram([hit('sony', 0.01), hit('glasses', 0.0)])).toBeNull();
    });

    it('a single hit above the floor resolves on its own', () => {
        expect(decideTrigram([hit('only', T_TRI)])?.platformProductId).toBe('only');
    });
});

describe('decideSemantic — stage 2 proposes more than it decides', () => {
    it('nothing above the floor → not_found («بتشحنوا لحلب» top 0.212)', () => {
        expect(decideSemantic([hit('a', 0, 0.212), hit('b', 0, 0.177)])).toEqual({ kind: 'not_found' });
    });

    it('«شماغ»: 0.298 vs 0.226 — above the floor but below T_SOLO → proposes, never resolves', () => {
        const d = decideSemantic([hit('abayaEmb', 0, 0.298), hit('abayaBlack', 0, 0.226), hit('bisht', 0, 0.212)]);
        expect(d.kind).toBe('ambiguous');
        // Only hits at/above T_VEC are candidates.
        expect((d as { candidateIds: string[] }).candidateIds).toEqual(['abayaEmb']);
    });

    it('resolves only with BOTH a solo-worthy score and a clear lead', () => {
        const clear = decideSemantic([hit('shoes', 0, T_SOLO + 0.2), hit('shirt', 0, T_SOLO + 0.2 - G_VEC - 0.01)]);
        expect(clear).toMatchObject({ kind: 'resolved', platformProductId: 'shoes' });

        const narrow = decideSemantic([hit('shoes', 0, 0.456), hit('shirt', 0, 0.339 + 0.06)]); // lead 0.057 < G_VEC
        expect(narrow.kind).toBe('ambiguous');
    });

    it('caps candidates at three', () => {
        const d = decideSemantic([hit('a', 0, 0.3), hit('b', 0, 0.29), hit('c', 0, 0.28), hit('d', 0, 0.27), hit('e', 0, 0.26)]);
        expect(d).toEqual({ kind: 'ambiguous', candidateIds: ['a', 'b', 'c'] });
    });

    it('a lone candidate above the floor but below T_SOLO is proposed, not resolved («العود» 0.318 alone ≥ 0.25)', () => {
        expect(decideSemantic([hit('oud', 0, 0.318), hit('a', 0, 0.230), hit('b', 0, 0.209)]))
            .toEqual({ kind: 'ambiguous', candidateIds: ['oud'] });
    });

    it('hits without a vector can never be candidates', () => {
        expect(decideSemantic([hit('a', 0.9, null)])).toEqual({ kind: 'not_found' });
    });
});

describe('sanitizeProductId', () => {
    it('accepts platform ids (uuid, numeric, demo_prod_1) and rejects junk', () => {
        expect(sanitizeProductId(' d2fc56d9-25f7-4479-9ad7-11ce24e05c6d ')).toBe('d2fc56d9-25f7-4479-9ad7-11ce24e05c6d');
        expect(sanitizeProductId('7001')).toBe('7001');
        expect(sanitizeProductId('demo_prod_1')).toBe('demo_prod_1');
        expect(sanitizeProductId('drop table;')).toBeNull();
        expect(sanitizeProductId('')).toBeNull();
        expect(sanitizeProductId('x'.repeat(65))).toBeNull();
    });
});

describe('resolveProduct — flow', () => {
    const base = { storeId: 'store-1', pageId: 'page-1', kbActiveVersion: 5 };

    it('by id: a valid id resolves from the ROW without touching the index', async () => {
        const r = await resolveProduct({ ...base, productId: 'sony', productName: 'كاميرا' });
        expect(r).toMatchObject({ kind: 'resolved', via: 'id', product: { platformProductId: 'sony' } });
        expect(mockRetrieveProducts).not.toHaveBeenCalled();
    });

    it('by id: a hallucinated id is decided in code — falls through to the name, never to the platform', async () => {
        mockGetProductByPlatformId.mockImplementation(async (_s: string, id: string) => (id === 'ghost' ? null : row(id)));
        mockRetrieveProducts.mockResolvedValue([hit('glasses', 0.64), hit('sony', 0.0)]);

        const r = await resolveProduct({ ...base, productId: 'ghost', productName: 'نظارة شمسية' });
        expect(r).toMatchObject({ kind: 'resolved', via: 'trigram', product: { platformProductId: 'glasses' } });

        const alone = await resolveProduct({ ...base, productId: 'ghost' });
        expect(alone).toEqual({ kind: 'not_found', reason: 'id_unknown' });
    });

    it('never embeds when the trigram stage already decided', async () => {
        mockRetrieveProducts.mockResolvedValue([hit('glasses', 0.64), hit('sony', 0.0)]);

        const r = await resolveProduct({ ...base, productName: 'نظارة شمسية' });

        expect(r).toMatchObject({ kind: 'resolved', via: 'trigram' });
        expect(mockEmbedForResolver).not.toHaveBeenCalled();
        expect(mockRetrieveProducts).toHaveBeenCalledTimes(1);
    });

    it('reuses the reply embedding: one index read, no embedding call', async () => {
        const embedding = [0.1, 0.2];
        mockRetrieveProducts.mockResolvedValue([hit('shoes', 0.01, 0.532), hit('shirt', 0.0, 0.386)]);

        const r = await resolveProduct({ ...base, productName: 'حذاء رياضي', queryEmbedding: embedding });

        expect(mockRetrieveProducts).toHaveBeenCalledWith('page-1', 5, 'حذاء رياضي', embedding);
        expect(mockEmbedForResolver).not.toHaveBeenCalled();
        expect(r).toMatchObject({ kind: 'resolved', via: 'hybrid', product: { platformProductId: 'shoes' } });
    });

    it('embeds ONLY when no embedding was supplied and the trigram stage could not decide', async () => {
        mockRetrieveProducts
            .mockResolvedValueOnce([hit('sony', 0.01), hit('glasses', 0.0)])            // no vector yet
            .mockResolvedValueOnce([hit('sony', 0.01, 0.376), hit('glasses', 0.0, 0.296)]); // with the vector
        mockEmbedForResolver.mockResolvedValue([0.3, 0.4]);

        const r = await resolveProduct({ ...base, productName: 'سوني', userId: 'user-1' });

        expect(mockEmbedForResolver).toHaveBeenCalledWith('سوني', 'user-1');
        expect(mockRetrieveProducts).toHaveBeenNthCalledWith(2, 'page-1', 5, 'سوني', [0.3, 0.4]);
        // 0.376 vs 0.296: above the floor, lead 0.08 < G_VEC → proposed, not decided.
        expect(r).toMatchObject({ kind: 'ambiguous' });
        expect((r as { candidates: Array<{ platformProductId: string }> }).candidates.map(c => c.platformProductId)).toEqual(['sony', 'glasses']);
    });

    it('ambiguous candidates carry title, availability and price from the ROW, in rank order', async () => {
        mockRetrieveProducts.mockResolvedValue([hit('abayaEmb', 0.25, 0.435), hit('abayaBlack', 0.25, 0.339), hit('oud', 0, 0.268)]);
        mockGetProductByPlatformId.mockImplementation(async (_s: string, id: string) =>
            row(id, id === 'abayaBlack' ? { status: 'out_of_stock', priceRange: '450 SAR' } : { priceRange: '750 - 950 SAR' }));

        const r = await resolveProduct({ ...base, productName: 'عباية', queryEmbedding: [1] });

        expect(r).toEqual({ kind: 'ambiguous', candidates: [
            { platformProductId: 'abayaEmb', title: 'title abayaEmb', availability: 'in_stock', price: '750 - 950 SAR' },
            { platformProductId: 'abayaBlack', title: 'title abayaBlack', availability: 'out_of_stock', price: '450 SAR' },
            { platformProductId: 'oud', title: 'title oud', availability: 'in_stock', price: '750 - 950 SAR' },
        ] });
    });

    it('index lags the catalog: a stale row is dropped and the decision is RE-TAKEN over the rest with the same thresholds', async () => {
        mockRetrieveProducts.mockResolvedValue([hit('stale', 0.5, 0.9), hit('shoes', 0.0, 0.5), hit('shirt', 0.0, 0.3)]);
        mockGetProductByPlatformId.mockImplementation(async (_s: string, id: string) => (id === 'stale' ? null : row(id)));

        const r = await resolveProduct({ ...base, productName: 'x', queryEmbedding: [1] });

        // Trigram winner was stale → semantic resolved 'stale' too → dropped → 0.5 vs 0.3 clears T_SOLO and G_VEC.
        expect(r).toMatchObject({ kind: 'resolved', via: 'hybrid', product: { platformProductId: 'shoes' } });
    });

    it('a lone survivor of stale candidates is PROPOSED, never resolved — T_SOLO still gates it', async () => {
        mockRetrieveProducts.mockResolvedValue([hit('stale', 0.5, 0.9), hit('real', 0.0, 0.3)]);
        mockGetProductByPlatformId.mockImplementation(async (_s: string, id: string) => (id === 'stale' ? null : row(id)));

        const r = await resolveProduct({ ...base, productName: 'x', queryEmbedding: [1] });

        // 0.3 alone is above the floor but below T_SOLO: "did you mean X?", not "X is in stock".
        expect(r).toMatchObject({ kind: 'ambiguous', candidates: [{ platformProductId: 'real' }] });
        expect((r as { candidates: unknown[] }).candidates).toHaveLength(1);
    });

    it('a lone candidate in the 0.25–0.35 zone is proposed end to end («العود» 0.318 vs 0.230)', async () => {
        mockRetrieveProducts.mockResolvedValue([hit('oud', 0.1, 0.318), hit('abaya', 0.0, 0.230), hit('bisht', 0.0, 0.209)]);

        const r = await resolveProduct({ ...base, productName: 'العود', queryEmbedding: [1] });

        expect(r).toMatchObject({ kind: 'ambiguous', candidates: [{ platformProductId: 'oud' }] });
        expect((r as { candidates: unknown[] }).candidates).toHaveLength(1);
    });

    it('nothing above the floor → not_found, and nothing is guessed', async () => {
        mockRetrieveProducts.mockResolvedValue([hit('glasses', 0.03, 0.212), hit('shoes', 0.0, 0.177)]);
        const r = await resolveProduct({ ...base, productName: 'بتشحنوا لحلب', queryEmbedding: [1] });
        expect(r).toEqual({ kind: 'not_found', reason: 'below_floor' });
    });

    it('no product index for the page → trigram over the catalog TITLES (no embedding, no platform)', async () => {
        mockRetrieveProducts.mockResolvedValue([]);
        mockExecute.mockResolvedValue([
            { platform_product_id: 'glasses', title: 'نظارة شمسية', tri_score: 0.36 },
            { platform_product_id: 'sony', title: 'Sony A7S III', tri_score: 0 },
        ]);

        const r = await resolveProduct({ ...base, productName: 'نظارة شمسية' });

        expect(mockEmbedForResolver).not.toHaveBeenCalled();
        expect(r).toMatchObject({ kind: 'resolved', via: 'title_trigram', product: { platformProductId: 'glasses' } });
    });

    it('no page at all → the title fallback still runs; an empty catalog is not_found', async () => {
        mockExecute.mockResolvedValue([]);
        const r = await resolveProduct({ storeId: 'store-1', productName: 'anything' });
        expect(r).toEqual({ kind: 'not_found', reason: 'empty_catalog' });
        expect(mockRetrieveProducts).not.toHaveBeenCalled();
    });

    it('no input → not_found without any lookup', async () => {
        expect(await resolveProduct({ ...base })).toEqual({ kind: 'not_found', reason: 'no_input' });
        expect(mockRetrieveProducts).not.toHaveBeenCalled();
        expect(mockGetProductByPlatformId).not.toHaveBeenCalled();
    });
});
