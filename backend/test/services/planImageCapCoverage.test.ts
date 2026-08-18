import { describe, it, expect } from 'vitest';

import { PLANS } from '../../src/config/plans';
import { IMAGE_DAILY_LIMITS } from '../../src/services/imageUnderstanding';

/**
 * Adding a plan slug is not a one-file change: `checkImageUnderstandingGate`
 * resolves the daily image cap with `IMAGE_DAILY_LIMITS[slug] ?? DEFAULT`, so a
 * new plan with no entry ships a cap nobody picked — and it fails invisibly
 * (images just stop being read; the customer is told nothing by design).
 *
 * This pins the coverage rather than the numbers, so retuning a cap is free
 * while forgetting one is not.
 */
describe('per-plan image cap coverage', () => {
    it('every seeded plan slug has an explicit daily image cap', () => {
        const missing = PLANS.map((p) => p.slug).filter((slug) => !(slug in IMAGE_DAILY_LIMITS));
        expect(missing).toEqual([]);
    });

    it('caps are positive integers', () => {
        for (const slug of PLANS.map((p) => p.slug)) {
            const limit = IMAGE_DAILY_LIMITS[slug];
            expect(Number.isInteger(limit), `${slug} cap must be an integer`).toBe(true);
            expect(limit, `${slug} cap must be positive`).toBeGreaterThan(0);
        }
    });
});
