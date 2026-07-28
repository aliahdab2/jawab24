import { describe, it, expect } from 'vitest';
import { resolveAiQuotaStatus } from '@jawab24/shared';
import { computeCrossedAiThresholds, resolveAiUsageNotificationType, AI_USAGE_THRESHOLDS } from '../../src/services/subscriptions';

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

/**
 * The notification copy is chosen from the shared plan+top-up runway policy, not
 * from `topupBalance > 0`. The distinction that matters: a merchant crossing 100%
 * with a real runway behind the cap gets the calm notice, one whose balance is
 * nearly gone gets warned — the case a bare `> 0` check got wrong by promising
 * "no interruption" to someone with three replies left.
 *
 * `used: limit` mirrors the real call site: this only runs on the increment that
 * crosses the boundary, and incrementAiReplies never pushes the plan counter past
 * the cap (overflow is charged to the balance).
 */
const atThreshold = (threshold: 80 | 100, limit: number, topupBalance: number) =>
    resolveAiUsageNotificationType(
        threshold,
        resolveAiQuotaStatus({ used: threshold === 100 ? limit : 0.8 * limit, limit, topupBalance }),
    );

describe('resolveAiUsageNotificationType', () => {
    it('sends the reassuring top-up notice at 100% when the balance is a real runway', () => {
        // Replies keep flowing from top-up — the "limit reached / upgrade" copy would be false.
        expect(atThreshold(100, 10000, 10000)).toBe('ai_usage_on_topup');
        expect(atThreshold(100, 1000, 500)).toBe('ai_usage_on_topup');
    });

    it('warns instead of reassuring at 100% when the balance is nearly drained', () => {
        // 1,000-cap plan with 3 top-up replies banked: "no interruption" is a lie.
        expect(atThreshold(100, 1000, 3)).toBe('ai_usage_topup_low');
        expect(atThreshold(100, 1000, 1)).toBe('ai_usage_topup_low');
    });

    it('sends the limit-reached notice at 100% when there is no top-up balance', () => {
        expect(atThreshold(100, 1000, 0)).toBe('ai_usage_limit_reached');
    });

    it('treats a negative (refunded) top-up balance as no balance at 100%', () => {
        // topup_balance may go negative after a partial-pack refund (anti-abuse design).
        expect(atThreshold(100, 1000, -50)).toBe('ai_usage_limit_reached');
    });

    it('always sends the 80% warning regardless of top-up balance', () => {
        expect(atThreshold(80, 1000, 0)).toBe('ai_usage_warning_80');
        expect(atThreshold(80, 1000, 10000)).toBe('ai_usage_warning_80');
    });
});
