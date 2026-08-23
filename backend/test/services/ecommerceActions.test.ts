/**
 * Tests for E-Commerce Tool Executor
 *
 * Covers:
 * - Input sanitization (order number, product name, phone)
 * - Name/phone matching for identity verification
 * - executeToolCall routing, caching, verification flow, error handling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    sanitizeOrderNumber,
    sanitizeProductName,
    sanitizePhone,
    namesMatch,
    phonesMatch,
    executeToolCall,
} from '../../src/services/ecommerceActions';
import { captureError } from '../../src/utils/sentryHelpers';

// ---------- Mocks ----------

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
// The outcome counter (`metrics:ecom:tool:*`) is fire-and-forget; it is pinned in
// ecommerceActions.metrics.test.ts. Present here so the mock matches the real client.
const mockRedisIncr = vi.fn().mockResolvedValue(1);

vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: (...args: unknown[]) => mockRedisGet(...args),
        set: (...args: unknown[]) => mockRedisSet(...args),
        incr: (...args: unknown[]) => mockRedisIncr(...args),
    },
}));

const mockGetStoreById = vi.fn();
const mockWriteBackProductStock = vi.fn();
// URL helpers are production's own pure functions (Rule 10.8 — never a copy that can drift).
vi.mock('../../src/services/ecommerce', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../src/services/ecommerce')>();
    return {
        getStoreById: (...args: unknown[]) => mockGetStoreById(...args),
        writeBackProductStock: (...args: unknown[]) => mockWriteBackProductStock(...args),
        buildProductUrl: real.buildProductUrl,
        productUrlFor: real.productUrlFor,
    };
});

// check_inventory resolves in code (D-092); the resolver has its own suites.
// Here it is a seam: each test states what the resolver decided.
const mockResolveProduct = vi.fn();
vi.mock('../../src/services/reply/productResolver', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/services/reply/productResolver')>();
    return {
        ...actual,
        resolveProduct: (...args: unknown[]) => mockResolveProduct(...args),
        recordResolverOutcome: vi.fn(),
    };
});
vi.mock('../../src/services/demoStore', () => ({ isDemoStore: vi.fn(() => false) }));

const mockLookupOrder = vi.fn();
const mockGetShipmentTracking = vi.fn();
const mockGetProductById = vi.fn();

vi.mock('../../src/services/shopify', () => ({
    lookupOrder: (...args: unknown[]) => mockLookupOrder(...args),
    getShipmentTracking: (...args: unknown[]) => mockGetShipmentTracking(...args),
    getProductById: (...args: unknown[]) => mockGetProductById(...args),
}));

vi.mock('../../src/services/salla', () => ({
    lookupOrder: (...args: unknown[]) => mockLookupOrder(...args),
    getShipmentTracking: (...args: unknown[]) => mockGetShipmentTracking(...args),
    getProductById: (...args: unknown[]) => mockGetProductById(...args),
}));

// Zid was never mocked here before D-092 — a zid-platform test silently loaded
// the real module. The live-refresh cases below run on a zid store.
vi.mock('../../src/services/zid', () => ({
    lookupOrder: (...args: unknown[]) => mockLookupOrder(...args),
    getShipmentTracking: (...args: unknown[]) => mockGetShipmentTracking(...args),
    getProductById: (...args: unknown[]) => mockGetProductById(...args),
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

// The once-per-store Sentry throttle on a failed live refresh.
const mockClaimDailyOnce = vi.fn();
vi.mock('../../src/lib/dailyCap', () => ({
    claimDailyOnce: (...args: unknown[]) => mockClaimDailyOnce(...args),
}));

beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps queued `mockResolvedValueOnce` answers; a test that
    // queues two and consumes one would hand the other to the next test.
    mockLookupOrder.mockReset();
    mockGetShipmentTracking.mockReset();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockClaimDailyOnce.mockResolvedValue(true);
});

// ==========================================
// sanitizeOrderNumber
// ==========================================
describe('sanitizeOrderNumber', () => {
    it('accepts plain digits', () => {
        expect(sanitizeOrderNumber('1234')).toBe('1234');
    });

    it('strips leading #', () => {
        expect(sanitizeOrderNumber('#5678')).toBe('5678');
    });

    it('trims whitespace', () => {
        expect(sanitizeOrderNumber('  999  ')).toBe('999');
    });

    it('accepts digits with hyphens (some platforms)', () => {
        expect(sanitizeOrderNumber('123-456')).toBe('123-456');
    });

    it('rejects empty string', () => {
        expect(sanitizeOrderNumber('')).toBeNull();
    });

    it('rejects letters', () => {
        expect(sanitizeOrderNumber('abc')).toBeNull();
    });

    it('rejects injection attempts', () => {
        expect(sanitizeOrderNumber('1234; DROP TABLE')).toBeNull();
        expect(sanitizeOrderNumber('1234<script>')).toBeNull();
    });

    it('rejects strings longer than 20 chars', () => {
        expect(sanitizeOrderNumber('123456789012345678901')).toBeNull();
    });

    it('accepts max length (20 digits)', () => {
        expect(sanitizeOrderNumber('12345678901234567890')).toBe('12345678901234567890');
    });
});

// ==========================================
// sanitizeProductName
// ==========================================
describe('sanitizeProductName', () => {
    it('accepts normal product names', () => {
        expect(sanitizeProductName('iPhone 15 Pro')).toBe('iPhone 15 Pro');
    });

    it('accepts Arabic product names', () => {
        expect(sanitizeProductName('عطر العود')).toBe('عطر العود');
    });

    it('strips injection characters', () => {
        // Regex strips < and > but not tag names — resulting in "productscriptalert(1)/script"
        expect(sanitizeProductName('product<script>alert(1)</script>')).toBe('productscriptalert(1)/script');
    });

    it('strips brackets and backslash', () => {
        expect(sanitizeProductName('test[1]{2}\\3')).toBe('test123');
    });

    it('truncates to 200 chars', () => {
        const long = 'a'.repeat(250);
        expect(sanitizeProductName(long)?.length).toBe(200);
    });

    it('rejects empty string', () => {
        expect(sanitizeProductName('')).toBeNull();
    });

    it('rejects whitespace-only', () => {
        expect(sanitizeProductName('   ')).toBeNull();
    });
});

// ==========================================
// sanitizePhone
// ==========================================
describe('sanitizePhone', () => {
    it('accepts Saudi phone number', () => {
        expect(sanitizePhone('+966501234567')).toBe('+966501234567');
    });

    it('strips spaces and dashes', () => {
        expect(sanitizePhone('+966 50 123 4567')).toBe('+966501234567');
    });

    it('strips parentheses', () => {
        expect(sanitizePhone('(050) 123-4567')).toBe('0501234567');
    });

    it('rejects too-short numbers', () => {
        expect(sanitizePhone('12345')).toBeNull();
    });

    it('rejects too-long numbers (>15 digits)', () => {
        expect(sanitizePhone('1234567890123456')).toBeNull();
    });

    it('rejects letters', () => {
        expect(sanitizePhone('abc12345678')).toBeNull();
    });

    it('rejects empty string', () => {
        expect(sanitizePhone('')).toBeNull();
    });
});

// ==========================================
// namesMatch
// ==========================================
describe('namesMatch', () => {
    it('matches exact same name', () => {
        expect(namesMatch('محمد العلي', 'محمد العلي')).toBe(true);
    });

    it('matches case-insensitive', () => {
        expect(namesMatch('Ahmed Ali', 'ahmed ali')).toBe(true);
    });

    it('matches first name only (stored full, provided first)', () => {
        expect(namesMatch('محمد العلي', 'محمد')).toBe(true);
    });

    it('matches first name only (stored first, provided full)', () => {
        expect(namesMatch('محمد', 'محمد العلي')).toBe(true);
    });

    it('does not match middle name (startsWith only, no substring search)', () => {
        // Security: substring matching was removed to prevent brute-force attacks
        expect(namesMatch('Abdullah Mohammed Al Rashid', 'Mohammed')).toBe(false);
    });

    it('does NOT match a short prefix of the first name (brute-force guard)', () => {
        // Regression: a 2-char prefix used to pass (startsWith), letting an attacker
        // guess "mo"/"ah" to read another customer's order. Full first-name token only.
        expect(namesMatch('mohammed', 'mo')).toBe(false);
        expect(namesMatch('Ahmed Ali', 'Ah')).toBe(false);
        expect(namesMatch('fatima', 'fat')).toBe(false);
    });

    it('does not match completely different names', () => {
        expect(namesMatch('محمد', 'فاطمة')).toBe(false);
    });

    it('returns false for empty stored name', () => {
        expect(namesMatch('', 'محمد')).toBe(false);
    });

    it('returns false for empty provided name', () => {
        expect(namesMatch('محمد', '')).toBe(false);
    });

    it('returns false for single-character provided name (min 2 chars required)', () => {
        expect(namesMatch('Ahmad', 'a')).toBe(false);
    });
});

// ==========================================
// phonesMatch
// ==========================================
describe('phonesMatch', () => {
    it('matches identical numbers', () => {
        expect(phonesMatch('0501234567', '0501234567')).toBe(true);
    });

    it('matches with/without country code (+966)', () => {
        expect(phonesMatch('+966501234567', '0501234567')).toBe(true);
    });

    it('matches when both have country code', () => {
        expect(phonesMatch('+966501234567', '+966501234567')).toBe(true);
    });

    it('does not match different numbers', () => {
        expect(phonesMatch('+966501234567', '+966509876543')).toBe(false);
    });

    it('returns false for too-short numbers', () => {
        expect(phonesMatch('123', '123')).toBe(false);
    });
});

// ==========================================
// executeToolCall
// ==========================================
describe('executeToolCall', () => {
    const storeId = 'store-123';

    it('rejects unknown tool names', async () => {
        const result = await executeToolCall(storeId, {
            name: 'drop_table' as 'lookup_order',
            arguments: {},
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('unknown_tool');
    });

    it('returns store_not_connected when store is inactive', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: false, platform: 'shopify' });

        const result = await executeToolCall(storeId, {
            name: 'lookup_order',
            arguments: { order_number: '1234' },
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('store_not_connected');
    });

    it('returns store_not_connected when store not found', async () => {
        mockGetStoreById.mockResolvedValue(null);

        const result = await executeToolCall(storeId, {
            name: 'lookup_order',
            arguments: { order_number: '1234' },
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('store_not_connected');
    });

    it('returns cached result when available (order tools only)', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'shopify' });
        const cached = { tool_name: 'lookup_order', success: true, data: { orderFound: true } };
        mockRedisGet.mockResolvedValue(JSON.stringify(cached));

        const result = await executeToolCall(storeId, {
            name: 'lookup_order',
            arguments: { order_number: '1234' },
        });
        expect(result).toEqual(cached);
        expect(mockLookupOrder).not.toHaveBeenCalled();
    });

    it('keys the order cache on SANITIZED arguments — "#1234" and "1234" share an entry', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'shopify' });
        mockLookupOrder.mockResolvedValue({
            orderNumber: '1234', status: 'paid', customerFirstName: 'محمد', orderDate: '2026-01-01',
            items: [], totalAmount: '100', currency: 'SAR', paymentStatus: 'paid',
        });

        await executeToolCall(storeId, { name: 'lookup_order', arguments: { order_number: '#1234' } });
        await executeToolCall(storeId, { name: 'lookup_order', arguments: { order_number: ' 1234 ' } });

        const keys = mockRedisGet.mock.calls.map(c => c[0]).filter(k => String(k).startsWith('ecom:tool:'));
        expect(keys).toHaveLength(2);
        expect(keys[0]).toBe(keys[1]);
    });

    it('check_inventory: NEVER reads or writes the result cache (resolution is local and deterministic)', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'zid', id: storeId, storeDomain: 'shop.zid.store', lastSyncAt: new Date(), platformData: {} });
        mockResolveProduct.mockResolvedValue({ kind: 'resolved', via: 'trigram', product: productRow({ totalInventory: 20 }) });

        const result = await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_name: 'نظارة' } });

        expect(result.success).toBe(true);
        expect(mockRedisGet.mock.calls.some(c => String(c[0]).startsWith('ecom:tool:'))).toBe(false);
        expect(mockRedisSet.mock.calls.some(c => String(c[0]).startsWith('ecom:tool:'))).toBe(false);
    });

    it('calls shopify service for lookup_order on shopify stores', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'shopify' });
        mockLookupOrder.mockResolvedValue({
            orderNumber: '1234',
            status: 'paid',
            customerFirstName: 'محمد',
            customerPhone: '+966501234567',
            orderDate: '2026-01-01',
            items: [],
            totalAmount: '100',
            currency: 'SAR',
            paymentStatus: 'paid',
        });

        const result = await executeToolCall(storeId, {
            name: 'lookup_order',
            arguments: { order_number: '1234' },
        });

        expect(result.success).toBe(true);
        // Phase 1: should return verification challenge, NOT order details
        expect(result.data).toHaveProperty('orderFound', true);
        expect(result.data).toHaveProperty('message');
        expect(result.data).not.toHaveProperty('status');
        expect(result.data).not.toHaveProperty('customerFirstName');
    });

    it('returns order_not_found when shopify returns null', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'shopify' });
        mockLookupOrder.mockResolvedValue(null);

        const result = await executeToolCall(storeId, {
            name: 'lookup_order',
            arguments: { order_number: '9999' },
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('order_not_found');
    });

    it('returns invalid_order_number for bad input', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'shopify' });

        const result = await executeToolCall(storeId, {
            name: 'lookup_order',
            arguments: { order_number: 'abc' },
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('invalid_order_number');
    });

    it('returns invalid_product_name for empty product name', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'shopify' });

        const result = await executeToolCall(storeId, {
            name: 'check_inventory',
            arguments: { product_name: '' },
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('invalid_product_name');
    });

    it('returns unsupported_platform for unknown platforms', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'woocommerce' });

        const result = await executeToolCall(storeId, {
            name: 'lookup_order',
            arguments: { order_number: '1234' },
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('unsupported_platform');
    });

    it('returns insufficient_permissions for 403 errors', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'shopify' });
        mockLookupOrder.mockRejectedValue(new Error('403 Forbidden'));

        const result = await executeToolCall(storeId, {
            name: 'lookup_order',
            arguments: { order_number: '1234' },
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('insufficient_permissions');
    });

    it('returns api_error for unexpected errors', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'shopify' });
        mockLookupOrder.mockRejectedValue(new Error('network timeout'));

        const result = await executeToolCall(storeId, {
            name: 'lookup_order',
            arguments: { order_number: '1234' },
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('api_error');
    });

    it('caches successful order results in Redis', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'shopify' });
        mockLookupOrder.mockResolvedValue({
            orderNumber: '1234', status: 'paid', customerFirstName: 'محمد', orderDate: '2026-01-01',
            items: [], totalAmount: '100', currency: 'SAR', paymentStatus: 'paid',
        });

        await executeToolCall(storeId, {
            name: 'lookup_order',
            arguments: { order_number: '1234' },
        });

        expect(mockRedisSet).toHaveBeenCalledWith(
            expect.stringContaining('ecom:tool:'),
            expect.any(String),
            'EX',
            300,
        );
    });

    it('handles Redis unavailability gracefully', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'shopify' });
        mockRedisGet.mockRejectedValue(new Error('Redis down'));
        mockLookupOrder.mockResolvedValue({
            orderNumber: '1234', status: 'paid', customerFirstName: 'محمد', orderDate: '2026-01-01',
            items: [], totalAmount: '100', currency: 'SAR', paymentStatus: 'paid',
        });

        const result = await executeToolCall(storeId, {
            name: 'lookup_order',
            arguments: { order_number: '1234' },
        });
        // Should still succeed — Redis is non-critical
        expect(result.success).toBe(true);
    });
});

// ==========================================
// check_inventory — resolve in code, answer locally, platform by id only when risky (D-092)
// ==========================================

/** A synced ecommerce_products row as getProductByPlatformId returns it. */
function productRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'row-1',
        ecommerceStoreId: 'store-123',
        platformProductId: 'zid-42',
        handle: 'sunglasses',
        title: 'نظارة شمسية',
        description: null,
        productType: null,
        vendor: null,
        status: 'active',
        priceRange: '250 SAR',
        currency: 'SAR',
        totalInventory: 20,
        hasVariants: false,
        variantSummary: null,
        tags: null,
        imageUrl: 'https://cdn/sunglasses.jpg',
        ...overrides,
    };
}

const MINUTES = 60 * 1000;

describe('executeToolCall — check_inventory', () => {
    const storeId = 'store-123';
    const freshStore = () => ({
        id: storeId, isActive: true, platform: 'zid', storeDomain: 'shop.zid.store',
        lastSyncAt: new Date(), platformData: {},
    });
    const staleStore = () => ({ ...freshStore(), lastSyncAt: new Date(Date.now() - 60 * MINUTES) });

    beforeEach(() => {
        mockGetStoreById.mockResolvedValue(freshStore());
    });

    it('rejects a call with neither product_id nor product_name', async () => {
        const result = await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_name: '   ' } });
        expect(result).toEqual({ tool_name: 'check_inventory', success: false, error: 'invalid_product_name' });
        expect(mockResolveProduct).not.toHaveBeenCalled();
    });

    it('hands the resolver the sanitized id + name AND the reply context (page, version, embedding, user)', async () => {
        mockResolveProduct.mockResolvedValue({ kind: 'resolved', via: 'id', product: productRow() });
        const ctx = { pageId: 'page-1', kbActiveVersion: 7, queryEmbedding: [0.1, 0.2], userId: 'user-1' };

        await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_id: ' zid-42 ', product_name: 'نظارة <b>' } }, ctx);

        expect(mockResolveProduct).toHaveBeenCalledWith(expect.objectContaining({
            storeId, productId: 'zid-42', productName: 'نظارة b', pageId: 'page-1', kbActiveVersion: 7, queryEmbedding: [0.1, 0.2], userId: 'user-1',
        }));
    });

    it('not_found → product_not_found, nothing cached, platform never called', async () => {
        mockResolveProduct.mockResolvedValue({ kind: 'not_found', reason: 'below_floor' });

        const result = await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_name: 'ساعة ذكية' } });

        expect(result).toEqual({ tool_name: 'check_inventory', success: false, error: 'product_not_found' });
        expect(mockGetProductById).not.toHaveBeenCalled();
        expect(mockRedisSet).not.toHaveBeenCalled();
    });

    it('ambiguous → ambiguous_product WITH the candidates, no card data, nothing cached', async () => {
        const candidates = [
            { platformProductId: 'salla1', title: 'عباية كلاسيك سوداء', availability: 'in_stock', price: '450 SAR' },
            { platformProductId: 'salla2', title: 'عباية مطرزة فاخرة', availability: 'in_stock', price: '750 - 950 SAR' },
        ];
        mockResolveProduct.mockResolvedValue({ kind: 'ambiguous', candidates });

        const result = await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_name: 'عباية' } });

        expect(result).toEqual({ tool_name: 'check_inventory', success: false, error: 'ambiguous_product', candidates });
        expect(mockRedisSet).not.toHaveBeenCalled();
    });

    it('resolved + plenty in stock → answers LOCALLY with identity, price as stored, and asOf = last sync', async () => {
        const lastSyncAt = new Date('2026-08-22T13:36:06.758Z');
        mockGetStoreById.mockResolvedValue({ ...staleStore(), lastSyncAt });
        mockResolveProduct.mockResolvedValue({ kind: 'resolved', via: 'trigram', product: productRow({ totalInventory: 20 }) });

        const result = await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_name: 'النظارة' } });

        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({
            platformProductId: 'zid-42',
            productName: 'نظارة شمسية',
            available: true,
            availability: 'in_stock',
            quantity: 20,
            price: '250 SAR',
            productUrl: 'https://shop.zid.store/products/sunglasses',
            imageUrl: 'https://cdn/sunglasses.jpg',
            source: 'local',
            asOf: lastSyncAt.toISOString(),
        });
        // Stale but NOT risky (20 units): no platform call.
        expect(mockGetProductById).not.toHaveBeenCalled();
    });

    it('unlimited (null) stock never refreshes, even when stale — and carries no quantity', async () => {
        mockGetStoreById.mockResolvedValue(staleStore());
        mockResolveProduct.mockResolvedValue({ kind: 'resolved', via: 'id', product: productRow({ totalInventory: null }) });

        const result = await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_id: 'zid-42' } });

        expect(result.data).toMatchObject({ available: true, availability: 'in_stock', source: 'local' });
        expect(result.data).not.toHaveProperty('quantity');
        expect(mockGetProductById).not.toHaveBeenCalled();
    });

    it('low stock but FRESH sync → local (the figure is recent enough)', async () => {
        mockGetStoreById.mockResolvedValue(freshStore());
        mockResolveProduct.mockResolvedValue({ kind: 'resolved', via: 'id', product: productRow({ totalInventory: 2 }) });

        const result = await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_id: 'zid-42' } });

        expect(result.data).toMatchObject({ availability: 'low_stock', quantity: 2, source: 'local' });
        expect(mockGetProductById).not.toHaveBeenCalled();
    });

    it('low stock AND stale → asks the platform BY ID, writes the figure back to the row, answers live', async () => {
        mockGetStoreById.mockResolvedValue(staleStore());
        mockResolveProduct.mockResolvedValue({ kind: 'resolved', via: 'id', product: productRow({ totalInventory: 2 }) });
        mockGetProductById.mockResolvedValue({
            platformProductId: 'zid-42', title: 'نظارة شمسية', status: 'active', priceRange: '250 SAR', currency: 'SAR',
            totalInventory: 0, hasVariants: false, handle: 'sunglasses', imageUrl: 'https://cdn/sunglasses.jpg',
            variants: [{ name: 'Color: Black', available: false, quantity: 0 }],
        });

        const result = await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_id: 'zid-42' } });

        expect(mockGetProductById).toHaveBeenCalledWith(storeId, 'zid-42');
        expect(mockWriteBackProductStock).toHaveBeenCalledWith(storeId, 'zid-42', { totalInventory: 0, status: 'active' });
        expect(result.data).toMatchObject({
            platformProductId: 'zid-42', available: false, availability: 'out_of_stock', quantity: 0, source: 'live',
            variants: [{ name: 'Color: Black', available: false, quantity: 0 }],
        });
        // The live read is cached per product, not per phrasing.
        expect(mockRedisSet).toHaveBeenCalledWith(`ecom:stock:${storeId}:zid-42`, expect.any(String), 'EX', expect.any(Number));
    });

    it('live refresh FAILS → the synced figure is served as local, never api_error, never a wrong product', async () => {
        mockGetStoreById.mockResolvedValue(staleStore());
        mockResolveProduct.mockResolvedValue({ kind: 'resolved', via: 'id', product: productRow({ totalInventory: 2 }) });
        mockGetProductById.mockRejectedValue(new Error('zid API HTTP error: 502'));

        const result = await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_id: 'zid-42' } });

        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ platformProductId: 'zid-42', quantity: 2, source: 'local' });
        expect(mockWriteBackProductStock).not.toHaveBeenCalled();
    });

    it('a failed live refresh reaches Sentry ONCE per store per window — the counter carries the volume', async () => {
        mockGetStoreById.mockResolvedValue(staleStore());
        mockResolveProduct.mockResolvedValue({ kind: 'resolved', via: 'id', product: productRow({ totalInventory: 2 }) });
        mockGetProductById.mockRejectedValue(new Error('zid API HTTP error: 401'));
        mockClaimDailyOnce.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

        await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_id: 'zid-42' } });
        await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_id: 'zid-42' } });

        expect(mockClaimDailyOnce).toHaveBeenCalledWith(`ecom:stock:failed:${storeId}`, expect.any(Number));
        expect(vi.mocked(captureError)).toHaveBeenCalledTimes(1);
    });

    it('RESTOCK: the live status is written back WITH the count, so the row cannot say "out of stock" at 10 units', async () => {
        // Row: sold out on the platform's say-so (Salla `out` / Zid `out_of_stock`),
        // stale → risky → live read. The platform now reports active / 10.
        mockGetStoreById.mockResolvedValue(staleStore());
        mockResolveProduct.mockResolvedValue({ kind: 'resolved', via: 'id', product: productRow({ status: 'out_of_stock', totalInventory: 0 }) });
        mockGetProductById.mockResolvedValue({
            platformProductId: 'zid-42', title: 'نظارة شمسية', status: 'active', priceRange: '250 SAR', currency: 'SAR',
            totalInventory: 10, hasVariants: false, handle: 'sunglasses', imageUrl: null,
        });

        const result = await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_id: 'zid-42' } });

        expect(result.data).toMatchObject({ availability: 'in_stock', quantity: 10, source: 'live' });
        // Writing `totalInventory: 10` alone would leave `status = 'out_of_stock'` on a
        // row that is no longer "risky" — every later local answer would deny it
        // until the next sync. The status is part of the same write.
        expect(mockWriteBackProductStock).toHaveBeenCalledWith(storeId, 'zid-42', { totalInventory: 10, status: 'active' });
    });

    it('a store that never synced carries NO asOf — never an epoch placeholder the model would read out', async () => {
        mockGetStoreById.mockResolvedValue({ ...freshStore(), lastSyncAt: null });
        mockResolveProduct.mockResolvedValue({ kind: 'resolved', via: 'id', product: productRow({ totalInventory: 20 }) });

        const result = await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_id: 'zid-42' } });

        expect(result.data).toMatchObject({ source: 'local', quantity: 20 });
        expect(result.data).not.toHaveProperty('asOf');
    });

    it('a sold-out product (status out_of_stock) is answered as out of stock, not denied', async () => {
        mockResolveProduct.mockResolvedValue({ kind: 'resolved', via: 'trigram', product: productRow({ status: 'out_of_stock', totalInventory: 3 }) });

        const result = await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_name: 'نظارة' } });

        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ available: false, availability: 'out_of_stock' });
    });

    it('filters live variants by the sanitized variant hint, falling back to all when nothing matches', async () => {
        mockGetStoreById.mockResolvedValue(staleStore());
        mockResolveProduct.mockResolvedValue({ kind: 'resolved', via: 'id', product: productRow({ totalInventory: 1 }) });
        const variants = [
            { name: 'Size: M', available: true, quantity: 1 },
            { name: 'Size: L', available: false, quantity: 0 },
        ];
        mockGetProductById.mockResolvedValue({
            platformProductId: 'zid-42', title: 'قميص', status: 'active', priceRange: '150 SAR', currency: 'SAR',
            totalInventory: 1, hasVariants: true, handle: 'shirt', imageUrl: null, variants,
        });

        // Quotes/brackets are stripped, case is folded: ' "M" ' → 'M' → matches 'Size: M'.
        const m = await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_id: 'zid-42', variant: ' "M" ' } });
        expect((m.data as { variants: unknown[] }).variants).toEqual([variants[0]]);

        const none = await executeToolCall(storeId, { name: 'check_inventory', arguments: { product_id: 'zid-42', variant: 'XXL' } });
        expect((none.data as { variants: unknown[] }).variants).toEqual(variants);
    });
});

// ==========================================
// Verification flow (Phase 2)
// ==========================================
describe('executeToolCall — verification', () => {
    const storeId = 'store-123';

    // Phase 1 parks its blob under ecom:pending:<store>:<family>:<order>. Every
    // test here answers Redis PER KEY — a mock that returns the same blob for any
    // key is exactly what hid the production defect (the wrong family's key was
    // read and the mock said yes anyway).
    const pendingKey = (family: 'order' | 'shipment', n = '1234') => `ecom:pending:${storeId}:${family}:${n}`;
    const answerOnly = (entries: Record<string, unknown>) =>
        mockRedisGet.mockImplementation(async (key: string) => (key in entries ? JSON.stringify(entries[key]) : null));

    const orderBlob = {
        orderNumber: '1234',
        status: 'paid',
        customerFirstName: 'محمد العلي',
        customerPhone: '+966501234567',
        orderDate: '2026-01-01',
        items: [{ name: 'عطر', quantity: 1, price: '100' }],
        totalAmount: '100',
        currency: 'SAR',
        paymentStatus: 'paid',
    };
    const shipmentBlob = {
        orderNumber: '1234',
        status: 'in_transit',
        trackingNumber: 'TRACK123',
        courierName: 'Aramex',
        customerFirstName: 'محمد العلي',
        customerPhone: '+966501234567',
    };

    beforeEach(() => {
        mockGetStoreById.mockResolvedValue({ id: storeId, isActive: true, platform: 'shopify' });
        answerOnly({});
    });

    it('returns verification_failed when name does not match', async () => {
        answerOnly({ [pendingKey('order')]: orderBlob });

        const result = await executeToolCall(storeId, {
            name: 'verify_and_get_order',
            arguments: { order_number: '1234', provided_name: 'فاطمة' },
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('verification_failed');
    });

    it('returns order data when name matches — read from the OWN family key', async () => {
        answerOnly({ [pendingKey('order')]: orderBlob });

        const result = await executeToolCall(storeId, {
            name: 'verify_and_get_order',
            arguments: { order_number: '1234', provided_name: 'محمد' },
        });
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('orderNumber', '1234');
        expect(result.data).toHaveProperty('status', 'paid');
        // PII must be stripped
        expect(result.data).not.toHaveProperty('customerFirstName');
        expect(result.data).not.toHaveProperty('customerPhone');
        expect(mockRedisGet).toHaveBeenCalledWith(pendingKey('order'));
        expect(mockLookupOrder).not.toHaveBeenCalled();
    });

    it('returns data when phone matches', async () => {
        answerOnly({ [pendingKey('order')]: { ...orderBlob, status: 'shipped' } });

        const result = await executeToolCall(storeId, {
            name: 'verify_and_get_order',
            arguments: { order_number: '1234', provided_phone: '0501234567' },
        });
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('status', 'shipped');
    });

    it('returns name_or_phone_required when neither is provided', async () => {
        const result = await executeToolCall(storeId, {
            name: 'verify_and_get_order',
            arguments: { order_number: '1234' },
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('name_or_phone_required');
    });

    it('returns invalid_order_number for bad order number in verification', async () => {
        const result = await executeToolCall(storeId, {
            name: 'verify_and_get_order',
            arguments: { order_number: 'abc', provided_name: 'محمد' },
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('invalid_order_number');
    });

    it('handles shipment verification the same way', async () => {
        answerOnly({ [pendingKey('shipment')]: shipmentBlob });

        const result = await executeToolCall(storeId, {
            name: 'verify_and_get_shipment',
            arguments: { order_number: '1234', provided_name: 'محمد' },
        });
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('trackingNumber', 'TRACK123');
        expect(result.data).not.toHaveProperty('customerFirstName');
        expect(mockGetShipmentTracking).not.toHaveBeenCalled();
    });

    it('returns store_not_connected for a disconnected store', async () => {
        mockGetStoreById.mockResolvedValue(null);

        const result = await executeToolCall(storeId, {
            name: 'verify_and_get_order',
            arguments: { order_number: '1234', provided_name: 'محمد' },
        });
        expect(result.error).toBe('store_not_connected');
    });

    // ---- The cross-family repair (production: lookup_order then verify_and_get_shipment, 4/4 expired) ----

    it('verify_and_get_shipment verifies against the ORDER blob when only lookup_order ran, then reads the shipment live', async () => {
        answerOnly({ [pendingKey('order')]: orderBlob });
        mockGetShipmentTracking.mockResolvedValue(shipmentBlob);

        const result = await executeToolCall(storeId, {
            name: 'verify_and_get_shipment',
            arguments: { order_number: '1234', provided_name: 'محمد' },
        });

        expect(mockRedisGet).toHaveBeenCalledWith(pendingKey('shipment'));
        expect(mockRedisGet).toHaveBeenCalledWith(pendingKey('order'));
        expect(mockGetShipmentTracking).toHaveBeenCalledWith(storeId, '1234');
        expect(mockLookupOrder).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('trackingNumber', 'TRACK123');
        expect(result.data).not.toHaveProperty('customerFirstName');
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:ecom:verify:sibling');
    });

    it('verified from the sibling blob but the requested read fails → returns the sibling data, never a dead end', async () => {
        answerOnly({ [pendingKey('order')]: orderBlob });
        mockGetShipmentTracking.mockRejectedValue(new Error('502 Bad Gateway'));

        const result = await executeToolCall(storeId, {
            name: 'verify_and_get_shipment',
            arguments: { order_number: '1234', provided_name: 'محمد' },
        });

        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('status', 'paid');
        expect(result.data).not.toHaveProperty('trackingNumber');
        expect(mockClaimDailyOnce).toHaveBeenCalledWith(`ecom:verify:live_failed:${storeId}`, 600);
        expect(captureError).toHaveBeenCalledTimes(1);
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:ecom:verify:requested_live_failed');
    });

    // An unshipped order asked about by TRACKING is the commonest cross-family
    // case, and it is not a failure: the platform answered, it just has no
    // shipment yet. Counting it as `requested_live_failed` would report the
    // healthy path as a platform failure and bury the 403 that SALLA_TEST_PLAN
    // 3.8 uses these counters to find.
    it('sibling blob + the requested family is EMPTY (not shipped yet) counts as requested_empty, never as a failure', async () => {
        answerOnly({ [pendingKey('order')]: orderBlob });
        mockGetShipmentTracking.mockResolvedValue(null);

        const result = await executeToolCall(storeId, {
            name: 'verify_and_get_shipment',
            arguments: { order_number: '1234', provided_name: 'محمد' },
        });

        expect(mockGetShipmentTracking).toHaveBeenCalledWith(storeId, '1234');
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('status', 'paid');
        expect(result.data).not.toHaveProperty('trackingNumber');
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:ecom:verify:requested_empty');
        expect(mockRedisIncr).not.toHaveBeenCalledWith('metrics:ecom:verify:requested_live_failed');
        // Nothing threw, so nothing is reported.
        expect(captureError).not.toHaveBeenCalled();
    });

    it('a wrong name against the sibling blob fails WITHOUT reading the requested family', async () => {
        answerOnly({ [pendingKey('order')]: orderBlob });
        mockGetShipmentTracking.mockResolvedValue(shipmentBlob);

        const result = await executeToolCall(storeId, {
            name: 'verify_and_get_shipment',
            arguments: { order_number: '1234', provided_name: 'فاطمة' },
        });

        expect(result.error).toBe('verification_failed');
        expect(mockGetShipmentTracking).not.toHaveBeenCalled();
        expect(mockLookupOrder).not.toHaveBeenCalled();
    });

    // ---- No blob at all (cache-served Phase 1, or the customer answered after the TTL) ----

    it('with NO pending blob, reads the requested family live and verifies against it', async () => {
        mockLookupOrder.mockResolvedValue(orderBlob);

        const result = await executeToolCall(storeId, {
            name: 'verify_and_get_order',
            arguments: { order_number: '1234', provided_name: 'محمد' },
        });

        expect(mockLookupOrder).toHaveBeenCalledWith(storeId, '1234');
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('status', 'paid');
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:ecom:verify:live');
    });

    it('a live Phase-2 read parks the blob (600 s) so a retry costs no platform call', async () => {
        mockLookupOrder.mockResolvedValue(orderBlob);

        await executeToolCall(storeId, {
            name: 'verify_and_get_order',
            arguments: { order_number: '1234', provided_name: 'محمد' },
        });

        expect(mockRedisSet).toHaveBeenCalledWith(pendingKey('order'), expect.any(String), 'EX', 600);
    });

    // The exact residual the docstring on handleVerification states: with nothing
    // parked, the order MUST be fetched to have anything to compare against, so a
    // wrong guess does cost one platform call and does park the blob. What the
    // check gates is every byte returned, not the read. Asserted rather than
    // described, so the claim in the docstring cannot drift from the code.
    it('with NO pending blob and a wrong name: the live read DOES happen and parks, and still nothing is returned', async () => {
        mockLookupOrder.mockResolvedValue(orderBlob);

        const result = await executeToolCall(storeId, {
            name: 'verify_and_get_order',
            arguments: { order_number: '1234', provided_name: 'فاطمة' },
        });

        expect(mockLookupOrder).toHaveBeenCalledWith(storeId, '1234');
        expect(mockRedisSet).toHaveBeenCalledWith(pendingKey('order'), expect.any(String), 'EX', 600);
        expect(result.error).toBe('verification_failed');
        expect(result).not.toHaveProperty('data');
        // ...and the park is what bounds it: a second guess reads no platform.
        mockLookupOrder.mockClear();
        answerOnly({ [pendingKey('order')]: orderBlob });
        await executeToolCall(storeId, {
            name: 'verify_and_get_order',
            arguments: { order_number: '1234', provided_name: 'سارة' },
        });
        expect(mockLookupOrder).not.toHaveBeenCalled();
    });

    it('live Phase 2 on an unknown order → order_not_found (not verification_expired)', async () => {
        mockLookupOrder.mockResolvedValue(null);

        const result = await executeToolCall(storeId, {
            name: 'verify_and_get_order',
            arguments: { order_number: '1234', provided_name: 'محمد' },
        });
        expect(result.error).toBe('order_not_found');
    });

    it('live Phase 2: a 403 → insufficient_permissions, any other throw → api_error', async () => {
        mockGetShipmentTracking.mockRejectedValueOnce(new Error('403 Forbidden'));
        const denied = await executeToolCall(storeId, {
            name: 'verify_and_get_shipment',
            arguments: { order_number: '1234', provided_name: 'محمد' },
        });
        expect(denied.error).toBe('insufficient_permissions');

        mockGetShipmentTracking.mockRejectedValueOnce(new Error('network timeout'));
        const failed = await executeToolCall(storeId, {
            name: 'verify_and_get_shipment',
            arguments: { order_number: '1234', provided_name: 'محمد' },
        });
        expect(failed.error).toBe('api_error');
    });

    it('Redis down in Phase 2 still verifies via the live read', async () => {
        mockRedisGet.mockRejectedValue(new Error('Redis down'));
        mockLookupOrder.mockResolvedValue(orderBlob);

        const result = await executeToolCall(storeId, {
            name: 'verify_and_get_order',
            arguments: { order_number: '1234', provided_name: 'محمد' },
        });
        expect(result.success).toBe(true);
    });
});

// ==========================================
// Phase 1 challenge names the verify tool of ITS family
// ==========================================
describe('executeToolCall — Phase 1 challenge', () => {
    const storeId = 'store-123';
    const blob = {
        orderNumber: '1234', status: 'paid', customerFirstName: 'محمد', orderDate: '2026-01-01',
        items: [], totalAmount: '100', currency: 'SAR', paymentStatus: 'paid',
    };

    beforeEach(() => {
        mockGetStoreById.mockResolvedValue({ id: storeId, isActive: true, platform: 'shopify' });
    });

    it('lookup_order tells the model to call verify_and_get_order — and only that', async () => {
        mockLookupOrder.mockResolvedValue(blob);
        const result = await executeToolCall(storeId, { name: 'lookup_order', arguments: { order_number: '1234' } });
        const message = String((result.data as { message: string }).message);
        expect(message).toContain('verify_and_get_order');
        expect(message).not.toContain('verify_and_get_shipment');
        expect(mockRedisSet).toHaveBeenCalledWith(`ecom:pending:${storeId}:order:1234`, expect.any(String), 'EX', 600);
    });

    it('track_shipment tells the model to call verify_and_get_shipment — and only that', async () => {
        mockGetShipmentTracking.mockResolvedValue({ ...blob, status: 'in_transit', trackingNumber: 'T1' });
        const result = await executeToolCall(storeId, { name: 'track_shipment', arguments: { order_number: '1234' } });
        const message = String((result.data as { message: string }).message);
        expect(message).toContain('verify_and_get_shipment');
        expect(message).not.toContain('verify_and_get_order');
        expect(mockRedisSet).toHaveBeenCalledWith(`ecom:pending:${storeId}:shipment:1234`, expect.any(String), 'EX', 600);
    });
});
