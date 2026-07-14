/**
 * Tests for subscription expiry in the entitlement gate.
 *
 * Rule under test: a MANUAL (cash/transfer) subscription stops serving once its
 * `currentPeriodEnd` passes. Stripe drives its own expiry — a failed renewal
 * arrives as a webhook that flips the status to past_due/canceled — but a manual
 * subscription has no such signal, so nothing ever moves it off 'active'.
 *
 * Left unenforced, an expired manual plan stays entitled forever AND silently
 * refills: `getCurrentUsage` only matches a usage row while
 * `periodStart <= now <= periodEnd`, so once the row falls out of that window the
 * quota reads as 0 again and the merchant gets a fresh monthly allowance they
 * never paid for. Admin re-grants the period via manualUpgrade once cash lands.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Subscription, Plan } from '@jawab24/shared';

// checkSubscriptionStatus is pure, but importing the service pulls in ../db.
vi.mock('../db', () => ({ db: {} }));

import { subscriptionsService } from '../services/subscriptions';

const DAY_MS = 24 * 60 * 60 * 1000;

const plan = { maxAiRepliesPerMonth: 1500 } as Plan;

function sub(overrides: Partial<Subscription>): Subscription & { plan: Plan } {
    return {
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-starter',
        status: 'active',
        currentPeriodStart: new Date(Date.now() - 30 * DAY_MS),
        currentPeriodEnd: new Date(Date.now() + 3 * DAY_MS),
        createdAt: new Date(),
        plan,
        ...overrides,
    } as Subscription & { plan: Plan };
}

describe('checkSubscriptionStatus — manual subscription expiry', () => {
    it('blocks an active manual subscription once its period has ended', () => {
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({ paymentMethod: 'manual', currentPeriodEnd: new Date(Date.now() - 1000) }),
        );

        expect(result.allowed).toBe(false);
        expect(result.code).toBe('subscription_inactive');
    });

    it('serves a manual subscription while it is still inside its paid period', () => {
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({ paymentMethod: 'manual', currentPeriodEnd: new Date(Date.now() + DAY_MS) }),
        );

        expect(result.allowed).toBe(true);
    });

    it('serves a manual subscription again after admin extends the period (cash received)', () => {
        // manualUpgrade writes currentPeriodEnd = now + N months.
        const renewed = subscriptionsService.checkSubscriptionStatus(
            sub({ paymentMethod: 'manual', currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS) }),
        );

        expect(renewed.allowed).toBe(true);
    });

    it('does NOT date-expire a stripe subscription — Stripe flips the status itself', () => {
        // A renewal webhook can legitimately land minutes after the period end.
        // Blocking on the date here would cut off a paying customer.
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({ paymentMethod: 'stripe', currentPeriodEnd: new Date(Date.now() - 1000) }),
        );

        expect(result.allowed).toBe(true);
    });

    it('still blocks a canceled manual subscription regardless of period', () => {
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({
                paymentMethod: 'manual',
                status: 'canceled',
                currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
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
