import { describe, it, expect } from 'vitest';
import { resolveAiQuotaStatus, AI_QUOTA_NEAR_WALL_RATIO } from '../aiQuota';

/**
 * The quota-runway policy every "are replies about to stop?" surface reads.
 *
 * Two invariants matter most:
 *  1. With no top-up balance the behaviour is IDENTICAL to the old plan-cap-only
 *     rule (80% → near, 100% → exhausted) — merchants without a top-up must not
 *     see any change.
 *  2. `nearWall` measures against plan + top-up, so a big balance calms the
 *     warning and a nearly-drained one keeps it loud.
 */

const q = (used: number, limit: number | null, topupBalance = 0) =>
    resolveAiQuotaStatus({ used, limit, topupBalance });

describe('resolveAiQuotaStatus — no top-up balance (legacy parity)', () => {
    it('79% of the cap → under_cap, not near the wall', () => {
        const s = q(790, 1000);
        expect(s.state).toBe('under_cap');
        expect(s.nearWall).toBe(false);
    });

    it('exactly 80% → near_cap and nearWall', () => {
        const s = q(800, 1000);
        expect(s.state).toBe('near_cap');
        expect(s.nearWall).toBe(true);
    });

    it('at the cap → exhausted (the cap IS the wall without a balance)', () => {
        const s = q(1000, 1000);
        expect(s.state).toBe('exhausted');
        expect(s.remaining).toBe(0);
        expect(s.nearWall).toBe(true);
    });

    it('past the cap → still exhausted, remaining never goes negative', () => {
        expect(q(1500, 1000)).toMatchObject({ state: 'exhausted', remaining: 0 });
    });
});

describe('resolveAiQuotaStatus — top-up balance extends the runway', () => {
    it('capacity is plan + top-up', () => {
        expect(q(8746, 10000, 9417).capacity).toBe(19417);
    });

    it('the live case: 87% of the cap with a large balance is NOT near the wall', () => {
        const s = q(8746, 10000, 9417);
        expect(s.state).toBe('near_cap_on_topup');
        expect(s.nearWall).toBe(false);
        expect(s.remaining).toBe(10671);
    });

    it('at the cap with balance behind it → on_topup, replies still flowing', () => {
        const s = q(10000, 10000, 9417);
        expect(s.state).toBe('on_topup');
        expect(s.nearWall).toBe(false);
        expect(s.remaining).toBe(9417);
    });

    it('at the cap with a nearly-drained balance → on_topup but nearWall', () => {
        // 1000 plan + 3 top-up = 1003 capacity; 1000 used is 99.7% of it.
        const s = q(1000, 1000, 3);
        expect(s.state).toBe('on_topup');
        expect(s.nearWall).toBe(true);
    });

    it('a thin balance does not rescue a near-cap merchant from the wall', () => {
        // 1000 plan + 50 top-up = 1050; 80% of that is 840, so 850 is past it.
        const s = q(850, 1000, 50);
        expect(s.state).toBe('near_cap_on_topup');
        expect(s.nearWall).toBe(true);
    });

    it('plan and top-up both spent → exhausted', () => {
        expect(q(1050, 1000, 50).state).toBe('exhausted');
    });
});

describe('resolveAiQuotaStatus — degenerate inputs', () => {
    it('null limit → unmetered, never near the wall', () => {
        expect(q(999_999, null, 0)).toEqual({
            state: 'unmetered', capacity: null, remaining: null, nearWall: false,
        });
    });

    it('a zero/negative cap carries no signal → unmetered', () => {
        expect(q(50, 0).state).toBe('unmetered');
        expect(q(50, -5).state).toBe('unmetered');
    });

    it('a negative balance is clamped to 0 (never invents runway)', () => {
        const s = q(1000, 1000, -500);
        expect(s.capacity).toBe(1000);
        expect(s.state).toBe('exhausted');
    });

    it('a non-finite balance is treated as none', () => {
        expect(q(1000, 1000, Number.NaN).state).toBe('exhausted');
    });

    it('zero usage on a fresh period → under_cap', () => {
        expect(q(0, 1000, 0).state).toBe('under_cap');
    });

    it('the ratio is the documented 80%', () => {
        expect(AI_QUOTA_NEAR_WALL_RATIO).toBe(0.8);
    });
});
