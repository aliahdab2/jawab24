/**
 * Tool-result cards — keyed on the product the resolver CHOSE (D-092).
 *
 * Before: the builder re-resolved the product by `ILIKE 'title%' LIMIT 1` — a
 * second, different matcher — so a card could show a product the answer never
 * named, and the currency was printed twice. Now the card is built from the
 * result's own identity (`platformProductId`, `imageUrl`, `price` as stored)
 * and the row is read by KEY only when the result carries no image.
 *
 * Mutation checks (each must turn a test red):
 *   - drop the `platformProductId` guard              → "no identity" fails
 *   - re-append `currency` to the subtitle            → "printed once" fails
 *   - read the image by title instead of by key       → "reads the row by KEY" fails
 *   - treat `low_stock` as in stock                   → "three-way" fails
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EcommerceToolResult, InventoryInfo } from '@jawab24/shared';

const mockGetProductByPlatformId = vi.fn();
// URL helpers are production's own pure functions (Rule 10.8 — never a copy that can drift).
vi.mock('../../src/services/ecommerce', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../src/services/ecommerce')>();
    return {
        getProductByPlatformId: (...args: unknown[]) => mockGetProductByPlatformId(...args),
        buildProductUrl: real.buildProductUrl,
        productUrlFor: real.productUrlFor,
    };
});

// The mention path (other suite) needs db; the tool path must not touch it.
const mockSelect = vi.fn();
vi.mock('../../src/db', () => ({ db: { select: (...args: unknown[]) => mockSelect(...args) } }));

const mockRedisIncr = vi.fn().mockResolvedValue(1);
vi.mock('../../src/lib/redis', () => ({
    redis: { incr: (...args: unknown[]) => mockRedisIncr(...args), mget: vi.fn(), pipeline: vi.fn() },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));

import { buildProductCardsFromToolResults } from '../../src/services/reply/productCardBuilder';

const STORE_ID = 'store-1';

function inventoryResult(data: Partial<InventoryInfo>): EcommerceToolResult {
    return {
        tool_name: 'check_inventory',
        success: true,
        data: {
            platformProductId: 'p-1',
            productName: 'Blue Cotton Shirt',
            available: true,
            availability: 'in_stock',
            quantity: 12,
            source: 'local',
            asOf: '2026-08-22T13:36:06.758Z',
            ...data,
        } as unknown as Record<string, unknown>,
    };
}

describe('productCardBuilder — tool results', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetProductByPlatformId.mockResolvedValue(null);
    });

    it('returns [] when there are no tool results', async () => {
        expect(await buildProductCardsFromToolResults(STORE_ID, [], 'en')).toEqual([]);
        expect(mockGetProductByPlatformId).not.toHaveBeenCalled();
    });

    it('skips failed tool results — an ambiguous_product answer never cards a candidate', async () => {
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            { tool_name: 'check_inventory', success: false, error: 'ambiguous_product', candidates: [
                { platformProductId: 'a', title: 'A', availability: 'in_stock' },
                { platformProductId: 'b', title: 'B', availability: 'in_stock' },
            ] },
            { tool_name: 'check_inventory', success: false, error: 'product_not_found' },
        ], 'en');
        expect(cards).toEqual([]);
        expect(mockGetProductByPlatformId).not.toHaveBeenCalled();
    });

    it('skips successful results with no data, and tools we do not render', async () => {
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            { tool_name: 'check_inventory', success: true },
            { tool_name: 'lookup_order', success: true, data: { orderNumber: '#1001' } as Record<string, unknown> },
        ], 'en');
        expect(cards).toEqual([]);
    });

    it('no identity (an old cached result shape) → no card, counted, never guessed by name', async () => {
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ platformProductId: undefined, productUrl: 'https://shop.test/p', imageUrl: 'https://cdn/x.jpg' }),
        ], 'en');
        expect(cards).toEqual([]);
        expect(mockGetProductByPlatformId).not.toHaveBeenCalled();
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:product_card:tool:no_identity');
    });

    it('returns [] when productUrl is missing (no link → no card)', async () => {
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ productUrl: undefined, imageUrl: 'https://cdn/x.jpg' }),
        ], 'en');
        expect(cards).toEqual([]);
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:product_card:tool:no_url');
    });

    it('uses the image carried on the result without touching the DB', async () => {
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ productUrl: 'https://shop.test/p/blue-shirt', imageUrl: 'https://cdn.test/shirt.jpg', price: '120 SAR' }),
        ], 'en');

        expect(mockGetProductByPlatformId).not.toHaveBeenCalled();
        expect(cards).toEqual([{
            title: 'Blue Cotton Shirt',
            subtitle: '120 SAR · In stock',
            imageUrl: 'https://cdn.test/shirt.jpg',
            productUrl: 'https://shop.test/p/blue-shirt',
            buttons: [{ type: 'web_url', title: 'View product', url: 'https://shop.test/p/blue-shirt' }],
        }]);
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:product_card:tool:fired');
    });

    it('reads the row by KEY (platformProductId, any status) when the result carries no image', async () => {
        mockGetProductByPlatformId.mockResolvedValue({ imageUrl: 'https://cdn.test/row.jpg' });
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ productUrl: 'https://shop.test/p', imageUrl: undefined }),
        ], 'en');

        expect(mockGetProductByPlatformId).toHaveBeenCalledWith(STORE_ID, 'p-1', { sellable: false });
        expect(cards[0].imageUrl).toBe('https://cdn.test/row.jpg');
    });

    it('returns [] when neither the result nor the row has an image (graceful degrade to text)', async () => {
        mockGetProductByPlatformId.mockResolvedValue({ imageUrl: null });
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ productUrl: 'https://shop.test/p' }),
        ], 'en');
        expect(cards).toEqual([]);
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:product_card:tool:no_image');
    });

    it('prints the price ONCE — `price` already carries its currency, `currency` is not appended', async () => {
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ productUrl: 'https://shop.test/p', imageUrl: 'https://cdn/x.jpg', price: '250 SAR', currency: 'SAR' }),
        ], 'en');
        expect(cards[0].subtitle).toBe('250 SAR · In stock');
    });

    it('renders the three-way availability: low stock and out of stock are not "in stock"', async () => {
        const low = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ productUrl: 'https://shop.test/p', imageUrl: 'https://cdn/x.jpg', availability: 'low_stock', quantity: 2 }),
        ], 'en');
        expect(low[0].subtitle).toBe('Low stock');

        const out = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ productUrl: 'https://shop.test/p', imageUrl: 'https://cdn/x.jpg', availability: 'out_of_stock', available: false, quantity: 0 }),
        ], 'en');
        expect(out[0].subtitle).toBe('Out of stock');
    });

    it('carries the reply language into the card strings', async () => {
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ productUrl: 'https://shop.test/p', imageUrl: 'https://cdn/x.jpg', price: '250 SAR' }),
        ], 'ar');
        expect(cards[0].subtitle).not.toContain('In stock');
        expect(cards[0].buttons?.[0].title).not.toBe('View product');
    });

    it('continues processing remaining results when one row lookup throws', async () => {
        mockGetProductByPlatformId
            .mockRejectedValueOnce(new Error('connection lost'))
            .mockResolvedValueOnce({ imageUrl: 'https://cdn.test/two.jpg' });

        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ platformProductId: 'p-1', productName: 'First', productUrl: 'https://shop.test/first' }),
            inventoryResult({ platformProductId: 'p-2', productName: 'Second', productUrl: 'https://shop.test/second' }),
        ], 'en');

        expect(cards).toHaveLength(1);
        expect(cards[0].title).toBe('Second');
        expect(mockRedisIncr).toHaveBeenCalledWith('metrics:product_card:tool:error');
    });
});
