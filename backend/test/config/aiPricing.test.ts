import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AI_PRICING, PRICING_VERSION, cacheSavingsUsd, estimateCostUsd, estimateWhisperCostUsd } from '../../src/config/aiPricing';

describe('AI Pricing', () => {
    it('exports PRICING_VERSION v3', () => {
        // v3 = the gpt-image family rows (post suggestions pilot, 2026-08-09).
        expect(PRICING_VERSION).toBe('v3');
    });

    it('exports pricing for gpt-4o-mini with 50% cached discount', () => {
        expect(AI_PRICING['gpt-4o-mini']).toEqual({
            inputPer1K: 0.00015,
            cachedInputPer1K: 0.000075,
            outputPer1K: 0.0006,
        });
    });

    it('exports pricing for gpt-4.1-mini with 75% cached discount', () => {
        expect(AI_PRICING['gpt-4.1-mini']).toEqual({
            inputPer1K: 0.0004,
            cachedInputPer1K: 0.0001,
            outputPer1K: 0.0016,
        });
    });

    it('dated alias gpt-4.1-mini-2025-04-14 mirrors gpt-4.1-mini pricing', () => {
        expect(AI_PRICING['gpt-4.1-mini-2025-04-14']).toEqual(AI_PRICING['gpt-4.1-mini']);
    });

    it('exports pricing for gpt-4.1-nano with 75% cached discount', () => {
        expect(AI_PRICING['gpt-4.1-nano']).toEqual({
            inputPer1K: 0.0001,
            cachedInputPer1K: 0.000025,
            outputPer1K: 0.0004,
        });
    });

    it('exports pricing for gpt-4.1 with 75% cached discount', () => {
        expect(AI_PRICING['gpt-4.1']).toEqual({
            inputPer1K: 0.002,
            cachedInputPer1K: 0.0005,
            outputPer1K: 0.008,
        });
    });

    it('exports pricing for gpt-4o-mini-transcribe (no caching)', () => {
        expect(AI_PRICING['gpt-4o-mini-transcribe']).toEqual({
            inputPer1K: 0.00125,
            outputPer1K: 0.005,
        });
    });

    it('exports pricing for text-embedding-3-small (output tokens are free, no caching)', () => {
        expect(AI_PRICING['text-embedding-3-small']).toEqual({
            inputPer1K: 0.00002,
            outputPer1K: 0,
        });
    });

    describe('estimateCostUsd', () => {
        it('calculates cost for gpt-4o-mini (no cache)', () => {
            // 1000 input × 0.00015/1K + 500 output × 0.0006/1K
            const cost = estimateCostUsd('gpt-4o-mini', 1000, 500);
            expect(cost).toBeCloseTo(0.00015 + 0.0003, 8);
        });

        it('calculates cost for gpt-4.1-mini (no cache)', () => {
            const cost = estimateCostUsd('gpt-4.1-mini', 2000, 1000);
            expect(cost).toBeCloseTo(0.0008 + 0.0016, 8);
        });

        it('returns 0 for zero tokens', () => {
            expect(estimateCostUsd('gpt-4o-mini', 0, 0)).toBe(0);
        });

        it('gpt-4.1-mini: cached tokens billed at 75% off (0.0001/1K), not 50% off', () => {
            // 2000 in (1500 cached, 500 fresh) + 1000 out
            // Fresh: 500/1000 * 0.0004    = 0.0002
            // Cached: 1500/1000 * 0.0001  = 0.00015
            // Output: 1000/1000 * 0.0016  = 0.0016
            // Total: 0.00195
            const cost = estimateCostUsd('gpt-4.1-mini', 2000, 1000, 1500);
            expect(cost).toBeCloseTo(0.0002 + 0.00015 + 0.0016, 8);
            // Regression guard: must NOT equal the old 50%-flat-rate calculation
            const oldFlat = 0.0002 + (1500 / 1000) * 0.0004 * 0.5 + 0.0016;
            expect(cost).not.toBeCloseTo(oldFlat, 8);
        });

        it('gpt-4o-mini: cached tokens billed at 50% off (0.000075/1K)', () => {
            // 2000 in (1500 cached, 500 fresh)
            // Fresh: 500/1000 * 0.00015     = 0.000075
            // Cached: 1500/1000 * 0.000075  = 0.0001125
            const cost = estimateCostUsd('gpt-4o-mini', 2000, 0, 1500);
            expect(cost).toBeCloseTo(0.000075 + 0.0001125, 8);
        });

        it('gpt-4.1-nano: cached tokens billed at 75% off', () => {
            // 4000 in (3000 cached) + 200 out
            // Fresh: 1000/1000 * 0.0001     = 0.0001
            // Cached: 3000/1000 * 0.000025  = 0.000075
            // Output: 200/1000 * 0.0004     = 0.00008
            const cost = estimateCostUsd('gpt-4.1-nano', 4000, 200, 3000);
            expect(cost).toBeCloseTo(0.0001 + 0.000075 + 0.00008, 10);
        });

        it('dated alias gpt-4.1-mini-2025-04-14 prices identically to gpt-4.1-mini', () => {
            const args: [string, number, number, number] = ['', 2000, 1000, 1500];
            const aliasCost = estimateCostUsd('gpt-4.1-mini-2025-04-14', args[1], args[2], args[3]);
            const baseCost = estimateCostUsd('gpt-4.1-mini', args[1], args[2], args[3]);
            expect(aliasCost).toBe(baseCost);
            // And it must NOT fall through to the unknown-model zero path.
            expect(aliasCost).toBeGreaterThan(0);
        });

        it('gpt-4.1: cached tokens billed at 75% off', () => {
            // 1000 in (1000 cached) + 500 out
            // Cached: 1000/1000 * 0.0005 = 0.0005
            // Output: 500/1000 * 0.008   = 0.004
            const cost = estimateCostUsd('gpt-4.1', 1000, 500, 1000);
            expect(cost).toBeCloseTo(0.0005 + 0.004, 8);
        });

        it('all-cached call (cached == tokensIn) only bills cached rate', () => {
            const cost = estimateCostUsd('gpt-4.1-mini', 1000, 0, 1000);
            expect(cost).toBeCloseTo((1000 / 1000) * 0.0001, 8);
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
            const expected = (1000 / 1000) * 0.0001;
            expect(allCached).toBeCloseTo(expected, 8);
        });

        it('clamps negative cachedTokensIn to 0', () => {
            const cost = estimateCostUsd('gpt-4.1-mini', 1000, 0, -100);
            const expected = (1000 / 1000) * 0.0004;
            expect(cost).toBeCloseTo(expected, 8);
        });

        it('model without cachedInputPer1K bills cached tokens at full input rate', () => {
            // text-embedding-3-small has no cached pricing entry.
            // 1000 in (500 cached, 500 fresh) — both should bill at 0.00002/1K.
            const cost = estimateCostUsd('text-embedding-3-small', 1000, 0, 500);
            expect(cost).toBeCloseTo((1000 / 1000) * 0.00002, 10);
        });

        describe('unknown model', () => {
            let warnSpy: ReturnType<typeof vi.spyOn>;

            beforeEach(() => {
                warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            });

            afterEach(() => {
                warnSpy.mockRestore();
            });

            it('returns 0 for an unknown model', () => {
                expect(estimateCostUsd('mystery-model-xyz', 1000, 500)).toBe(0);
            });

            it('warns once per unknown model name (no log spam)', () => {
                // Fresh name — the warn-once Set is module-scoped and persists
                // across tests; reusing a name from another test would skip the warn.
                const name = `mystery-model-${Math.random().toString(36).slice(2, 10)}`;
                estimateCostUsd(name, 1000, 500);
                estimateCostUsd(name, 2000, 100);
                estimateCostUsd(name, 50, 50);
                expect(warnSpy).toHaveBeenCalledTimes(1);
                expect(warnSpy.mock.calls[0][0]).toContain(name);
            });
        });
    });

    /**
     * Regression — the catalog posts-scan's vision calls booked at $0 for weeks:
     * we REQUEST the rolling alias 'gpt-4o-mini', OpenAI returns the dated
     * snapshot 'gpt-4o-mini-2024-07-18', and ai_usage_log records the response's
     * name. 42 calls / 1.24M input tokens were invisible to /admin/ai-cost by
     * 2026-07-27. The 4.1 family had already been patched one alias at a time;
     * this guards the CLASS instead.
     */
    describe('dated snapshot aliases', () => {
        it('prices the vision snapshot that the posts-scan actually logs', () => {
            expect(estimateCostUsd('gpt-4o-mini-2024-07-18', 30_000, 500))
                .toBeCloseTo(estimateCostUsd('gpt-4o-mini', 30_000, 500), 10);
        });

        it('never books a known family at zero just because the snapshot is new', () => {
            // An alias nobody has added yet must still cost SOMETHING.
            const cost = estimateCostUsd('gpt-4.1-mini-2099-01-01', 10_000, 1_000);
            expect(cost).toBeGreaterThan(0);
            expect(cost).toBeCloseTo(estimateCostUsd('gpt-4.1-mini', 10_000, 1_000), 10);
        });

        it('warns on the fallback — "same price" is an assumption, not a guarantee', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            estimateCostUsd('gpt-4.1-nano-2099-02-02', 1_000, 100);
            expect(warnSpy).toHaveBeenCalled();
            expect(warnSpy.mock.calls[0][0]).toContain('snapshot fallback');
            warnSpy.mockRestore();
        });

        it('still records 0 for a model of no known family', () => {
            expect(estimateCostUsd('llama-9000-2030-01-01', 1_000, 100)).toBe(0);
        });

        it('applies the base cached rate to a snapshot', () => {
            expect(cacheSavingsUsd('gpt-4o-mini-2024-07-18', 10_000))
                .toBeCloseTo(cacheSavingsUsd('gpt-4o-mini', 10_000), 10);
        });
    });

    describe('estimateWhisperCostUsd', () => {
        it('calculates cost for 60 seconds of audio', () => {
            expect(estimateWhisperCostUsd(60)).toBeCloseTo(0.006, 6);
        });

        it('calculates cost for 30 seconds of audio', () => {
            expect(estimateWhisperCostUsd(30)).toBeCloseTo(0.003, 6);
        });

        it('returns 0 for zero duration', () => {
            expect(estimateWhisperCostUsd(0)).toBe(0);
        });
    });
});
