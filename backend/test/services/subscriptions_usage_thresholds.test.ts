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

    it('returns [90] when crossing 90% exactly', () => {
        // limit 500 → 90% boundary = 450
        expect(computeCrossedAiThresholds(449, 450, 500)).toEqual([90]);
    });

    it('returns [80, 90] when a single increment crosses both 80% and 90%', () => {
        expect(computeCrossedAiThresholds(350, 460, 500)).toEqual([80, 90]);
    });

    it('returns [] when already above 90% and still below 100%', () => {
        expect(computeCrossedAiThresholds(460, 480, 500)).toEqual([]);
    });

    it('returns [100] when crossing 100% only (previously above 90%)', () => {
        expect(computeCrossedAiThresholds(460, 500, 500)).toEqual([100]);
    });

    it('returns [80, 90, 100] when a single increment crosses all three', () => {
        // e.g. bulk increment from 0 to 500 on a 500-limit plan
        expect(computeCrossedAiThresholds(0, 500, 500)).toEqual([80, 90, 100]);
    });

    it('returns [90, 100] when a single increment crosses 90 and 100', () => {
        expect(computeCrossedAiThresholds(420, 500, 500)).toEqual([90, 100]);
    });

    it('returns [100] when jumping well past the limit in one go', () => {
        expect(computeCrossedAiThresholds(499, 600, 500)).toEqual([100]);
    });

    it('returns [] when already past 100%', () => {
        expect(computeCrossedAiThresholds(510, 520, 500)).toEqual([]);
    });

    it('handles small limits correctly', () => {
        // limit 10 → 80% = 8, 90% = 9, 100% = 10
        expect(computeCrossedAiThresholds(7, 8, 10)).toEqual([80]);
        expect(computeCrossedAiThresholds(8, 9, 10)).toEqual([90]);
        expect(computeCrossedAiThresholds(9, 10, 10)).toEqual([100]);
        expect(computeCrossedAiThresholds(0, 10, 10)).toEqual([80, 90, 100]);
    });

    it('handles fractional boundaries (non-round limits)', () => {
        // limit 125 → 80% = 100, 90% = 112.5
        expect(computeCrossedAiThresholds(99, 100, 125)).toEqual([80]);
        expect(computeCrossedAiThresholds(100, 101, 125)).toEqual([]);
        expect(computeCrossedAiThresholds(112, 113, 125)).toEqual([90]);
    });

    it('handles real plan limits (Business: 3000)', () => {
        // limit 3000 → 80% = 2400, 90% = 2700, 100% = 3000
        expect(computeCrossedAiThresholds(2399, 2400, 3000)).toEqual([80]);
        expect(computeCrossedAiThresholds(2699, 2700, 3000)).toEqual([90]);
        expect(computeCrossedAiThresholds(2999, 3000, 3000)).toEqual([100]);
    });

    it('exposes the threshold constants in ascending order', () => {
        expect([...AI_USAGE_THRESHOLDS]).toEqual([80, 90, 100]);
    });
});
