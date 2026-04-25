import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EcommerceToolResult, InventoryInfo } from '@jawab24/shared';

// Mock db before importing the module under test
const mockLimit = vi.fn();
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: mockLimit,
                })),
            })),
        })),
    },
}));

// Silence sentry helper imports — captureError must not throw in tests
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

import { buildProductCardsFromToolResults } from '../../src/services/reply/productCardBuilder';

const STORE_ID = 'store-1';

function inventoryResult(data: Partial<InventoryInfo>): EcommerceToolResult {
    return {
        tool_name: 'check_inventory',
        success: true,
        data: {
            productName: 'Blue Cotton Shirt',
            available: true,
            quantity: 12,
            ...data,
        } as unknown as Record<string, unknown>,
    };
}

describe('productCardBuilder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns [] when there are no tool results', async () => {
        const cards = await buildProductCardsFromToolResults(STORE_ID, []);
        expect(cards).toEqual([]);
        expect(mockLimit).not.toHaveBeenCalled();
    });

    it('skips failed tool results', async () => {
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            { tool_name: 'check_inventory', success: false, error: 'product_not_found' },
        ]);
        expect(cards).toEqual([]);
        expect(mockLimit).not.toHaveBeenCalled();
    });

    it('skips successful results with no data', async () => {
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            { tool_name: 'check_inventory', success: true },
        ]);
        expect(cards).toEqual([]);
    });

    it('skips tools we do not know how to render as cards', async () => {
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            { tool_name: 'lookup_order', success: true, data: { orderNumber: '#1001' } as Record<string, unknown> },
        ]);
        expect(cards).toEqual([]);
        expect(mockLimit).not.toHaveBeenCalled();
    });

    it('returns [] when no synced image is available (graceful degrade to text)', async () => {
        mockLimit.mockResolvedValueOnce([]);
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ productUrl: 'https://shop.test/p/blue-shirt' }),
        ]);
        expect(cards).toEqual([]);
    });

    it('returns [] when productUrl is missing (no link → no card)', async () => {
        mockLimit.mockResolvedValueOnce([{ imageUrl: 'https://cdn.test/img.jpg' }]);
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ productUrl: undefined }),
        ]);
        expect(cards).toEqual([]);
    });

    it('builds a card from check_inventory when image and URL exist', async () => {
        mockLimit.mockResolvedValueOnce([{ imageUrl: 'https://cdn.test/shirt.jpg' }]);
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({
                productUrl: 'https://shop.test/p/blue-shirt',
                price: '120',
                currency: 'SAR',
                available: true,
            }),
        ]);

        expect(cards).toHaveLength(1);
        expect(cards[0]).toEqual({
            title: 'Blue Cotton Shirt',
            subtitle: '120 SAR · In stock',
            imageUrl: 'https://cdn.test/shirt.jpg',
            productUrl: 'https://shop.test/p/blue-shirt',
            buttons: [{ type: 'web_url', title: 'View product', url: 'https://shop.test/p/blue-shirt' }],
        });
    });

    it('formats subtitle without currency when only price is present', async () => {
        mockLimit.mockResolvedValueOnce([{ imageUrl: 'https://cdn.test/shirt.jpg' }]);
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ productUrl: 'https://shop.test/p', price: '120', available: true }),
        ]);
        expect(cards[0].subtitle).toBe('120 · In stock');
    });

    it('formats subtitle as Out of stock when not available', async () => {
        mockLimit.mockResolvedValueOnce([{ imageUrl: 'https://cdn.test/shirt.jpg' }]);
        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ productUrl: 'https://shop.test/p', available: false }),
        ]);
        expect(cards[0].subtitle).toBe('Out of stock');
    });

    it('continues processing remaining results when one DB lookup throws', async () => {
        // First lookup explodes, second succeeds → builder keeps going
        mockLimit
            .mockRejectedValueOnce(new Error('connection lost'))
            .mockResolvedValueOnce([{ imageUrl: 'https://cdn.test/two.jpg' }]);

        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ productName: 'First', productUrl: 'https://shop.test/first' }),
            inventoryResult({ productName: 'Second', productUrl: 'https://shop.test/second' }),
        ]);

        expect(cards).toHaveLength(1);
        expect(cards[0].title).toBe('Second');
    });

    it('builds multiple cards when multiple inventory results carry product data', async () => {
        mockLimit
            .mockResolvedValueOnce([{ imageUrl: 'https://cdn.test/a.jpg' }])
            .mockResolvedValueOnce([{ imageUrl: 'https://cdn.test/b.jpg' }]);

        const cards = await buildProductCardsFromToolResults(STORE_ID, [
            inventoryResult({ productName: 'A', productUrl: 'https://shop.test/a' }),
            inventoryResult({ productName: 'B', productUrl: 'https://shop.test/b' }),
        ]);

        expect(cards).toHaveLength(2);
        expect(cards[0].title).toBe('A');
        expect(cards[1].title).toBe('B');
    });
});
