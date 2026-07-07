import { describe, it, expect } from 'vitest';
import { SHOPIFY_API_VERSION } from '../../src/services/shopify';

/**
 * Sunset guard. Shopify supports each quarterly API version for ~12 months from release.
 * This test FAILS ~60 days before SHOPIFY_API_VERSION reaches end-of-support, forcing a
 * bump while there's still runway. CI is disabled (billing) so local `npm run test` is the
 * only alarm — hence a test, not a comment.
 *
 * When it fails: bump SHOPIFY_API_VERSION in backend/src/services/shopify.ts to a
 * currently-supported quarter and re-check the GraphQL queries for deprecated fields.
 */
describe('Shopify API version freshness', () => {
    it('is a valid quarterly YYYY-MM version', () => {
        expect(SHOPIFY_API_VERSION).toMatch(/^\d{4}-(01|04|07|10)$/);
    });

    it('is not within 60 days of end-of-support', () => {
        const [year, month] = SHOPIFY_API_VERSION.split('-').map(Number);
        // Supported ~12 months from the 1st of the release month.
        const endOfSupport = Date.UTC(year + 1, month - 1, 1);
        const alarmAt = endOfSupport - 60 * 24 * 60 * 60 * 1000;

        expect(
            Date.now() < alarmAt,
            `Shopify API version ${SHOPIFY_API_VERSION} is within 60 days of end-of-support ` +
            `(${new Date(endOfSupport).toISOString().slice(0, 10)}). Bump SHOPIFY_API_VERSION ` +
            `in backend/src/services/shopify.ts to a newer quarter and re-check the queries.`,
        ).toBe(true);
    });
});
