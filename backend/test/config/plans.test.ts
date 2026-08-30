import { describe, it, expect } from 'vitest';
import { PLANS, type PlanSeed } from '../../src/config/plans';

/**
 * Pins the load-bearing entitlement facts on the plan seed — the single source
 * of truth (`seed-plans.ts` reconciles the DB row from this on every deploy).
 * These assertions read from `PLANS` directly (not a fixture) so breaking a
 * flag here fails the test, per the D-118 ruling:
 *   - WhatsApp is included from Starter up; Basic is the only paid plan without it.
 *   - The direct-signup free trial is 14 days, on Starter only.
 */
const bySlug = (slug: string): PlanSeed => {
    const plan = PLANS.find((p) => p.slug === slug);
    if (!plan) throw new Error(`plan '${slug}' missing from PLANS`);
    return plan;
};

describe('plan seed — WhatsApp entitlement (D-118)', () => {
    it('includes WhatsApp on Starter', () => {
        expect(bySlug('starter').whatsappEnabled).toBe(true);
    });

    it('excludes WhatsApp on Basic — the reason to upgrade to Starter', () => {
        expect(bySlug('basic').whatsappEnabled).toBe(false);
    });

    it.each(['business', 'pro', 'scale-20k', 'scale-30k'])(
        'includes WhatsApp on %s',
        (slug) => {
            expect(bySlug(slug).whatsappEnabled).toBe(true);
        },
    );

    it('has WhatsApp off on exactly one plan (Basic)', () => {
        expect(PLANS.filter((p) => !p.whatsappEnabled).map((p) => p.slug)).toEqual(['basic']);
    });
});

describe('plan seed — free trial (D-118)', () => {
    it('gives Starter a 14-day trial', () => {
        expect(bySlug('starter').trialDays).toBe(14);
    });

    it('is the ONLY plan with a trial — every other plan is 0', () => {
        const withTrial = PLANS.filter((p) => p.trialDays > 0).map((p) => p.slug);
        expect(withTrial).toEqual(['starter']);
    });

    it('keeps Starter the default plan', () => {
        expect(PLANS.filter((p) => p.isDefault).map((p) => p.slug)).toEqual(['starter']);
    });
});
