/**
 * Regression tests: AI enrichment reads ecommerceStoreId (not shopifyStoreId)
 *
 * Verifies that the ShopifyIntegration.enrichKnowledgeBase() reads
 * page.ecommerceStoreId (the renamed field) and not the old shopifyStoreId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/node', () => ({
    startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
    captureException: vi.fn(),
    addBreadcrumb: vi.fn(),
}));

vi.mock('../../src/config', () => ({
    config: {
        shopify: { apiKey: 'test-key' },
    },
}));

const mockGetEnrichedKnowledgeBase = vi.fn();
vi.mock('../../src/services/shopify', () => ({
    getEnrichedKnowledgeBase: (...args: unknown[]) => mockGetEnrichedKnowledgeBase(...args),
}));

import { ShopifyIntegration } from '../../src/integrations/shopify';

describe('ShopifyIntegration.enrichKnowledgeBase — ecommerceStoreId', () => {
    let integration: ShopifyIntegration;

    beforeEach(() => {
        vi.clearAllMocks();
        integration = new ShopifyIntegration();
        mockGetEnrichedKnowledgeBase.mockResolvedValue('Enriched KB');
    });

    it('reads ecommerceStoreId (not shopifyStoreId) from page context', async () => {
        const page = { ecommerceStoreId: 'store-abc' };

        const result = await integration.enrichKnowledgeBase('base KB', page);

        expect(mockGetEnrichedKnowledgeBase).toHaveBeenCalledWith('base KB', 'store-abc');
        expect(result).toBe('Enriched KB');
    });

    it('returns null when ecommerceStoreId is absent', async () => {
        // Page without any ecommerce store linked — must not call getEnrichedKnowledgeBase
        const result = await integration.enrichKnowledgeBase('base KB', {});
        expect(mockGetEnrichedKnowledgeBase).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('returns null when ecommerceStoreId is not a string (type guard)', async () => {
        const result = await integration.enrichKnowledgeBase('base KB', { ecommerceStoreId: 42 });
        expect(mockGetEnrichedKnowledgeBase).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('ignores legacy shopifyStoreId — does not enrich if only shopifyStoreId present', async () => {
        // Old field name must NOT trigger enrichment
        const result = await integration.enrichKnowledgeBase('base KB', { shopifyStoreId: 'store-xyz' });
        expect(mockGetEnrichedKnowledgeBase).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('passes currentKB through to getEnrichedKnowledgeBase', async () => {
        const page = { ecommerceStoreId: 'store-123' };
        await integration.enrichKnowledgeBase('detailed page info', page);
        expect(mockGetEnrichedKnowledgeBase).toHaveBeenCalledWith('detailed page info', 'store-123');
    });
});
