import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Sentry — pass-through so spans don't require an active trace
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

vi.mock('../../src/services/shopify', () => ({
    getEnrichedKnowledgeBase: vi.fn().mockResolvedValue('Enriched KB with products'),
}));

import { ShopifyIntegration } from '../../src/integrations/shopify';

describe('ShopifyIntegration', () => {
    let integration: ShopifyIntegration;

    beforeEach(() => {
        vi.clearAllMocks();
        integration = new ShopifyIntegration();
    });

    describe('enrichKnowledgeBase', () => {
        it('should instrument with shopify.kb.enrich span', async () => {
            const sentry = await import('@sentry/node');

            await integration.enrichKnowledgeBase('existing KB', { shopifyStoreId: 'store-123' });

            expect(vi.mocked(sentry.startSpan)).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'shopify.kb.enrich', op: 'db.query' }),
                expect.any(Function),
            );
        });

        it('should return null when no shopifyStoreId on page', async () => {
            const result = await integration.enrichKnowledgeBase('existing KB', {});
            expect(result).toBeNull();
        });

        it('should return null when shopifyStoreId is not a string', async () => {
            const result = await integration.enrichKnowledgeBase('existing KB', { shopifyStoreId: 123 });
            expect(result).toBeNull();
        });

        it('should pass currentKB and storeId to getEnrichedKnowledgeBase', async () => {
            const { getEnrichedKnowledgeBase } = await import('../../src/services/shopify');

            await integration.enrichKnowledgeBase('base KB', { shopifyStoreId: 'store-456' });

            expect(getEnrichedKnowledgeBase).toHaveBeenCalledWith('base KB', 'store-456');
        });

        it('should return the enriched content from getEnrichedKnowledgeBase', async () => {
            const result = await integration.enrichKnowledgeBase('base KB', { shopifyStoreId: 'store-789' });
            expect(result).toBe('Enriched KB with products');
        });
    });

    describe('isEnabled', () => {
        it('should return true when shopify API key is configured', () => {
            expect(integration.isEnabled()).toBe(true);
        });
    });
});
