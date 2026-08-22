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
}));

const mockLookupOrder = vi.fn();
const mockCheckInventory = vi.fn();
vi.mock('../../src/services/zid', () => ({
    lookupOrder: (...args: unknown[]) => mockLookupOrder(...args),
    getShipmentTracking: vi.fn(),
    checkInventory: (...args: unknown[]) => mockCheckInventory(...args),
}));

vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));

const STORE = 'store-1';
const zidStore = { id: STORE, platform: 'zid', isActive: true };

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
    it('counts a successful platform answer as success — exactly once', async () => {
        mockCheckInventory.mockResolvedValue({ productName: 'Sony A7S III', available: true });

        await executeToolCall(STORE, call('check_inventory', { product_name: 'Sony' }));

        expect(mockRedisIncr).toHaveBeenCalledTimes(1);
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:ecom:tool:check_inventory:success');
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

    it('counts a cache hit as cached, not success', async () => {
        mockRedisGet.mockResolvedValue(JSON.stringify({ tool_name: 'check_inventory', success: true, data: {} }));

        await executeToolCall(STORE, call('check_inventory', { product_name: 'Sony' }));

        expect(mockCheckInventory).not.toHaveBeenCalled();
        expect(mockRedisIncr).toHaveBeenCalledTimes(1);
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:ecom:tool:check_inventory:cached');
    });

    it('counts the early refusals too (unknown tool, disconnected store, verification)', async () => {
        await executeToolCall(STORE, { name: 'drop_tables' as EcommerceToolCall['name'], arguments: {} });
        expect(mockRedisIncr).toHaveBeenLastCalledWith('metrics:ecom:tool:drop_tables:unknown_tool');

        mockGetStoreById.mockResolvedValueOnce({ ...zidStore, isActive: false });
        await executeToolCall(STORE, call('check_inventory', { product_name: 'Sony' }));
        expect(mockRedisIncr).toHaveBeenLastCalledWith('metrics:ecom:tool:check_inventory:store_not_connected');

        await executeToolCall(STORE, call('verify_and_get_order', { order_number: '1234', provided_name: 'Ali' }));
        expect(mockRedisIncr).toHaveBeenLastCalledWith('metrics:ecom:tool:verify_and_get_order:verification_expired');

        expect(mockRedisIncr).toHaveBeenCalledTimes(3);
    });

    it('counts an api_error without masking the result', async () => {
        mockCheckInventory.mockRejectedValue(new Error('boom'));

        const result = await executeToolCall(STORE, call('check_inventory', { product_name: 'Sony' }));

        expect(result).toEqual({ tool_name: 'check_inventory', success: false, error: 'api_error' });
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:ecom:tool:check_inventory:api_error');
    });

    it('is fail-open: a Redis failure on the counter never affects the reply', async () => {
        mockRedisIncr.mockRejectedValue(new Error('redis down'));
        mockCheckInventory.mockResolvedValue({ productName: 'Sony A7S III', available: true });

        const result = await executeToolCall(STORE, call('check_inventory', { product_name: 'Sony' }));
        await settle();

        expect(result.success).toBe(true);
    });
});
