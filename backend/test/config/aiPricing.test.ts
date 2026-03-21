import { describe, it, expect } from 'vitest';
import { AI_PRICING, estimateCostUsd, estimateWhisperCostUsd } from '../../src/config/aiPricing';

describe('AI Pricing', () => {
    it('exports pricing for gpt-4o-mini', () => {
        expect(AI_PRICING['gpt-4o-mini']).toEqual({
            inputPer1K: 0.00015,
            outputPer1K: 0.0006,
        });
    });

    it('exports pricing for gpt-4.1-mini', () => {
        expect(AI_PRICING['gpt-4.1-mini']).toEqual({
            inputPer1K: 0.0004,
            outputPer1K: 0.0016,
        });
    });

    describe('estimateCostUsd', () => {
        it('calculates cost for gpt-4o-mini', () => {
            // 1000 input + 500 output
            const cost = estimateCostUsd('gpt-4o-mini', 1000, 500);
            expect(cost).toBeCloseTo(0.00015 + 0.0003, 6);
        });

        it('calculates cost for gpt-4.1-mini', () => {
            const cost = estimateCostUsd('gpt-4.1-mini', 2000, 1000);
            expect(cost).toBeCloseTo(0.0008 + 0.0016, 6);
        });

        it('returns 0 for unknown model', () => {
            expect(estimateCostUsd('unknown-model', 1000, 500)).toBe(0);
        });

        it('returns 0 for zero tokens', () => {
            expect(estimateCostUsd('gpt-4o-mini', 0, 0)).toBe(0);
        });
    });

    describe('estimateWhisperCostUsd', () => {
        it('calculates cost for 60 seconds of audio', () => {
            // 1 minute × $0.006/min = $0.006
            expect(estimateWhisperCostUsd(60)).toBeCloseTo(0.006, 6);
        });

        it('calculates cost for 30 seconds of audio', () => {
            // 0.5 minutes × $0.006/min = $0.003
            expect(estimateWhisperCostUsd(30)).toBeCloseTo(0.003, 6);
        });

        it('returns 0 for zero duration', () => {
            expect(estimateWhisperCostUsd(0)).toBe(0);
        });
    });
});
