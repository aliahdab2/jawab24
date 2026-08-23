/**
 * Determinism tests for `buildProductSummary` — the function that produces the
 * e-commerce store catalog blob injected into every AI prompt. The output must
 * be byte-stable across calls for a given store, otherwise OpenAI's prompt cache
 * (which keys on prefix bytes) misses on every reply for store users — costing
 * 50% extra on input tokens for Shopify/Salla/Zid merchants.
 *
 * Pre-fix bug: the underlying products query had no ORDER BY, so PostgreSQL
 * returned rows in arbitrary order across calls, busting the cache silently.
 * Fix: `.orderBy(ecommerceProducts.id)`.
 *
 * These tests pin the contract: identical store data → identical summary string,
 * regardless of the order rows happen to come back from the DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }));

vi.mock('../../src/db', () => ({ db: { select: selectMock } }));
vi.mock('../../src/db/schema', () => ({
    ecommerceStores: { id: 'id', storeDomain: 'storeDomain', platform: 'platform' },
    ecommerceProducts: { id: 'id', ecommerceStoreId: 'ecommerceStoreId', status: 'status' },
    pages: {},
    pendingEcommerceInstalls: {},
    workspaceMembers: {},
}));
vi.mock('drizzle-orm', () => ({
    eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
    and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
    desc: vi.fn((col: unknown) => ({ op: 'desc', col })),
    notInArray: vi.fn(),
    // buildProductSummary admits every SELLABLE status (active + out_of_stock) since D-092.
    inArray: vi.fn((col: unknown, values: unknown[]) => ({ op: 'inArray', col, values })),
    lt: vi.fn(),
    sql: Object.assign((s: TemplateStringsArray) => ({ op: 'sql', s }), { raw: vi.fn() }),
}));
vi.mock('../../src/services/ecommerceCrypto', () => ({
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    encryptOptional: vi.fn(() => ({})),
    decryptOptional: vi.fn(),
}));
vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
    redisScanDelete: vi.fn(),
}));
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));
vi.mock('../../src/services/customerNotifications', () => ({
    customerNotificationService: { seedDefaults: vi.fn() },
}));

interface ProductRow {
    id: string;
    platformProductId?: string;
    title: string;
    priceRange: string | null;
    variantSummary: string | null;
    totalInventory: number | null;
    handle: string | null;
    productUrl?: string | null;
}

interface StoreRow {
    storeDomain: string;
    platform: string;
    platformData?: unknown;
}

const STORE_ROW: StoreRow = { storeDomain: 'demo.myshopify.com', platform: 'shopify' };

function setupQueryMocks(products: ProductRow[], storeRow: StoreRow = STORE_ROW) {
    // First select: store row → .where().limit() resolves to [storeRow]
    const storeLimit = vi.fn().mockResolvedValue([storeRow]);
    const storeWhere = vi.fn().mockReturnValue({ limit: storeLimit });
    // Second select: products → .where().orderBy().limit() resolves to products
    // The orderBy is the determinism guard under test.
    const productsLimit = vi.fn().mockResolvedValue(products);
    const productsOrderBy = vi.fn().mockReturnValue({ limit: productsLimit });
    const productsWhere = vi.fn().mockReturnValue({ orderBy: productsOrderBy });

    selectMock
        .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: storeWhere }) })
        .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: productsWhere }) });

    return { productsOrderBy };
}

const PRODUCTS: ProductRow[] = [
    { id: 'p-001', title: 'Phone A', priceRange: '500-1000 SAR', variantSummary: '3 variants', totalInventory: 10, handle: 'phone-a' },
    { id: 'p-002', title: 'Laptop B', priceRange: '2000-3000 SAR', variantSummary: null, totalInventory: 5, handle: 'laptop-b' },
    { id: 'p-003', title: 'Charger C', priceRange: '50 SAR', variantSummary: null, totalInventory: 0, handle: 'charger-c' },
];

beforeEach(() => {
    selectMock.mockReset();
});

describe('buildProductSummary — prompt-cache determinism', () => {
    it('issues the products query with .orderBy() so DB order is deterministic', async () => {
        // Without ORDER BY, PostgreSQL row order varies across calls and busts
        // OpenAI's prompt cache. The fix adds .orderBy(ecommerceProducts.id) —
        // this test pins it so a future "cleanup" doesn't silently remove it.
        const { productsOrderBy } = setupQueryMocks(PRODUCTS);

        const { buildProductSummary } = await import('../../src/services/ecommerce');
        await buildProductSummary('store-1');

        expect(productsOrderBy).toHaveBeenCalledTimes(1);
        // In-stock rows first (a sold-out row must not displace a buyable one from
        // the 15 inline slots), then the products table's id as the total order —
        // the tiebreak is what keeps the output byte-stable.
        const [first, second] = productsOrderBy.mock.calls[0]!;
        expect(first).toMatchObject({ op: 'sql' });
        expect(second).toBe('id');
    });

    it('returns byte-identical output for identical inputs across calls', async () => {
        // Two independent calls with the same product data must produce identical
        // strings. If anything in the pipeline (iteration, formatting, conditionals)
        // is non-deterministic, the cache would miss.
        setupQueryMocks(PRODUCTS);
        const { buildProductSummary } = await import('../../src/services/ecommerce');
        const first = await buildProductSummary('store-1');

        setupQueryMocks(PRODUCTS); // re-prime mocks for the second call
        const second = await buildProductSummary('store-1');

        expect(second).toBe(first);
        expect(first).toContain('Phone A');
        expect(first).toContain('Laptop B');
        expect(first).toContain('Charger C');
    });

    it('produces a different summary when the product set actually changes (sanity check the determinism test isn\'t a no-op)', async () => {
        setupQueryMocks(PRODUCTS);
        const { buildProductSummary } = await import('../../src/services/ecommerce');
        const original = await buildProductSummary('store-1');

        const changed: ProductRow[] = [
            ...PRODUCTS,
            { id: 'p-004', title: 'New Tablet', priceRange: '1500 SAR', variantSummary: null, totalInventory: 8, handle: 'tablet-d' },
        ];
        setupQueryMocks(changed);
        const updated = await buildProductSummary('store-1');

        expect(updated).not.toBe(original);
        expect(updated).toContain('New Tablet');
    });

    it('returns empty string when the store has no active products (avoids cache-key drift on empty catalogs)', async () => {
        setupQueryMocks([]);
        const { buildProductSummary } = await import('../../src/services/ecommerce');
        const result = await buildProductSummary('store-1');

        expect(result).toBe('');
    });
});

/**
 * F1 — stock vocabulary. `totalInventory: null` means the platform reports the
 * product as untracked/unlimited (Zid `is_infinite: true`), NOT that it has zero
 * units. The summary is the catalog blob every reply is grounded on, so getting
 * this wrong tells customers a flagship product is unavailable.
 */
describe('buildProductSummary — stock vocabulary', () => {
    const rowsWith = (totalInventory: number | null): ProductRow[] => [
        { id: 'p-001', title: 'Sony A7S III', priceRange: '10000 SAR', variantSummary: null, totalInventory, handle: 'sony-a7s-iii' },
    ];

    it('renders unlimited (null) inventory as in stock', async () => {
        setupQueryMocks(rowsWith(null));
        const { buildProductSummary } = await import('../../src/services/ecommerce');
        const summary = await buildProductSummary('store-1');

        expect(summary).toContain('Sony A7S III');
        expect(summary).toContain('in stock');
        expect(summary).not.toContain('out of stock');
        expect(summary).not.toContain('low stock');
    });

    it('still renders a genuinely empty tracked product as out of stock', async () => {
        setupQueryMocks(rowsWith(0));
        const { buildProductSummary } = await import('../../src/services/ecommerce');
        const summary = await buildProductSummary('store-1');

        expect(summary).toContain('out of stock');
    });

    it('still renders a nearly-empty tracked product as low stock', async () => {
        setupQueryMocks(rowsWith(3));
        const { buildProductSummary } = await import('../../src/services/ecommerce');
        const summary = await buildProductSummary('store-1');

        expect(summary).toContain('low stock');
    });
});

/**
 * Links (2026-08-23). The Salla test store's catalog block read
 * `Store: https://https://demostore.salla.sa/…`, listed no product link at all
 * (Salla has no slug, so `handle` was always null) and no category link — so the
 * model invented `?category=تنورة` for a customer who asked for the skirts page.
 */
describe('buildProductSummary — links', () => {
    const SALLA_STORE: StoreRow = {
        storeDomain: 'demostore.salla.sa/dev-jkgsyu3w6pzzfrzw',
        platform: 'salla',
        platformData: {
            merchantId: '1',
            categories: [
                { name: 'تنانير', url: 'https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنانير/c101' },
                { name: 'فساتين', url: 'https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/فساتين/c102' },
            ],
        },
    };
    const SALLA_ROWS: ProductRow[] = [
        { id: 'p-1', platformProductId: '900', title: 'تنورة', priceRange: '79 SAR', variantSummary: null, totalInventory: 3, handle: null, productUrl: 'https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنورة/p900' },
        { id: 'p-2', platformProductId: '901', title: 'فستان', priceRange: '94 SAR', variantSummary: null, totalInventory: 12, handle: null, productUrl: null },
        // A Salla row that somehow carries a handle (the old demo seed did) must NOT get a
        // derived `/products/{handle}` — no such page exists on a Salla storefront.
        { id: 'p-3', platformProductId: '902', title: 'بلوزة', priceRange: '59 SAR', variantSummary: null, totalInventory: 8, handle: 'stale-handle', productUrl: null },
    ];

    it('never doubles the scheme, even on a row stored with one', async () => {
        setupQueryMocks(PRODUCTS, { storeDomain: 'https://demostore.salla.sa/dev-x', platform: 'salla' });
        const { buildProductSummary } = await import('../../src/services/ecommerce');
        const summary = await buildProductSummary('store-1');
        expect(summary).toContain('Store: https://demostore.salla.sa/dev-x\n');
        expect(summary).not.toContain('https://https://');
    });

    it('uses the platform-canonical product URL and lists NO link when the row has none (never a derived Salla URL)', async () => {
        setupQueryMocks(SALLA_ROWS, SALLA_STORE);
        const { buildProductSummary } = await import('../../src/services/ecommerce');
        const summary = await buildProductSummary('store-1');
        const lines = summary.split('\n');
        // Each line carries the platform id in the chunker's `(ID: …)` form — the
        // identity the model passes to check_inventory and names in respond.product_ids.
        expect(lines.find(l => l.startsWith('تنورة'))).toBe('تنورة (ID: 900) — 79 SAR — low stock — https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنورة/p900');
        expect(lines.find(l => l.startsWith('فستان'))).toBe('فستان (ID: 901) — 94 SAR — in stock');
        expect(lines.find(l => l.startsWith('بلوزة'))).toBe('بلوزة (ID: 902) — 59 SAR — in stock');
        expect(summary).not.toContain('/p/');
        expect(summary).not.toContain('stale-handle');
    });

    it('lists the category links between Store: and Top Products:', async () => {
        setupQueryMocks(SALLA_ROWS, SALLA_STORE);
        const { buildProductSummary } = await import('../../src/services/ecommerce');
        const summary = await buildProductSummary('store-1');
        expect(summary.split('\n').slice(0, 3)).toEqual([
            'Store: https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw',
            'Categories: تنانير — https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنانير/c101 | فساتين — https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/فساتين/c102',
            'Top Products:',
        ]);
    });

    it('omits the Categories line when the store has none', async () => {
        setupQueryMocks(SALLA_ROWS, { ...SALLA_STORE, platformData: { merchantId: '1' } });
        const { buildProductSummary } = await import('../../src/services/ecommerce');
        const summary = await buildProductSummary('store-1');
        expect(summary).not.toContain('Categories:');
        expect(summary.split('\n')[1]).toBe('Top Products:');
    });

    it('keeps the product budget independent of the categories line (categories never crowd out products)', async () => {
        const many: ProductRow[] = Array.from({ length: 15 }, (_, i) => ({
            id: `p-${i}`, title: `منتج ${i}`, priceRange: '100 SAR', variantSummary: 'المقاس: 44 - XL, 42 - L, 40 - M', totalInventory: 10, handle: null,
            productUrl: `https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/منتج-${i}/p${1000 + i}`,
        }));
        const categories = Array.from({ length: 10 }, (_, i) => ({ name: `قسم ${i}`, url: `https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/قسم-${i}/c${i}` }));

        setupQueryMocks(many, { ...SALLA_STORE, platformData: { categories: [] } });
        const { buildProductSummary } = await import('../../src/services/ecommerce');
        const withoutCategories = await buildProductSummary('store-1');

        setupQueryMocks(many, { ...SALLA_STORE, platformData: { categories } });
        const withCategories = await buildProductSummary('store-1');

        const productLines = (s: string) => s.split('\n').filter(l => l.startsWith('منتج '));
        expect(productLines(withCategories)).toEqual(productLines(withoutCategories));
        expect(withCategories.split('\n')[1].startsWith('Categories: ')).toBe(true);
        expect(withCategories.split('\n')[1].length).toBeLessThanOrEqual(600);
    });

    it('ignores a malformed categories value rather than rendering it', async () => {
        setupQueryMocks(SALLA_ROWS, { ...SALLA_STORE, platformData: { categories: 'not-a-list' } });
        const { buildProductSummary } = await import('../../src/services/ecommerce');
        expect(await buildProductSummary('store-1')).not.toContain('Categories:');
    });
});
