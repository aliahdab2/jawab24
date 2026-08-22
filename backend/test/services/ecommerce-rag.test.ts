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

// `redisScanDelete` MUST be part of this mock. Without it the symbol is undefined at
// runtime, so a re-introduced flush would throw inside its own try/catch and the
// "never flushes" assertion below would pass vacuously — verified by mutation.
vi.mock('../../src/lib/redis', () => ({
    redis: {
        scan: vi.fn().mockResolvedValue(['0', []]),
        del: vi.fn().mockResolvedValue(0),
    },
    redisScanDelete: vi.fn().mockResolvedValue(0),
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
 * Mock the 5 db.select() calls made by invalidateCachesForStore:
 *   1. Linked pages
 *   2. Per-page kbActiveVersion (one per page)
 *   3. Store policies (.limit(1))
 *   4. All active products
 *   5. Per-page knowledgeBase (.limit(1))
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
            // 1. Linked pages
            return {
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(opts.pages),
                }),
            };
        }
        if (callCount === 2) {
            // 2. Per-page kbActiveVersion
            return {
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{
                            kbActiveVersion: opts.pageDetails?.kbActiveVersion ?? 1,
                        }]),
                    }),
                }),
            };
        }
        if (callCount === 3) {
            // 3. Store policies
            return {
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ policiesSummary: opts.policies ?? '' }]),
                    }),
                }),
            };
        }
        if (callCount === 4) {
            // 4. All active products
            return {
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(opts.products ?? []),
                }),
            };
        }
        // 5. Per-page knowledgeBase
        return {
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{
                        knowledgeBase: opts.pageDetails?.knowledgeBase ?? 'KB text',
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

        expect(mockIngestFullPage).toHaveBeenCalledWith(
            'page-1',
            'Our store sells phones',
            expect.arrayContaining([
                expect.objectContaining({ platformProductId: 'shopify-1', title: 'iPhone 15' }),
            ]),
            4, // nextVersion = current (3) + 1
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

        if (mockIngestFullPage.mock.calls.length > 0) {
            expect(mockIngestFullPage.mock.calls[0][1]).toBe('Raw KB only');
        }
    });

    it('never flushes the global exact reply cache (kbActiveVersion rotation retires linked pages\' keys)', async () => {
        const { invalidateCachesForStore } = await import('../../src/services/ecommerce');
        const { redis, redisScanDelete } = await import('../../src/lib/redis');

        mockSelectChain({
            pages: [{ id: 'page-1' }],
            products: [],
            pageDetails: { knowledgeBase: 'KB text', kbActiveVersion: 1 },
        });

        await invalidateCachesForStore('store-1');

        // A scan-delete here is the fleet-wide `cache:ai_reply:*` wipe — every workspace's
        // warm replies, on every product webhook and every 6-hourly sync. Per-page
        // invalidation is the version bump; the ingestion call below is the only thing
        // that must happen.
        expect(redisScanDelete).not.toHaveBeenCalled();
        expect(redis.scan).not.toHaveBeenCalled();
        expect(redis.del).not.toHaveBeenCalled();
        expect(mockIngestFullPage).toHaveBeenCalledTimes(1);
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
