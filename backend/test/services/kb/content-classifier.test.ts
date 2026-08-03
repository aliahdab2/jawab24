import { describe, it, expect } from 'vitest';
import { detectCatalogLikePatterns } from '../../../src/services/kb/content-classifier';

/**
 * The classifier's behavioral suite lives with the canonical module:
 * `packages/shared/src/__tests__/kbContentClassifier.test.ts`. This file only
 * pins the backend re-export surface — `controllers/pages.ts` imports through
 * `services/kb/content-classifier`, and this test fails if that path stops
 * resolving to the shared detector.
 */
describe('content-classifier re-export', () => {
    it('exposes the shared detector through the legacy backend path', () => {
        const result = detectCatalogLikePatterns(`Our shipping zones:
- Zone A: 25 SAR
- Zone B: 50 SAR
- Zone C: 75 SAR
For larger orders please ask.`);
        expect(result.hasCatalog).toBe(true);
        expect(result.reasons).toContain('price_list');
        expect(result.priceCount).toBe(3);
    });
});
