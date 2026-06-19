/**
 * Tests: stripeCompat accessors
 *
 * Regression guard for the production incident where the webhook endpoint renders
 * payloads at API version `2025-12-15.clover` while our SDK/types are pinned to
 * `2023-10-16`. Reading the legacy field paths returned null, so renewals never
 * advanced the period or re-activated a past_due subscription. The fixtures below
 * are the actual relocated field shapes captured from the live Stripe event.
 */
import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { getInvoiceSubscriptionId, getSubscriptionPeriod } from '../utils/stripeCompat';

const asInvoice = (o: unknown) => o as Stripe.Invoice;
const asSubscription = (o: unknown) => o as Stripe.Subscription;

describe('getInvoiceSubscriptionId', () => {
    it('reads the 2025-12-15.clover location: parent.subscription_details.subscription', () => {
        const invoice = asInvoice({
            id: 'in_1ThxRf',
            subscription: undefined,
            parent: {
                type: 'subscription_details',
                subscription_details: { subscription: 'sub_1TWif6' },
            },
        });
        expect(getInvoiceSubscriptionId(invoice)).toBe('sub_1TWif6');
    });

    it('reads the legacy 2023-10-16 location: top-level invoice.subscription (string)', () => {
        const invoice = asInvoice({ id: 'in_legacy', subscription: 'sub_legacy' });
        expect(getInvoiceSubscriptionId(invoice)).toBe('sub_legacy');
    });

    it('handles an expanded subscription object on the legacy field', () => {
        const invoice = asInvoice({ id: 'in_expanded', subscription: { id: 'sub_expanded' } });
        expect(getInvoiceSubscriptionId(invoice)).toBe('sub_expanded');
    });

    it('prefers the legacy field when both are present (deterministic)', () => {
        const invoice = asInvoice({
            subscription: 'sub_legacy',
            parent: { subscription_details: { subscription: 'sub_new' } },
        });
        expect(getInvoiceSubscriptionId(invoice)).toBe('sub_legacy');
    });

    it('returns null for a one-off invoice carrying no subscription', () => {
        expect(getInvoiceSubscriptionId(asInvoice({ id: 'in_oneoff' }))).toBeNull();
        expect(getInvoiceSubscriptionId(asInvoice({ id: 'in_null', subscription: null, parent: null }))).toBeNull();
    });
});

describe('getSubscriptionPeriod', () => {
    it('reads the 2025-12-15.clover location: items.data[0].current_period_*', () => {
        const sub = asSubscription({
            id: 'sub_1TWif6',
            current_period_start: undefined,
            current_period_end: undefined,
            items: { data: [{ current_period_start: 1781379704, current_period_end: 1783971704 }] },
        });
        expect(getSubscriptionPeriod(sub)).toEqual({ start: 1781379704, end: 1783971704 });
    });

    it('reads the legacy 2023-10-16 top-level period fields', () => {
        const sub = asSubscription({
            id: 'sub_legacy',
            current_period_start: 1000,
            current_period_end: 2000,
            items: { data: [] },
        });
        expect(getSubscriptionPeriod(sub)).toEqual({ start: 1000, end: 2000 });
    });

    it('returns nulls when neither location carries a period (e.g. paused)', () => {
        expect(getSubscriptionPeriod(asSubscription({ id: 'sub_paused', items: { data: [] } })))
            .toEqual({ start: null, end: null });
        expect(getSubscriptionPeriod(asSubscription({ id: 'sub_empty' })))
            .toEqual({ start: null, end: null });
    });
});
