import { describe, it, expect } from 'vitest';
import { computeCrossedAiThresholds, AI_USAGE_THRESHOLDS } from '../../src/services/subscriptions';

describe('computeCrossedAiThresholds', () => {
    it('returns empty when limit is null (unlimited plan)', () => {
        expect(computeCrossedAiThresholds(0, 1000, null)).toEqual([]);
    });

    it('returns empty when limit is zero or negative (defensive)', () => {
        expect(computeCrossedAiThresholds(0, 10, 0)).toEqual([]);
        expect(computeCrossedAiThresholds(0, 10, -5)).toEqual([]);
    });

    it('returns empty when newUsed <= oldUsed (no increment)', () => {
        expect(computeCrossedAiThresholds(500, 500, 500)).toEqual([]);
        expect(computeCrossedAiThresholds(500, 400, 500)).toEqual([]);
    });

    it('returns [80] when crossing 80% exactly', () => {
        // limit 500 → 80% boundary = 400
        expect(computeCrossedAiThresholds(399, 400, 500)).toEqual([80]);
    });

    it('returns [80] when crossing 80% from below', () => {
        expect(computeCrossedAiThresholds(100, 420, 500)).toEqual([80]);
    });

    it('returns [] when already above 80% and still below 100%', () => {
        expect(computeCrossedAiThresholds(450, 480, 500)).toEqual([]);
    });

    it('returns [100] when crossing 100% only (previously above 80%)', () => {
        expect(computeCrossedAiThresholds(450, 500, 500)).toEqual([100]);
    });

    it('returns [80, 100] when a single increment crosses both', () => {
        // e.g. bulk increment from 0 to 500 on a 500-limit plan
        expect(computeCrossedAiThresholds(0, 500, 500)).toEqual([80, 100]);
    });

    it('returns [100] when jumping well past the limit in one go', () => {
        expect(computeCrossedAiThresholds(499, 600, 500)).toEqual([100]);
    });

    it('returns [] when already past 100%', () => {
        expect(computeCrossedAiThresholds(510, 520, 500)).toEqual([]);
    });

    it('handles small limits correctly', () => {
        // limit 10 → 80% boundary = 8, 100% = 10
        expect(computeCrossedAiThresholds(7, 8, 10)).toEqual([80]);
        expect(computeCrossedAiThresholds(9, 10, 10)).toEqual([100]);
        expect(computeCrossedAiThresholds(0, 10, 10)).toEqual([80, 100]);
    });

    it('handles fractional 80% boundary (non-round limits)', () => {
        // limit 125 → 80% = 100
        expect(computeCrossedAiThresholds(99, 100, 125)).toEqual([80]);
        expect(computeCrossedAiThresholds(100, 101, 125)).toEqual([]);
    });

    it('exposes the threshold constants in ascending order', () => {
        expect([...AI_USAGE_THRESHOLDS]).toEqual([80, 100]);
    });
});
