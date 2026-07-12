import { describe, it, expect } from 'vitest';
import { computeEffectiveAiCap } from '../../src/services/subscriptions';

describe('computeEffectiveAiCap', () => {
    it('returns null when the plan cap is null (unlimited plan)', () => {
        expect(computeEffectiveAiCap(null, 0)).toBeNull();
        expect(computeEffectiveAiCap(null, 1000)).toBeNull();
        expect(computeEffectiveAiCap(null, undefined)).toBeNull();
    });

    it('returns the plan cap when there is no bonus', () => {
        expect(computeEffectiveAiCap(10000, 0)).toBe(10000);
        expect(computeEffectiveAiCap(10000, null)).toBe(10000);
        expect(computeEffectiveAiCap(10000, undefined)).toBe(10000);
    });

    it('adds the bonus to the plan cap', () => {
        expect(computeEffectiveAiCap(10000, 1000)).toBe(11000);
        expect(computeEffectiveAiCap(200, 50)).toBe(250);
    });

    it('clamps a negative bonus to zero (defensive — caller shouldn\'t send negatives)', () => {
        expect(computeEffectiveAiCap(10000, -500)).toBe(10000);
    });

    it('is the single source of truth for top-up future work', () => {
        // When a persistent top-up balance is added (P3), it plugs in here
        // alongside the per-period bonus. This contract test pins the shape so
        // every consumer of the cap (canUseAiReplies, getUsageSummary, threshold
        // notifications) stays consistent. Update this test when top-up lands.
        const planCap = 10000;
        const periodBonus = 250;
        expect(computeEffectiveAiCap(planCap, periodBonus)).toBe(10250);
    });
});
