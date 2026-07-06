/**
 * Stage 2 v2 — contextEnricher catalog branch.
 *
 * Store-less pages get context.productCatalog from catalog_items (the manual
 * catalog); store-linked pages keep the store summary. A page with neither
 * gets undefined — the prompt stays byte-identical (Phase B inertness).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enrichPageContext } from '../../src/services/reply/contextEnricher';

vi.mock('../../src/services/ecommerce', () => ({
    getStoreContextForAI: vi.fn(),
}));

vi.mock('../../src/services/catalog', () => ({
    catalogService: {
        buildCatalogPromptBlock: vi.fn(),
    },
}));

vi.mock('../../src/integrations', () => ({
    integrationRegistry: { getEnabled: () => [] },
}));

const { getStoreContextForAI } = await import('../../src/services/ecommerce');
const { catalogService } = await import('../../src/services/catalog');

const PAGE_ID = '11111111-1111-1111-1111-111111111111';
const STORE_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('enrichPageContext — catalog branch', () => {
    it('fills productCatalog from catalog_items for a store-less page', async () => {
        vi.mocked(catalogService.buildCatalogPromptBlock).mockResolvedValue('Items this business offers (merchant-entered):\n- منتج — 100 EGP — in stock');

        const ctx = await enrichPageContext({ id: PAGE_ID }, {}, 'بكام؟', undefined);

        expect(catalogService.buildCatalogPromptBlock).toHaveBeenCalledWith(PAGE_ID);
        expect(getStoreContextForAI).not.toHaveBeenCalled();
        expect(ctx.productCatalog).toContain('منتج — 100 EGP');
        expect(ctx.ecommerceStoreId).toBeUndefined();
    });

    it('leaves productCatalog undefined for a store-less page with no items (inertness)', async () => {
        vi.mocked(catalogService.buildCatalogPromptBlock).mockResolvedValue(undefined);

        const ctx = await enrichPageContext({ id: PAGE_ID }, {}, 'بكام؟', undefined);

        expect(ctx.productCatalog).toBeUndefined();
    });

    it('keeps the store summary for store-linked pages and never queries the manual catalog', async () => {
        vi.mocked(getStoreContextForAI).mockResolvedValue({
            storePolicies: 'Free shipping',
            productCatalog: 'Top Products:\n- Store Product — 220 AED — in stock',
        });

        const ctx = await enrichPageContext({ id: PAGE_ID, ecommerceStoreId: STORE_ID }, {}, 'price?', undefined);

        expect(getStoreContextForAI).toHaveBeenCalledWith(STORE_ID);
        expect(catalogService.buildCatalogPromptBlock).not.toHaveBeenCalled();
        expect(ctx.productCatalog).toContain('Store Product');
        expect(ctx.storePolicies).toBe('Free shipping');
    });

    it('degrades to no catalog block when the catalog query fails (non-critical)', async () => {
        vi.mocked(catalogService.buildCatalogPromptBlock).mockRejectedValue(new Error('db down'));

        const ctx = await enrichPageContext({ id: PAGE_ID }, {}, 'بكام؟', 'kb text');

        expect(ctx.productCatalog).toBeUndefined();
        expect(ctx.knowledgeBase).toContain('kb text'); // reply still proceeds with the KB
    });
});
