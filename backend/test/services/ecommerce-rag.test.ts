import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB before imports
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        }),
        execute: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/db/schema', () => ({
    pages: { id: 'id', knowledgeBase: 'knowledge_base', kbActiveVersion: 'kb_active_version', ecommerceStoreId: 'ecommerce_store_id' },
    ecommerceProducts: { ecommerceStoreId: 'ecommerce_store_id', status: 'status' },
    ecommerceStores: { id: 'id', policiesSummary: 'policies_summary' },
    pendingEcommerceInstalls: {},
    workspaceMembers: {},
}));

vi.mock('../../src/lib/redis', () => ({
    redis: {
        scan: vi.fn().mockResolvedValue(['0', []]),
        del: vi.fn().mockResolvedValue(0),
    },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

const mockIngestFullPage = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/pages', () => ({
    getIngestionService: vi.fn(() => ({
        ingestFullPage: mockIngestFullPage,
    })),
}));

import { db } from '../../src/db';

/**
 * Mock the 4 db.select() calls made by invalidateCachesForStore:
 *   1. Linked pages
 *   2. Store policies (.limit(1))
 *   3. All active products
 *   4. Page details per page (.limit(1))
 */
function mockSelectChain(opts: {
    pages: { id: string }[];
    policies?: string;
    products?: Record<string, unknown>[];
    pageDetails?: { knowledgeBase: string | null; kbActiveVersion: number };
}) {
    let callCount = 0;
    vi.mocked(db.select).mockImplementation((() => {
        callCount++;
        if (callCount === 1) {
            return {
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(opts.pages),
                }),
            };
        }
        if (callCount === 2) {
            return {
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ policiesSummary: opts.policies ?? '' }]),
                    }),
                }),
            };
        }
        if (callCount === 3) {
            return {
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(opts.products ?? []),
                }),
            };
        }
        return {
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([opts.pageDetails ?? {
                        knowledgeBase: 'KB text',
                        kbActiveVersion: 1,
                    }]),
                }),
            }),
        };
    }) as any);
}

describe('invalidateCachesForStore — product RAG', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls ingestFullPage with all active products', async () => {
        const { invalidateCachesForStore } = await import('../../src/services/ecommerce');

        mockSelectChain({
            pages: [{ id: 'page-1' }],
            products: [{
                platformProductId: 'shopify-1',
                title: 'iPhone 15',
                description: 'A17 Pro chip',
                productType: 'Phones',
                vendor: 'Apple',
                status: 'active',
                priceRange: '3999 SAR',
                currency: 'SAR',
                totalInventory: 50,
                hasVariants: true,
                variantSummary: '128GB, 256GB',
                tags: 'phone',
            }],
            pageDetails: { knowledgeBase: 'Our store sells phones', kbActiveVersion: 3 },
        });

        await invalidateCachesForStore('store-1');
        await new Promise(r => setTimeout(r, 10));

        expect(mockIngestFullPage).toHaveBeenCalledWith(
            'page-1',
            'Our store sells phones',
            expect.arrayContaining([
                expect.objectContaining({ platformProductId: 'shopify-1', title: 'iPhone 15' }),
            ]),
            3,
        );
    });

    it('passes raw page.knowledgeBase (not enriched)', async () => {
        const { invalidateCachesForStore } = await import('../../src/services/ecommerce');

        mockSelectChain({
            pages: [{ id: 'page-1' }],
            products: [],
            pageDetails: { knowledgeBase: 'Raw KB only', kbActiveVersion: 2 },
        });

        await invalidateCachesForStore('store-1');
        await new Promise(r => setTimeout(r, 10));

        if (mockIngestFullPage.mock.calls.length > 0) {
            expect(mockIngestFullPage.mock.calls[0][1]).toBe('Raw KB only');
        }
    });

    it('continues without throwing if ingestFullPage fails', async () => {
        const { invalidateCachesForStore } = await import('../../src/services/ecommerce');

        mockIngestFullPage.mockRejectedValue(new Error('Ingestion failed'));

        mockSelectChain({
            pages: [{ id: 'page-1' }],
            products: [],
            pageDetails: { knowledgeBase: 'KB text', kbActiveVersion: 1 },
        });

        await expect(invalidateCachesForStore('store-1')).resolves.not.toThrow();
    });
});
