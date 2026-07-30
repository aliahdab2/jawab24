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

vi.mock('../../src/services/factCollections', () => ({
    factCollectionsService: {
        buildFactCollectionsContext: vi.fn(),
    },
}));

vi.mock('../../src/integrations', () => ({
    integrationRegistry: { getEnabled: () => [] },
}));

const { getStoreContextForAI } = await import('../../src/services/ecommerce');
const { catalogService } = await import('../../src/services/catalog');
const { factCollectionsService } = await import('../../src/services/factCollections');

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

/**
 * G1a — the fact-collections branch. Deliberately NOT inside the store/no-store
 * either-or above: a list of outlets or delivery zones is orthogonal to whether the
 * page sells online, and the measured worst page in the sweep (BAMBO LIBYA, 28%
 * fabrication) is store-less while متجر إجدابيا's delivery table is not. Gating this
 * on the store branch the way productCatalog is gated would silently skip the block
 * for half the fleet.
 */
describe('enrichPageContext — fact-collections branch', () => {
    const LISTS = 'صيدليات المدينة:\n- صيدلية الفيروز — المنطقة: تلة الريح\nهذه القائمة تغطي «المنطقة» التالية فقط: تلة الريح.';

    it('fills factCollectionsBlock for a store-less page', async () => {
        vi.mocked(factCollectionsService.buildFactCollectionsContext).mockResolvedValue({ block: LISTS, gated: false });

        const ctx = await enrichPageContext({ id: PAGE_ID }, {}, 'وين نلقاكم؟', undefined);

        expect(factCollectionsService.buildFactCollectionsContext).toHaveBeenCalledWith(PAGE_ID, 'وين نلقاكم؟');
        expect(ctx.factCollectionsBlock).toContain('صيدلية الفيروز');
    });

    it('ALSO fills it for a store-linked page (unlike the catalog, this is not either-or)', async () => {
        vi.mocked(getStoreContextForAI).mockResolvedValue({
            storePolicies: 'Free shipping',
            productCatalog: 'Top Products:\n- Store Product — 220 AED — in stock',
        });
        vi.mocked(factCollectionsService.buildFactCollectionsContext).mockResolvedValue({ block: LISTS, gated: false });

        const ctx = await enrichPageContext({ id: PAGE_ID, ecommerceStoreId: STORE_ID }, {}, 'توصلون لبنغازي؟', undefined);

        expect(ctx.productCatalog).toContain('Store Product');
        expect(ctx.factCollectionsBlock).toContain('صيدلية الفيروز');
    });

    it('leaves the block undefined when the page has no collections (inertness)', async () => {
        vi.mocked(factCollectionsService.buildFactCollectionsContext).mockResolvedValue({ block: undefined, gated: false });

        const ctx = await enrichPageContext({ id: PAGE_ID }, {}, 'وين نلقاكم؟', undefined);

        expect(ctx.factCollectionsBlock).toBeUndefined();
    });

    it('degrades to no block when the query fails, and the reply still proceeds', async () => {
        vi.mocked(factCollectionsService.buildFactCollectionsContext).mockRejectedValue(new Error('db down'));

        const ctx = await enrichPageContext({ id: PAGE_ID }, {}, 'وين نلقاكم؟', 'kb text');

        expect(ctx.factCollectionsBlock).toBeUndefined();
        expect(ctx.knowledgeBase).toContain('kb text');
    });

    // C1: this flag is what disables the semantic cache for a place-specific reply.
    // If it stops being propagated, the cache silently starts serving one area's
    // outlets for another — a failure with no local symptom, so it is pinned here.
    it('propagates the gated flag so the caller can refuse to semantic-cache', async () => {
        vi.mocked(factCollectionsService.buildFactCollectionsContext).mockResolvedValue({ block: LISTS, gated: true });

        const ctx = await enrichPageContext({ id: PAGE_ID }, {}, 'وين نلقاكم؟', undefined);

        expect(ctx.factCollectionsGated).toBe(true);
    });

    it('reports not-gated when the page has no collections', async () => {
        vi.mocked(factCollectionsService.buildFactCollectionsContext).mockResolvedValue({ block: undefined, gated: false });

        const ctx = await enrichPageContext({ id: PAGE_ID }, {}, 'وين نلقاكم؟', undefined);

        expect(ctx.factCollectionsGated).toBe(false);
    });

    // H2: the DM pipeline passes the consolidated burst, so «أنا من عين الدالية» +
    // «وين نلقاكم؟» sent seconds apart still matches the customer's own area.
    it('matches against matchText when the caller supplies one', async () => {
        vi.mocked(factCollectionsService.buildFactCollectionsContext).mockResolvedValue({ block: LISTS, gated: true });

        await enrichPageContext({ id: PAGE_ID }, {}, 'وين نلقاكم؟', undefined, 'أنا من عين الدالية\nوين نلقاكم؟');

        expect(factCollectionsService.buildFactCollectionsContext)
            .toHaveBeenCalledWith(PAGE_ID, 'أنا من عين الدالية\nوين نلقاكم؟');
    });

    it('skips the query entirely when there is no pageId', async () => {
        const ctx = await enrichPageContext({}, {}, 'وين نلقاكم؟', 'kb text');

        expect(factCollectionsService.buildFactCollectionsContext).not.toHaveBeenCalled();
        expect(ctx.factCollectionsBlock).toBeUndefined();
    });
});
