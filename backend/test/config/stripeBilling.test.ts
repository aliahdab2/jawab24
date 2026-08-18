import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { mapStripeSubscriptionStatus, isPaidStripeStatus, PAID_STRIPE_STATUSES } from '../../src/config/stripeBilling';

/**
 * The translation layer between Stripe's status enum and ours. Both functions
 * exist because the local row is read by `checkSubscriptionStatus`, which
 * grants entitlement to any status it does not recognise — so the tests that
 * matter are the ones that would let an unpaid state read as entitled.
 *
 * Every status Stripe can send, per its documented enum. Kept as a literal
 * rather than derived from the map so a status silently DROPPED from the map
 * still gets asserted on.
 */
const ALL_STRIPE_STATUSES: Stripe.Subscription.Status[] = [
    'active',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'past_due',
    'paused',
    'trialing',
    'unpaid',
];

/** Our five-value union — nothing outside it may ever reach the column. */
const OUR_STATUSES = ['trialing', 'active', 'past_due', 'canceled', 'paused'];

describe('isPaidStripeStatus — may this payload advance our paid-through boundary?', () => {
    it.each(['active', 'trialing'])('treats %s as paid', (status) => {
        expect(isPaidStripeStatus(status)).toBe(true);
    });

    /**
     * `past_due` is THE case this predicate exists for. Stripe keeps generating
     * invoices for a past_due subscription, so its current_period_* advances
     * into a month the merchant has not paid for. Mirroring that is what handed
     * one merchant a free month plus a fresh 10,000-reply quota (2026-08-13).
     */
    it.each(['past_due', 'unpaid', 'canceled', 'paused', 'incomplete', 'incomplete_expired'])(
        'refuses %s — the latest invoice is not paid',
        (status) => {
            expect(isPaidStripeStatus(status)).toBe(false);
        },
    );

    it('refuses a status Stripe has not invented yet (unpaid by default, never entitled)', () => {
        expect(isPaidStripeStatus('some_future_status')).toBe(false);
    });
});

describe('mapStripeSubscriptionStatus', () => {
    it.each([
        ['active', 'active'],
        ['trialing', 'trialing'],
        ['past_due', 'past_due'],
        ['canceled', 'canceled'],
        ['paused', 'paused'],
    ])('mirrors %s as %s', (stripeStatus, expected) => {
        expect(mapStripeSubscriptionStatus(stripeStatus)).toEqual({ write: true, status: expected });
    });

    /**
     * The forever-allow hole. `unpaid` is what Stripe writes when Smart Retries
     * are exhausted under the dashboard's "mark unpaid" setting, and its docs
     * say plainly: "Revoke access to your product when the subscription is
     * unpaid." Our union has no such value, so the raw string used to land in
     * the column and fall through every branch of checkSubscriptionStatus.
     *
     * It maps to `past_due` rather than `canceled` for two reasons, and BOTH
     * must hold: past_due carries the last paid period (so the expired grace
     * blocks the merchant), and the service_suspended dunning sweep selects on
     * status='past_due' (so the merchant is still TOLD). Mapping to canceled
     * would block them silently — the deleted-subscription webhook never fires
     * under "mark unpaid".
     */
    it('maps unpaid to past_due — blocked by the expired grace, and still swept for the suspension email', () => {
        expect(mapStripeSubscriptionStatus('unpaid')).toEqual({ write: true, status: 'past_due' });
    });

    it('maps incomplete_expired to canceled — the first payment never landed and Stripe will not bill again', () => {
        expect(mapStripeSubscriptionStatus('incomplete_expired')).toEqual({ write: true, status: 'canceled' });
    });

    /**
     * `incomplete` applies only to a subscription that has never activated, so
     * an existing row reaching it is a downgrade we cannot explain. Preserving
     * the current status errs toward the paying customer; silently downgrading
     * one on an unexplained signal is the failure LAZY_EXPIRY_CANARIES exists
     * to catch.
     */
    it('refuses to write on incomplete, flagged as pre_activation', () => {
        expect(mapStripeSubscriptionStatus('incomplete')).toEqual({ write: false, reason: 'pre_activation' });
    });

    it('refuses to write an unrecognised status, flagged as unknown', () => {
        expect(mapStripeSubscriptionStatus('quantum_superposition')).toEqual({ write: false, reason: 'unknown' });
    });

    /**
     * Runtime companion to the compile-time `Record<Stripe.Subscription.Status,
     * …>`: the type catches a status Stripe ADDS to its SDK types, this catches
     * one silently removed from our map. A miss here means that status reaches
     * the column raw and entitles forever.
     */
    it('answers for every status in Stripe\'s enum — none falls through to unknown', () => {
        const unanswered = ALL_STRIPE_STATUSES.filter(
            (s) => mapStripeSubscriptionStatus(s).write === false
                && mapStripeSubscriptionStatus(s).reason === 'unknown',
        );
        expect(unanswered).toEqual([]);
    });

    /**
     * The invariant the whole module exists for. Anything outside our union
     * reaching `subscriptions.status` is entitlement granted by accident.
     * Migration 0173 now enforces the same rule at the database level; this
     * keeps the application from relying on that backstop to notice.
     */
    it('never yields a status outside our five-value union', () => {
        for (const stripeStatus of [...ALL_STRIPE_STATUSES, 'not_a_real_status']) {
            const mapping = mapStripeSubscriptionStatus(stripeStatus);
            if (mapping.write) expect(OUR_STATUSES).toContain(mapping.status);
        }
    });
});

/**
 * The two exports are independent — one decides whether the period may move,
 * the other what the status becomes — and nothing structural keeps them in
 * step. Drift is silent and specifically dangerous in one direction: a status
 * counted as paid but mapped to something inactive would write `active` (or
 * `trialing`) alongside a period that never advances, which then lazy-expires
 * in getUserSubscription and fires LAZY_EXPIRY_CANARIES at a perfectly healthy
 * Stripe integration — an alert that reads as "the external authority failed".
 */
describe('PAID_STRIPE_STATUSES agrees with the status map', () => {
    it('maps every paid status to an entitling local status', () => {
        for (const status of PAID_STRIPE_STATUSES) {
            const mapping = mapStripeSubscriptionStatus(status);
            expect(mapping.write).toBe(true);
            // A paid Stripe status must never land on a status the gate blocks.
            expect(['active', 'trialing']).toContain(mapping.write ? mapping.status : null);
        }
    });

    it('treats every status the map sends to a blocked state as unpaid', () => {
        const blocked = ALL_STRIPE_STATUSES.filter((s) => {
            const m = mapStripeSubscriptionStatus(s);
            return m.write && (m.status === 'canceled' || m.status === 'paused' || m.status === 'past_due');
        });
        expect(blocked.length).toBeGreaterThan(0); // the filter must actually select something
        for (const status of blocked) {
            expect(isPaidStripeStatus(status)).toBe(false);
        }
    });
});
