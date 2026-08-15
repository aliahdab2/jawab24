import { describe, it, expect } from 'vitest';
import { resolveStripePriceForInterval, findAdoptableYearlyPrice } from '../utils/stripePrice';

describe('resolveStripePriceForInterval', () => {
    const plan = { stripePriceId: 'price_m', stripeYearlyPriceId: 'price_y' };

    it('month resolves the monthly price', () => {
        expect(resolveStripePriceForInterval(plan, 'month')).toEqual({
            ok: true,
            billingInterval: 'month',
            stripePriceId: 'price_m',
        });
    });

    it('absent or unknown interval defaults to month', () => {
        expect(resolveStripePriceForInterval(plan, undefined)).toMatchObject({ ok: true, stripePriceId: 'price_m' });
        expect(resolveStripePriceForInterval(plan, 'weekly')).toMatchObject({ ok: true, stripePriceId: 'price_m' });
    });

    it('year resolves the yearly price when configured', () => {
        expect(resolveStripePriceForInterval(plan, 'year')).toEqual({
            ok: true,
            billingInterval: 'year',
            stripePriceId: 'price_y',
        });
    });

    // The original defect: this exact combination silently billed monthly.
    it('year WITHOUT a yearly price refuses — never falls back to monthly', () => {
        const res = resolveStripePriceForInterval(
            { stripePriceId: 'price_m', stripeYearlyPriceId: null },
            'year',
        );
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.code).toBe('YEARLY_NOT_AVAILABLE');
    });

    it('month without a monthly price refuses with PRICE_NOT_CONFIGURED', () => {
        const res = resolveStripePriceForInterval(
            { stripePriceId: null, stripeYearlyPriceId: null },
            'month',
        );
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.code).toBe('PRICE_NOT_CONFIGURED');
    });
});

describe('findAdoptableYearlyPrice (create-yearly-prices idempotency)', () => {
    const yearly = { id: 'price_y', unit_amount: 15000, currency: 'usd', recurring: { interval: 'year' } };
    const monthly = { id: 'price_m', unit_amount: 1500, currency: 'usd', recurring: { interval: 'month' } };

    it('adopts the price matching interval + amount + currency', () => {
        expect(findAdoptableYearlyPrice([monthly, yearly], 15000, 'usd')).toBe(yearly);
    });

    it('never adopts a monthly price, even at the right amount', () => {
        const monthlyAtYearlyAmount = { ...monthly, id: 'price_trap', unit_amount: 15000 };
        expect(findAdoptableYearlyPrice([monthlyAtYearlyAmount], 15000, 'usd')).toBeUndefined();
    });

    it('never adopts a yearly price with a different amount — a wrong charge, not a duplicate', () => {
        expect(findAdoptableYearlyPrice([yearly], 39000, 'usd')).toBeUndefined();
    });

    it('never adopts across currencies', () => {
        expect(findAdoptableYearlyPrice([yearly], 15000, 'eur')).toBeUndefined();
    });

    it('one-time prices (no recurring) are ignored', () => {
        const oneTime = { id: 'price_once', unit_amount: 15000, currency: 'usd', recurring: null };
        expect(findAdoptableYearlyPrice([oneTime], 15000, 'usd')).toBeUndefined();
    });
});
