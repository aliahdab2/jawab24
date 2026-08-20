/**
 * GA4 `purchase` conversion — the exactly-once claim (real Postgres).
 *
 * THE DEFECT THIS GUARDS. Until 2026-08-20 the money event was reported only
 * from `checkout.session.completed`. Starter carries `trialDays: 30` and is the
 * default plan, and `payment.ts` grants that trial to anyone with no prior
 * subscription — i.e. every new signup — so a trialed checkout completes at $0,
 * hit the amount guard, and reported nothing. The real charge 30 days later
 * arrives as `invoice.payment_succeeded`, which had no GA4 hook at all. Result:
 * a merchant acquired by an ad could never produce a `purchase` conversion.
 * Measured on production the day this was found: 79 of 85 subscriptions carried
 * a `trial_ends_at`.
 *
 * Adding the invoice hook creates the opposite hazard, because that event also
 * fires on EVERY renewal for the life of the subscription. A renewal is not an
 * acquisition; reporting one as a purchase would teach Smart Bidding that a
 * merchant is worth several times what they are.
 *
 * `subscriptions.ga4_purchase_reported_at` resolves both: the first caller to
 * see money claims it, everything after finds it set. This is asserted against a
 * real database rather than a mocked update chain for the same reason as
 * `gaClientIdFirstTouch.test.ts` — the guarantee IS the SQL
 * (`UPDATE … WHERE external_subscription_id = ? AND ga4_purchase_reported_at IS
 * NULL RETURNING user_id`). A mock can only confirm that some condition object
 * was passed; only Postgres can confirm the second write did nothing, and only
 * Postgres can settle what happens when two webhooks land at once.
 *
 * Covers:
 *   1. the first paid invoice claims the stamp and sends
 *   2. every later invoice (a renewal) resolves `already_reported` and sends nothing
 *   3. ⛔ a $0 trial checkout does NOT consume the stamp — the ordering trap
 *   4. the whole trial lifecycle in sequence: $0 checkout → first charge → renewal
 *   5. concurrent delivery of the same event elects exactly ONE winner
 *   6. the stamp is scoped per subscription
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestUser, testDb } from './setup';
import * as schema from '../../src/db/schema';
import { config } from '../../src/config';
// The PRODUCTION function, so the predicate under test cannot drift away from
// the predicate that ships.
import { sendPurchaseConversion, storeGaClientIdFirstTouch } from '../../src/services/ga4';

const uid = () => Math.random().toString(36).slice(2, 10);

/** Every MP send is intercepted — this suite asserts on the CLAIM, and must
 *  never put a test event into the real GA4 property. */
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    // The claim is skipped entirely when GA4 is unconfigured (so an unwired
    // environment cannot burn a subscription's one stamp), which is the normal
    // state of a test box. Give it credentials so the claim path actually runs.
    vi.spyOn(config, 'ga4', 'get').mockReturnValue({
        measurementId: 'G-INTEGRATION',
        apiSecret: 'secret-integration',
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function readStamp(subId: string): Promise<Date | null> {
    const [row] = await testDb
        .select({ stamp: schema.subscriptions.ga4PurchaseReportedAt })
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.id, subId))
        .limit(1);
    return row?.stamp ?? null;
}

async function createPlan() {
    const [plan] = await testDb.insert(schema.plans).values({
        name: 'Starter', slug: `plan-${uid()}`, price: 1500,
        stripePriceId: `price_${uid()}`, trialDays: 30,
        maxAiRepliesPerMonth: 1500, maxTemplates: 10, maxRules: 10, isActive: true,
    }).returning();
    return plan;
}

/** A merchant mid-trial: attribution id captured, subscription linked, nothing
 *  reported to GA4 yet. */
async function seedTrialingMerchant() {
    const user = await createTestUser({ facebookId: `ga4-claim-${uid()}` });
    // Without an attribution id every send resolves `no_client_id`, which would
    // hide whether the claim itself worked.
    await storeGaClientIdFirstTouch(user.id, `${Date.now()}.1700000000`);
    const plan = await createPlan();
    const stripeSubscriptionId = `sub_${uid()}`;
    const [sub] = await testDb.insert(schema.subscriptions).values({
        userId: user.id,
        planId: plan.id,
        status: 'trialing',
        paymentMethod: 'stripe',
        externalSubscriptionId: stripeSubscriptionId,
        stripeCustomerId: `cus_${uid()}`,
        trialEndsAt: new Date(Date.now() + 30 * 86_400_000),
    }).returning();
    return { user, sub, stripeSubscriptionId };
}

describe('subscriptions.ga4_purchase_reported_at — the purchase claim', () => {
    it('claims on the first paid invoice and sends the conversion', async () => {
        const { sub, stripeSubscriptionId } = await seedTrialingMerchant();

        expect(await readStamp(sub.id)).toBeNull();

        const result = await sendPurchaseConversion({
            stripeSubscriptionId,
            transactionId: `in_${uid()}`,
            amountMinorUnits: 1500,
            currency: 'usd',
            planId: 'starter',
        });

        expect(result).toEqual({ sent: true });
        expect(await readStamp(sub.id)).toBeInstanceOf(Date);

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.events[0].params).toMatchObject({ value: 15, currency: 'USD' });
    });

    it('refuses every later invoice — a renewal is not an acquisition', async () => {
        const { sub, stripeSubscriptionId } = await seedTrialingMerchant();

        await sendPurchaseConversion({
            stripeSubscriptionId, transactionId: `in_first_${uid()}`,
            amountMinorUnits: 1500, currency: 'usd', planId: 'starter',
        });
        const firstStamp = await readStamp(sub.id);
        expect(firstStamp).toBeInstanceOf(Date);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // Twelve months of renewals, all of them real money, none of them an
        // acquisition.
        for (let month = 0; month < 12; month++) {
            const result = await sendPurchaseConversion({
                stripeSubscriptionId, transactionId: `in_renewal_${month}`,
                amountMinorUnits: 1500, currency: 'usd', planId: 'starter',
            });
            expect(result).toEqual({ sent: false, reason: 'already_reported' });
        }

        expect(fetchMock).toHaveBeenCalledTimes(1);
        // And the original stamp is untouched — it dates the acquisition, so a
        // renewal must not move it.
        expect((await readStamp(sub.id))?.getTime()).toBe(firstStamp?.getTime());
    });

    /**
     * ⛔ THE ORDERING TRAP, against a real database. If the amount guard ran
     * after the claim, the $0 trial checkout would stamp the row and the real
     * charge 30 days later would be refused as `already_reported` — losing the
     * merchant's only purchase conversion and reinstating the very bug the
     * invoice hook exists to fix.
     */
    it('does not let a $0 trial checkout consume the stamp', async () => {
        const { sub, stripeSubscriptionId } = await seedTrialingMerchant();

        const atCheckout = await sendPurchaseConversion({
            stripeSubscriptionId,
            transactionId: `cs_${uid()}`,
            amountMinorUnits: 0, // Stripe collects nothing when a trial is attached
            currency: 'usd',
            planId: 'starter',
        });

        expect(atCheckout).toEqual({ sent: false, reason: 'zero_amount' });
        expect(await readStamp(sub.id)).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports exactly once across the whole trial lifecycle', async () => {
        const { sub, stripeSubscriptionId } = await seedTrialingMerchant();

        // Day 0 — checkout.session.completed at $0.
        expect(await sendPurchaseConversion({
            stripeSubscriptionId, transactionId: `cs_${uid()}`,
            amountMinorUnits: 0, currency: 'usd', planId: 'starter',
        })).toEqual({ sent: false, reason: 'zero_amount' });

        // Day 30 — invoice.payment_succeeded, the first real charge.
        expect(await sendPurchaseConversion({
            stripeSubscriptionId, transactionId: `in_${uid()}`,
            amountMinorUnits: 1500, currency: 'usd', planId: 'starter',
        })).toEqual({ sent: true });

        // Day 60 — invoice.payment_succeeded again, a renewal.
        expect(await sendPurchaseConversion({
            stripeSubscriptionId, transactionId: `in_${uid()}`,
            amountMinorUnits: 1500, currency: 'usd', planId: 'starter',
        })).toEqual({ sent: false, reason: 'already_reported' });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(await readStamp(sub.id)).toBeInstanceOf(Date);
    });

    /**
     * Stripe retries a webhook whose handler failed, and can deliver the same
     * event to two workers at once. GA4's own `transaction_id` dedup is the
     * second line of defence, not the first — nothing documents it holding
     * against a transaction it last saw a month ago. So the election has to be
     * decided by Postgres, which is only observable here.
     */
    it('elects exactly one winner when the same payment lands concurrently', async () => {
        const { sub, stripeSubscriptionId } = await seedTrialingMerchant();
        const transactionId = `in_concurrent_${uid()}`;

        const results = await Promise.all(
            Array.from({ length: 8 }, () => sendPurchaseConversion({
                stripeSubscriptionId, transactionId,
                amountMinorUnits: 1500, currency: 'usd', planId: 'starter',
            })),
        );

        expect(results.filter(r => r.sent)).toHaveLength(1);
        expect(results.filter(r => r.reason === 'already_reported')).toHaveLength(7);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(await readStamp(sub.id)).toBeInstanceOf(Date);
    });

    it('scopes the stamp per subscription — one merchant reporting never blocks another', async () => {
        const first = await seedTrialingMerchant();
        const second = await seedTrialingMerchant();

        expect(await sendPurchaseConversion({
            stripeSubscriptionId: first.stripeSubscriptionId, transactionId: `in_${uid()}`,
            amountMinorUnits: 1500, currency: 'usd', planId: 'starter',
        })).toEqual({ sent: true });

        expect(await sendPurchaseConversion({
            stripeSubscriptionId: second.stripeSubscriptionId, transactionId: `in_${uid()}`,
            amountMinorUnits: 7900, currency: 'usd', planId: 'pro',
        })).toEqual({ sent: true });

        expect(await readStamp(first.sub.id)).toBeInstanceOf(Date);
        expect(await readStamp(second.sub.id)).toBeInstanceOf(Date);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    /** An unlinked subscription cannot be claimed, and that is not an error —
     *  adoptStripeSubscription handles the linking, and the next paid invoice
     *  finds a row to stamp. */
    it('sends nothing for a Stripe subscription no local row matches', async () => {
        const result = await sendPurchaseConversion({
            stripeSubscriptionId: `sub_unlinked_${uid()}`,
            transactionId: `in_${uid()}`,
            amountMinorUnits: 1500,
            currency: 'usd',
            planId: 'starter',
        });

        expect(result).toEqual({ sent: false, reason: 'already_reported' });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
