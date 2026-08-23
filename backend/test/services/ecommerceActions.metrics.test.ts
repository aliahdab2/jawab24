/**
 * executeToolCall outcome counters — `metrics:ecom:tool:{name}:{outcome}`.
 *
 * Why a counter: the order tools had zero recorded invocations in production and
 * nothing could distinguish "never called" from "called, refused before the
 * API". One increment per execution, keyed by outcome, is the cheapest signal
 * that answers that — and tells `invalid_order_number` (our sanitizer) apart
 * from `order_not_found` (the platform), which need opposite fixes.
 *
 * Mutation checks (each must turn a test red):
 *   - delete the recordToolOutcome call             → every test here fails
 *   - count only successes                          → the error-code tests fail
 *   - count a cache hit as `success`                → "cache hit" fails
 *   - let a rejected incr propagate                 → "fail-open" fails
 *   - increment twice per call (e.g. also in inner) → the `toHaveBeenCalledTimes(1)` pins fail
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeToolCall } from '../../src/services/ecommerceActions';
import type { EcommerceToolCall } from '@jawab24/shared';

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisIncr = vi.fn();

vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: (...args: unknown[]) => mockRedisGet(...args),
        set: (...args: unknown[]) => mockRedisSet(...args),
        incr: (...args: unknown[]) => mockRedisIncr(...args),
    },
}));

const mockGetStoreById = vi.fn();
vi.mock('../../src/services/ecommerce', () => ({
    getStoreById: (...args: unknown[]) => mockGetStoreById(...args),
    writeBackProductStock: vi.fn(),
    buildProductUrl: (_p: string, domain: string, handle: string) => `https://${domain}/products/${handle}`,
}));

// check_inventory resolves in code (D-092); here the resolver is a seam.
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
const mockGetProductById = vi.fn();
vi.mock('../../src/services/zid', () => ({
    lookupOrder: (...args: unknown[]) => mockLookupOrder(...args),
    getShipmentTracking: vi.fn(),
    getProductById: (...args: unknown[]) => mockGetProductById(...args),
}));

vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));

const STORE = 'store-1';
const zidStore = { id: STORE, platform: 'zid', isActive: true, storeDomain: 'shop.zid.store', lastSyncAt: new Date(), platformData: {} };
const sonyRow = {
    id: 'row-1', ecommerceStoreId: STORE, platformProductId: 'sony-1', handle: 'sony-a7s-iii', title: 'Sony A7S III',
    description: null, productType: null, vendor: null, status: 'active', priceRange: '10000 SAR', currency: 'SAR',
    totalInventory: null, hasVariants: false, variantSummary: null, tags: null, imageUrl: null,
};

const call = (name: EcommerceToolCall['name'], args: Record<string, string>): EcommerceToolCall =>
    ({ name, arguments: args });

/** Flush the fire-and-forget `.catch` so a rejected incr would surface as an unhandled rejection. */
const settle = () => new Promise(r => setImmediate(r));

beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisIncr.mockResolvedValue(1);
    mockGetStoreById.mockResolvedValue(zidStore);
});

describe('executeToolCall outcome counter', () => {
    it('counts a successful answer as success — exactly once', async () => {
        mockResolveProduct.mockResolvedValue({ kind: 'resolved', via: 'trigram', product: sonyRow });

        await executeToolCall(STORE, call('check_inventory', { product_name: 'Sony' }));

        expect(mockRedisIncr).toHaveBeenCalledTimes(1);
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:ecom:tool:check_inventory:success');
    });

    it('counts an ambiguous resolution under its own code', async () => {
        mockResolveProduct.mockResolvedValue({ kind: 'ambiguous', candidates: [
            { platformProductId: 'a', title: 'A', availability: 'in_stock' },
            { platformProductId: 'b', title: 'B', availability: 'in_stock' },
        ] });

        await executeToolCall(STORE, call('check_inventory', { product_name: 'عباية' }));

        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:ecom:tool:check_inventory:ambiguous_product');
    });

    it('counts a platform miss under its error code (order_not_found)', async () => {
        mockLookupOrder.mockResolvedValue(null);

        await executeToolCall(STORE, call('lookup_order', { order_number: '1234' }));

        expect(mockRedisIncr).toHaveBeenCalledTimes(1);
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:ecom:tool:lookup_order:order_not_found');
    });

    it('counts a sanitizer refusal under ITS code, distinct from a platform miss', async () => {
        // A letter-prefixed code never reaches the platform. If Zid order codes
        // turn out to carry a prefix, this is the counter that will say so.
        await executeToolCall(STORE, call('lookup_order', { order_number: 'ZD-1234' }));

        expect(mockLookupOrder).not.toHaveBeenCalled();
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:ecom:tool:lookup_order:invalid_order_number');
    });

    it('counts an order-tool cache hit as cached, not success', async () => {
        mockRedisGet.mockResolvedValue(JSON.stringify({ tool_name: 'lookup_order', success: true, data: { orderFound: true } }));

        await executeToolCall(STORE, call('lookup_order', { order_number: '1234' }));

        expect(mockLookupOrder).not.toHaveBeenCalled();
        expect(mockRedisIncr).toHaveBeenCalledTimes(1);
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:ecom:tool:lookup_order:cached');
    });

    it('counts the early refusals too (unknown tool, disconnected store, verification)', async () => {
        await executeToolCall(STORE, { name: 'drop_tables' as EcommerceToolCall['name'], arguments: {} });
        expect(mockRedisIncr).toHaveBeenLastCalledWith('metrics:ecom:tool:drop_tables:unknown_tool');

        mockGetStoreById.mockResolvedValueOnce({ ...zidStore, isActive: false });
        await executeToolCall(STORE, call('check_inventory', { product_name: 'Sony' }));
        expect(mockRedisIncr).toHaveBeenLastCalledWith('metrics:ecom:tool:check_inventory:store_not_connected');

        // No Phase-1 blob: Phase 2 reads the order live; the zid mock answers nothing.
        mockLookupOrder.mockResolvedValue(null);
        await executeToolCall(STORE, call('verify_and_get_order', { order_number: '1234', provided_name: 'Ali' }));
        expect(mockRedisIncr).toHaveBeenLastCalledWith('metrics:ecom:tool:verify_and_get_order:order_not_found');

        expect(mockRedisIncr).toHaveBeenCalledTimes(3);
    });

    it('counts HOW a passed verification was satisfied, in its own family, once — next to ONE tool success', async () => {
        const blob = {
            orderNumber: '1234', status: 'paid', customerFirstName: 'Ali', orderDate: '2026-01-01',
            items: [], totalAmount: '100', currency: 'SAR', paymentStatus: 'paid',
        };
        const key = (family: string) => `ecom:pending:${STORE}:${family}:1234`;

        // own: the requesting family's blob is there
        mockRedisGet.mockImplementation(async (k: string) => (k === key('order') ? JSON.stringify(blob) : null));
        await executeToolCall(STORE, call('verify_and_get_order', { order_number: '1234', provided_name: 'Ali' }));
        expect(mockRedisIncr.mock.calls.map(c => c[0])).toEqual([
            'metrics:ecom:verify:own',
            'metrics:ecom:tool:verify_and_get_order:success',
        ]);

        // live: no blob at all
        mockRedisIncr.mockClear();
        mockRedisGet.mockResolvedValue(null);
        mockLookupOrder.mockResolvedValue(blob);
        await executeToolCall(STORE, call('verify_and_get_order', { order_number: '1234', provided_name: 'Ali' }));
        expect(mockRedisIncr.mock.calls.map(c => c[0])).toEqual([
            'metrics:ecom:verify:live',
            'metrics:ecom:tool:verify_and_get_order:success',
        ]);

        // a failed check counts under the tool family only — no verify source
        mockRedisIncr.mockClear();
        await executeToolCall(STORE, call('verify_and_get_order', { order_number: '1234', provided_name: 'Someone' }));
        expect(mockRedisIncr.mock.calls.map(c => c[0])).toEqual([
            'metrics:ecom:tool:verify_and_get_order:verification_failed',
        ]);
    });

    it('counts an api_error without masking the result', async () => {
        mockResolveProduct.mockRejectedValue(new Error('boom'));

        const result = await executeToolCall(STORE, call('check_inventory', { product_name: 'Sony' }));

        expect(result).toEqual({ tool_name: 'check_inventory', success: false, error: 'api_error' });
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:ecom:tool:check_inventory:api_error');
    });

    it('is fail-open: a Redis failure on the counter never affects the reply', async () => {
        mockRedisIncr.mockRejectedValue(new Error('redis down'));
        mockResolveProduct.mockResolvedValue({ kind: 'resolved', via: 'trigram', product: sonyRow });

        const result = await executeToolCall(STORE, call('check_inventory', { product_name: 'Sony' }));
        await settle();

        expect(result.success).toBe(true);
    });
});
