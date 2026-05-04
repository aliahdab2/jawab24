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

    it('exports pricing for gpt-4.1', () => {
        expect(AI_PRICING['gpt-4.1']).toEqual({
            inputPer1K: 0.002,
            outputPer1K: 0.008,
        });
    });

    it('exports pricing for gpt-4o-mini-transcribe', () => {
        expect(AI_PRICING['gpt-4o-mini-transcribe']).toEqual({
            inputPer1K: 0.00125,
            outputPer1K: 0.005,
        });
    });

    it('exports pricing for text-embedding-3-small (output tokens are free)', () => {
        expect(AI_PRICING['text-embedding-3-small']).toEqual({
            inputPer1K: 0.00002,
            outputPer1K: 0,
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

        it('applies 50% discount on cached input tokens (gpt-4.1-mini)', () => {
            // 2000 in (1500 cached, 500 fresh) + 1000 out
            // Fresh: 500/1000 * 0.0004 = 0.0002
            // Cached: 1500/1000 * 0.0004 * 0.5 = 0.0003
            // Output: 1000/1000 * 0.0016 = 0.0016
            // Total: 0.0021
            const cost = estimateCostUsd('gpt-4.1-mini', 2000, 1000, 1500);
            expect(cost).toBeCloseTo(0.0002 + 0.0003 + 0.0016, 6);
        });

        it('cachedTokensIn=0 yields the same cost as the no-cache call', () => {
            const withZero = estimateCostUsd('gpt-4.1-mini', 2000, 1000, 0);
            const withoutArg = estimateCostUsd('gpt-4.1-mini', 2000, 1000);
            expect(withZero).toBe(withoutArg);
        });

        it('clamps cachedTokensIn above tokensIn (defensive)', () => {
            // If worker reports cached > total (shouldn't happen, but be safe),
            // treat all input as cached — never exceed total cost.
            const allCached = estimateCostUsd('gpt-4.1-mini', 1000, 0, 5000);
            const expected = (1000 / 1000) * 0.0004 * 0.5;
            expect(allCached).toBeCloseTo(expected, 6);
        });

        it('clamps negative cachedTokensIn to 0', () => {
            const cost = estimateCostUsd('gpt-4.1-mini', 1000, 0, -100);
            const expected = (1000 / 1000) * 0.0004;
            expect(cost).toBeCloseTo(expected, 6);
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
