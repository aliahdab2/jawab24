import { describe, it, expect } from 'vitest';
import { computeHumanDelayMs } from '../../../src/services/reply/humanDelay';

describe('computeHumanDelayMs', () => {
    it('returns 0 for 0 (Instant stays instant)', () => {
        expect(computeHumanDelayMs(0)).toBe(0);
    });

    it('returns 0 for negative input (defensive)', () => {
        expect(computeHumanDelayMs(-5)).toBe(0);
    });

    it('never replies faster than the configured time, capped at 1.5× (the floor)', () => {
        for (let i = 0; i < 10_000; i++) {
            const ms = computeHumanDelayMs(3);
            expect(ms).toBeGreaterThanOrEqual(3000); // never below the set value
            expect(ms).toBeLessThanOrEqual(4500); // rounding may land on 1.5×
        }
    });

    it('always returns an integer (milliseconds)', () => {
        for (let i = 0; i < 1_000; i++) {
            expect(Number.isInteger(computeHumanDelayMs(10))).toBe(true);
        }
    });

    it('actually varies — jitter is real, not a constant (regression for copy↔code drift)', () => {
        const samples = new Set<number>();
        for (let i = 0; i < 1_000; i++) {
            samples.add(computeHumanDelayMs(3));
        }
        // A flat constant would produce exactly one distinct value.
        expect(samples.size).toBeGreaterThan(100);
    });

    it('reaches near both bounds across a large sample', () => {
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < 50_000; i++) {
            const ms = computeHumanDelayMs(3);
            if (ms < min) min = ms;
            if (ms > max) max = ms;
        }
        // Floor 3000 (1×), upper approaches 4500 (1.5×) — confirm jitter spans the range.
        expect(min).toBeLessThan(3100);
        expect(max).toBeGreaterThan(4400);
    });
});
