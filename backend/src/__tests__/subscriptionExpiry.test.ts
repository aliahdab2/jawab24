/**
 * Tests for manual-subscription expiry in the entitlement gate.
 *
 * Rule under test: a MANUAL (cash/transfer) subscription stops serving once its
 * quota window closes. Stripe drives its own expiry — a failed renewal arrives as
 * a webhook that flips the status to past_due/canceled — but a manual subscription
 * has no such signal, so nothing ever moves it off 'active'.
 *
 * Left unenforced, an expired manual plan stays entitled forever AND silently
 * refills: getCurrentUsage only matches a usage row while
 * `periodStart <= now <= periodEnd`, so once the row falls out of that window the
 * quota reads as 0 again and the merchant gets a fresh monthly allowance they
 * never paid for. Admin re-grants the window via manualUpgrade once cash lands.
 *
 * The boundary is startOfUtcDay(currentPeriodEnd), NOT the raw instant:
 * initializeUsagePeriod snaps the usage window's end to UTC midnight, so the
 * window closes up to ~24h before the exact subscription-end instant. The gate
 * compares against the same snapped boundary so entitlement and quota-counting
 * stay on one clock — the midnight→instant sliver is exactly where the free
 * refill used to leak.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Subscription, Plan } from '@jawab24/shared';

vi.mock('../db', () => ({ db: {} }));

import { subscriptionsService, resolveEntitlementEnd } from '../services/subscriptions';

const DAY_MS = 24 * 60 * 60 * 1000;

// Fixed "now" inside the sliver: 09:00 UTC on the day a same-day grant expires.
const NOW = new Date('2026-07-17T09:00:00.000Z');

const plan = { maxAiRepliesPerMonth: 1500 } as Plan;

function sub(overrides: Partial<Subscription>): Subscription & { plan: Plan } {
    return {
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-starter',
        status: 'active',
        currentPeriodStart: new Date(NOW.getTime() - 30 * DAY_MS),
        currentPeriodEnd: new Date(NOW.getTime() + 10 * DAY_MS),
        createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
        plan,
        ...overrides,
    } as Subscription & { plan: Plan };
}

beforeEach(() => vi.useFakeTimers({ now: NOW }));
afterEach(() => vi.useRealTimers());

describe('checkSubscriptionStatus — manual subscription expiry', () => {
    it('blocks a manual grant once its midnight-snapped quota window has closed', () => {
        // The exact Zolfakar case: instant (18:52 today) is still in the future,
        // but the quota window (snapped to 00:00 today) has already closed.
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({ paymentMethod: 'manual', currentPeriodEnd: new Date('2026-07-17T18:52:00.000Z') }),
        );

        expect(result.allowed).toBe(false);
        expect(result.code).toBe('subscription_inactive');
    });

    it('serves a manual grant while its quota window is still open', () => {
        // Window closes at midnight tomorrow → still open at 09:00 today.
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({ paymentMethod: 'manual', currentPeriodEnd: new Date('2026-07-18T18:52:00.000Z') }),
        );

        expect(result.allowed).toBe(true);
    });

    it('serves a manual grant again after admin extends the period (cash received)', () => {
        // manualUpgrade writes currentPeriodEnd = now + N months.
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({ paymentMethod: 'manual', currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY_MS) }),
        );

        expect(result.allowed).toBe(true);
    });

    it('does NOT expire a stripe subscription on date — even fully past its period', () => {
        // Stripe flips the status itself; a renewal webhook can land minutes after
        // the period end, so date-blocking here would cut off a paying customer.
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({ paymentMethod: 'stripe', currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z') }),
        );

        expect(result.allowed).toBe(true);
    });

    it('still blocks a canceled manual subscription regardless of period', () => {
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({
                paymentMethod: 'manual',
                status: 'canceled',
                currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY_MS),
            }),
        );

        expect(result.allowed).toBe(false);
        expect(result.code).toBe('subscription_inactive');
    });

    it('tolerates a manual subscription with no period end (never expires on date)', () => {
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({ paymentMethod: 'manual', currentPeriodEnd: null }),
        );

        expect(result.allowed).toBe(true);
    });
});

describe('checkSubscriptionStatus — expired trials do not inherit the past_due grace', () => {
    // The 2026-08-04 leak: an expired trial is lazily flipped trialing → past_due
    // by getUserSubscription, and the past_due branch granted currentPeriodEnd +
    // 3 days of grace. The grace exists to cover a payment processor's retry
    // cycle; a trial has no payment to retry. One merchant sent 760 free AI
    // replies through that window.
    it('blocks a lazily-flipped expired trial even inside the old grace window', () => {
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({
                status: 'past_due',
                paymentMethod: null,
                trialEndsAt: new Date(NOW.getTime() - 2 * DAY_MS),
                // Period end yesterday → old behavior allowed until +3 days grace.
                currentPeriodEnd: new Date(NOW.getTime() - 1 * DAY_MS),
            }),
        );

        expect(result.allowed).toBe(false);
        expect(result.code).toBe('subscription_inactive');
    });

    it('blocks an expired trial still in trialing status (flip not yet run)', () => {
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({
                status: 'trialing',
                paymentMethod: null,
                trialEndsAt: new Date(NOW.getTime() - 1 * DAY_MS),
            }),
        );

        expect(result.allowed).toBe(false);
        expect(result.code).toBe('subscription_inactive');
    });

    it('serves a trial that is still running', () => {
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({
                status: 'trialing',
                paymentMethod: null,
                trialEndsAt: new Date(NOW.getTime() + 5 * DAY_MS),
            }),
        );

        expect(result.allowed).toBe(true);
    });

    it('keeps the 3-day grace for a stripe past_due (card retry in flight)', () => {
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({
                status: 'past_due',
                paymentMethod: 'stripe',
                currentPeriodEnd: new Date(NOW.getTime() - 1 * DAY_MS),
            }),
        );

        expect(result.allowed).toBe(true);
    });

    it('keeps the grace for a CONVERTED trial that later failed payment (trialEndsAt set, stripe)', () => {
        // subscriptionLinking preserves trial_ends_at from Stripe; a paying
        // customer whose renewal bounced must get the retry grace, not the
        // trial hard-stop.
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({
                status: 'past_due',
                paymentMethod: 'stripe',
                trialEndsAt: new Date(NOW.getTime() - 20 * DAY_MS),
                currentPeriodEnd: new Date(NOW.getTime() - 1 * DAY_MS),
            }),
        );

        expect(result.allowed).toBe(true);
    });
});

describe('canUseAiReplies — manual sliver does not hand out a free refill', () => {
    afterEach(() => vi.restoreAllMocks());

    it('blocks the reply path in the sliver instead of reporting 0/1500 used', async () => {
        vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(
            sub({ paymentMethod: 'manual', currentPeriodEnd: new Date('2026-07-17T18:52:00.000Z') }),
        );
        // Window closed → no usage row covers `now`, which is what previously read
        // as a fresh allowance.
        vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(null as never);
        vi.spyOn(subscriptionsService, 'getTopupBalance').mockResolvedValue(0);

        const result = await subscriptionsService.canUseAiReplies('user-1');

        expect(result.allowed).toBe(false);
        expect(result.code).toBe('subscription_inactive');
        // Must NOT look like quota exhaustion with a fresh 1500 available.
        expect(result.remaining).toBeUndefined();
    });

    it('still honors a purchased top-up balance after the manual window closes', async () => {
        vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(
            sub({ paymentMethod: 'manual', currentPeriodEnd: new Date('2026-07-17T18:52:00.000Z') }),
        );
        vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(null as never);
        vi.spyOn(subscriptionsService, 'getTopupBalance').mockResolvedValue(500);

        const result = await subscriptionsService.canUseAiReplies('user-1');

        expect(result.allowed).toBe(true);
        expect(result.usingTopup).toBe(true);
    });

    it('blocks the AUTO-REPLY path regardless of top-up balance', () => {
        // canAutoReply (what enforceAutoReplyGate calls) consults status only —
        // it never reaches the top-up fallback above. Pinned because the dashboard
        // banner suppresses its top-up CTA on the strength of this: offering credits
        // that cannot unblock a reply would be taking money for nothing.
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({ paymentMethod: 'manual', currentPeriodEnd: new Date('2026-07-17T18:52:00.000Z') }),
        );
        expect(result.allowed).toBe(false);
    });
});

/**
 * The DISPLAY side of the same boundary.
 *
 * Enforcement was always correct here; what shipped broken was that no surface
 * could say so. Every UI printed the raw `currentPeriodEnd`, which for a manual
 * plan is up to ~24h AFTER entitlement actually lapses — so a merchant blocked
 * since 00:00 was reading "14 August" and concluding they still had the day.
 * `resolveEntitlementEnd` is the one boundary both sides now read.
 */
describe('resolveEntitlementEnd — one boundary for enforcement and display', () => {
    it('snaps a manual plan back to UTC midnight of the period-end day', () => {
        expect(
            resolveEntitlementEnd({
                paymentMethod: 'manual',
                currentPeriodEnd: new Date('2026-08-14T16:26:00.000Z'),
            })?.toISOString(),
        ).toBe('2026-08-14T00:00:00.000Z');
    });

    it('leaves every other rail on its exact instant', () => {
        for (const paymentMethod of ['stripe', 'shopify', null]) {
            expect(
                resolveEntitlementEnd({
                    paymentMethod,
                    currentPeriodEnd: new Date('2026-08-14T16:26:00.000Z'),
                })?.toISOString(),
            ).toBe('2026-08-14T16:26:00.000Z');
        }
    });

    it('returns null when nothing bounds the subscription in time', () => {
        expect(resolveEntitlementEnd({ paymentMethod: 'manual', currentPeriodEnd: null })).toBeNull();
    });

    it('agrees with the gate at every hour around the boundary', () => {
        // The invariant that makes the bug unrepeatable: whatever the gate decides,
        // the date shown to the merchant must be able to explain it. Walking the
        // whole sliver catches a one-sided change to either function.
        const currentPeriodEnd = new Date('2026-08-14T16:26:00.000Z');
        const entitlementEnd = resolveEntitlementEnd({ paymentMethod: 'manual', currentPeriodEnd });
        if (!entitlementEnd) throw new Error('expected a bounded entitlement end');

        for (let hour = 0; hour < 48; hour++) {
            const now = new Date(Date.UTC(2026, 7, 13, hour));
            vi.setSystemTime(now);
            const allowed = subscriptionsService.checkSubscriptionStatus(
                sub({ paymentMethod: 'manual', currentPeriodEnd }),
            ).allowed;
            expect(allowed).toBe(entitlementEnd >= now);
        }
    });
});
