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

import { subscriptionsService, resolveEntitlementEnd, isPayingCustomer } from '../services/subscriptions';

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

    it('blocks the AUTO-REPLY path regardless of top-up balance', async () => {
        // canAutoReply — what enforceAutoReplyGate actually calls — consults status
        // only and never reaches the top-up fallback that canUseAiReplies applies
        // directly above. Pinned because the dashboard banner suppresses its top-up
        // CTA on the strength of it: offering credits that cannot unblock a reply
        // would be taking money for nothing.
        //
        // Must exercise canAutoReply with a REAL balance present — an earlier version
        // of this test called checkSubscriptionStatus, which cannot see a balance at
        // all, so it would have stayed green through exactly the change it names.
        vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(
            sub({ paymentMethod: 'manual', currentPeriodEnd: new Date('2026-07-17T18:52:00.000Z') }),
        );
        vi.spyOn(subscriptionsService, 'getTopupBalance').mockResolvedValue(500);

        const gate = await subscriptionsService.canAutoReply('user-1');
        expect(gate.allowed).toBe(false);

        // ...while the billing-level check DOES honour the balance. The two answering
        // differently is the point: one asks "may automation run", the other "may this
        // call be billed". If they ever converge, the banner's CTA logic is wrong.
        const billing = await subscriptionsService.canUseAiReplies('user-1');
        expect(billing.allowed).toBe(true);
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
    const PERIOD_END = new Date('2026-08-14T16:26:00.000Z');

    it('snaps a manual plan back to UTC midnight of the period-end day', () => {
        expect(
            resolveEntitlementEnd({
                status: 'active', paymentMethod: 'manual', currentPeriodEnd: PERIOD_END, trialEndsAt: null,
            })?.toISOString(),
        ).toBe('2026-08-14T00:00:00.000Z');
    });

    it('uses trialEndsAt for a trial-origin row, NOT the far-future period end', () => {
        // The defect this replaced: modelling only the manual rail returned
        // currentPeriodEnd here — roughly three weeks AFTER the gate cuts the trial
        // off — and the dashboard printed it as "Coverage ended <future date>".
        for (const status of ['trialing', 'past_due'] as const) {
            expect(
                resolveEntitlementEnd({
                    status, paymentMethod: null,
                    currentPeriodEnd: PERIOD_END,
                    trialEndsAt: new Date('2026-07-22T09:00:00.000Z'),
                })?.toISOString(),
            ).toBe('2026-07-22T09:00:00.000Z');
        }
    });

    it('adds the retry grace for past_due, which ends AFTER the period end', () => {
        expect(
            resolveEntitlementEnd({
                status: 'past_due', paymentMethod: 'stripe', currentPeriodEnd: PERIOD_END, trialEndsAt: null,
            })?.toISOString(),
        ).toBe('2026-08-17T16:26:00.000Z');
    });

    it('leaves a healthy external rail on its exact instant', () => {
        for (const paymentMethod of ['stripe', 'shopify', 'zid']) {
            expect(
                resolveEntitlementEnd({
                    status: 'active', paymentMethod, currentPeriodEnd: PERIOD_END, trialEndsAt: null,
                })?.toISOString(),
            ).toBe(PERIOD_END.toISOString());
        }
    });

    it('returns null when no CLOCK bounds the row (never "it has ended")', () => {
        // canceled/paused are refused by STATUS, and a past_due row with no period
        // end is never refused at all. Neither has a date to show a merchant.
        for (const s of [
            { status: 'canceled' as const, paymentMethod: 'stripe', currentPeriodEnd: PERIOD_END, trialEndsAt: null },
            { status: 'paused' as const, paymentMethod: 'stripe', currentPeriodEnd: PERIOD_END, trialEndsAt: null },
            { status: 'past_due' as const, paymentMethod: 'stripe', currentPeriodEnd: null, trialEndsAt: null },
            { status: 'active' as const, paymentMethod: 'manual', currentPeriodEnd: null, trialEndsAt: null },
        ]) {
            expect(resolveEntitlementEnd(s)).toBeNull();
        }
    });

    it('agrees with the gate at every hour, on every rail', () => {
        // THE invariant, and the reason the boundary is not a second implementation:
        // whenever a date is shown, the gate's verdict must be exactly "that date is
        // still ahead of us". Walking every rail hour by hour catches a change made
        // to one function and not the other — which is how the trial rail broke.
        // Only the rails checkSubscriptionStatus can bound BY ITSELF. An `active`
        // external row is deliberately absent — see the test below.
        const RAILS = [
            { label: 'manual', status: 'active' as const, paymentMethod: 'manual', currentPeriodEnd: PERIOD_END, trialEndsAt: null },
            { label: 'stripe past_due', status: 'past_due' as const, paymentMethod: 'stripe', currentPeriodEnd: PERIOD_END, trialEndsAt: null },
            { label: 'trial-origin trialing', status: 'trialing' as const, paymentMethod: null, currentPeriodEnd: PERIOD_END, trialEndsAt: new Date('2026-08-12T09:00:00.000Z') },
            { label: 'trial-origin past_due', status: 'past_due' as const, paymentMethod: null, currentPeriodEnd: PERIOD_END, trialEndsAt: new Date('2026-08-12T09:00:00.000Z') },
        ];

        for (const rail of RAILS) {
            const endsAt = resolveEntitlementEnd(rail);
            if (!endsAt) throw new Error(`${rail.label}: expected a bounded entitlement end`);

            for (let hour = 0; hour < 24 * 8; hour++) {
                const now = new Date(Date.UTC(2026, 7, 11, hour));
                vi.setSystemTime(now);
                expect(
                    { rail: rail.label, hour, allowed: subscriptionsService.checkSubscriptionStatus(sub(rail)).allowed },
                ).toEqual({ rail: rail.label, hour, allowed: endsAt >= now });
            }
        }
    });

    it('an expired ACTIVE external row is not blocked by the predicate alone — the flip does it', () => {
        // Why the admin console must resolve through getUserSubscription rather than
        // evaluating the row it selected itself. checkSubscriptionStatus has no period
        // check for Stripe/Shopify/Zid: those rails are expired by getUserSubscription
        // LAZILY FLIPPING status to past_due (and persisting it), after which the
        // grace arm above applies. Evaluate the un-flipped row and you get
        // `allowed: true` for an account whose replies are about to stop — a green
        // console over the silent auto-renew suspension.
        vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z')); // 10 days past period end
        const raw = sub({ status: 'active', paymentMethod: 'stripe', currentPeriodEnd: PERIOD_END });
        expect(subscriptionsService.checkSubscriptionStatus(raw).allowed).toBe(true);

        // Post-flip, the same row is correctly refused.
        const flipped = sub({ status: 'past_due', paymentMethod: 'stripe', currentPeriodEnd: PERIOD_END });
        expect(subscriptionsService.checkSubscriptionStatus(flipped).allowed).toBe(false);
    });
});

/**
 * `cause` — the gate's own account of WHY it refused.
 *
 * 19 of the 20 `past_due` rows on prod (2026-08-22) were expired TRIALS, lazily
 * flipped from `trialing`. Every surface keyed on `code` told those merchants
 * "your subscription ended — renew". They never subscribed. `code` must stay
 * `subscription_inactive` (several callers switch on it); `cause` is the
 * additive field that lets the copy tell the two apart.
 */
describe('checkSubscriptionStatus — cause', () => {
    const PAST = new Date('2026-08-01T00:00:00.000Z');

    it('names an expired trial-origin row as trial_expired, in BOTH lazy-flip states', () => {
        vi.setSystemTime(new Date('2026-08-22T00:00:00.000Z'));
        for (const status of ['trialing', 'past_due'] as const) {
            const result = subscriptionsService.checkSubscriptionStatus(
                sub({ status, paymentMethod: null, trialEndsAt: PAST, currentPeriodEnd: new Date('2026-08-02T00:00:00.000Z') }),
            );
            expect({ status, allowed: result.allowed, code: result.code, cause: result.cause })
                .toEqual({ status, allowed: false, code: 'subscription_inactive', cause: 'trial_expired' });
        }
    });

    it('names a plain trialing row past its end as trial_expired too', () => {
        vi.setSystemTime(new Date('2026-08-22T00:00:00.000Z'));
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({ status: 'trialing', paymentMethod: 'stripe', trialEndsAt: PAST, currentPeriodEnd: null }),
        );
        expect(result.cause).toBe('trial_expired');
    });

    it('carries NO cause for a lapsed paid subscription — that one really should renew', () => {
        vi.setSystemTime(new Date('2026-08-22T00:00:00.000Z'));
        for (const s of [
            sub({ status: 'active', paymentMethod: 'manual', currentPeriodEnd: PAST, trialEndsAt: null }),
            sub({ status: 'past_due', paymentMethod: 'stripe', currentPeriodEnd: PAST, trialEndsAt: null }),
            sub({ status: 'canceled', paymentMethod: 'stripe', currentPeriodEnd: PAST, trialEndsAt: null }),
        ]) {
            const result = subscriptionsService.checkSubscriptionStatus(s);
            expect(result.allowed).toBe(false);
            expect(result.cause).toBeUndefined();
        }
    });
});

describe('checkSubscriptionStatus — EVERY offline rail expires, not just "manual"', () => {
    // The bug this pins: the gate tested `paymentMethod === 'manual'` literally,
    // so a row stamped 'bank_transfer' or 'syrian_bank' — BOTH already
    // selectable in the admin upgrade modal, and one of them live in production
    // — skipped the immediate expiry check entirely, fell through to the
    // past_due branch, and collected the 3-day grace meant for a Stripe CARD
    // RETRY. With the usage window already closed, getCurrentUsage reads used=0,
    // so that grace handed the merchant a free full-quota refill. There is no
    // card to retry on any offline rail.
    it.each(['manual', 'bank_transfer', 'syrian_bank', 'sham_cash'])(
        'blocks an expired %s subscription',
        (paymentMethod) => {
            const result = subscriptionsService.checkSubscriptionStatus(
                sub({ paymentMethod, currentPeriodEnd: new Date('2026-07-17T18:52:00.000Z') }),
            );

            expect(result.allowed).toBe(false);
            expect(result.code).toBe('subscription_inactive');
        },
    );

    it.each(['manual', 'bank_transfer', 'syrian_bank', 'sham_cash'])(
        'serves a %s subscription while its window is open',
        (paymentMethod) => {
            const result = subscriptionsService.checkSubscriptionStatus(
                sub({ paymentMethod, currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY_MS) }),
            );

            expect(result.allowed).toBe(true);
        },
    );

    it('does not treat an unknown payment method as offline', () => {
        // The set is an allowlist, not a "not stripe" fallback: a new MANAGED
        // rail must not start expiring on date the moment it is introduced.
        const result = subscriptionsService.checkSubscriptionStatus(
            sub({ paymentMethod: 'some_future_rail', currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z') }),
        );

        expect(result.allowed).toBe(true);
    });
});

describe('resolveEntitlementEnd — offline rails read their own period end', () => {
    it.each(['manual', 'bank_transfer', 'syrian_bank', 'sham_cash'])(
        'snaps %s to UTC midnight of the period end',
        (paymentMethod) => {
            const end = resolveEntitlementEnd(
                sub({ paymentMethod, currentPeriodEnd: new Date('2026-07-20T18:52:00.000Z') }),
            );

            // Snapped, so the date the merchant is shown is the date enforced.
            expect(end?.toISOString()).toBe('2026-07-20T00:00:00.000Z');
        },
    );
});

describe('isPayingCustomer — an offline payer is a customer', () => {
    it.each(['manual', 'bank_transfer', 'syrian_bank', 'sham_cash'])(
        'counts an active %s row',
        (paymentMethod) => {
            expect(isPayingCustomer({
                status: 'active',
                externalSubscriptionId: null,
                stripeCustomerId: null,
                paymentMethod,
            })).toBe(true);
        },
    );

    it('does not count a canceled offline row', () => {
        expect(isPayingCustomer({
            status: 'canceled',
            externalSubscriptionId: null,
            stripeCustomerId: null,
            paymentMethod: 'bank_transfer',
        })).toBe(false);
    });

    it('does not count a trial-only row', () => {
        expect(isPayingCustomer({
            status: 'trialing',
            externalSubscriptionId: null,
            stripeCustomerId: null,
            paymentMethod: null,
        })).toBe(false);
    });
});
