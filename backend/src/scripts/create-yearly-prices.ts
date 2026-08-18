/**
 * Create the missing YEARLY Stripe prices for plans that advertise a yearly
 * amount (`plans.yearly_price`) but have no `stripe_yearly_price_id`.
 *
 * Why this exists: the pricing page has promised "save ~17%" on yearly billing
 * since launch, but no yearly Stripe price was ever created — so a yearly
 * checkout silently subscribed the merchant to the MONTHLY price. The backend
 * now refuses that combination (400 YEARLY_NOT_AVAILABLE, utils/stripePrice.ts)
 * and the UI hides the yearly toggle until `yearlyAvailable` is true; this
 * script is the second half of the fix — it makes yearly actually purchasable.
 *
 * What it does, per plan with `yearly_price` set, `stripe_price_id` set and
 * `stripe_yearly_price_id` missing:
 *   1. Reads the monthly price from Stripe to find the plan's Product.
 *   2. Reuses an existing yearly price on that product if one matches
 *      (amount + currency + interval) — re-running never duplicates prices.
 *   3. Otherwise creates a yearly recurring price on the SAME product
 *      (unit_amount = plans.yearly_price, lookup_key = `<slug>-yearly`).
 *   4. Writes the price id back to `plans.stripe_yearly_price_id`.
 *
 * Defaults to DRY-RUN (no Stripe writes, no DB writes). Pass --apply to act.
 *
 * Run from inside the backend container so it has the env's Stripe key + DB.
 * Blue/green alternates — confirm which side is live first, do not assume:
 *
 *   curl -s https://jawab24.com/api/version   # -> "environment":"blue"|"green"
 *
 *   # Dry-run (safe, read-only):
 *   docker exec jawab24-backend-<blue|green> npx tsx src/scripts/create-yearly-prices.ts
 *
 *   # Apply for real:
 *   docker exec jawab24-backend-<blue|green> npx tsx src/scripts/create-yearly-prices.ts --apply
 */
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { plans } from '../db/schema';
import { stripe, stripeRefId } from '../services/stripe';
import { revalidatePlanPages } from '../services/revalidation';
import { findAdoptableYearlyPrice } from '../utils/stripePrice';

async function main() {
    const apply = process.argv.includes('--apply');
    console.log(`[create-yearly-prices] mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);

    if (!stripe) {
        console.error('[create-yearly-prices] STRIPE_SECRET_KEY is not configured — aborting.');
        process.exitCode = 1;
        return;
    }
    // Say which Stripe environment we are about to write to, without echoing
    // any part of the key itself.
    const keyMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'LIVE' : 'test';
    console.log(`[create-yearly-prices] Stripe environment: ${keyMode}`);

    const candidates = await db
        .select()
        .from(plans)
        .where(and(
            isNotNull(plans.yearlyPrice),
            isNotNull(plans.stripePriceId),
            isNull(plans.stripeYearlyPriceId),
        ));

    if (candidates.length === 0) {
        console.log('[create-yearly-prices] Nothing to do — every plan with a yearly price already has a yearly Stripe price id.');
        return;
    }

    let written = 0;

    for (const plan of candidates) {
        const yearlyAmount = plan.yearlyPrice;
        const monthlyPriceId = plan.stripePriceId;
        // The WHERE clause guarantees both, but the row type can't know that.
        if (yearlyAmount === null || !monthlyPriceId) continue;
        const currency = (plan.currency || 'USD').toLowerCase();
        const label = `${plan.slug} (${plan.name})`;

        // Resolve the product from the plan's existing monthly price so the
        // yearly price lands on the same product (one product, two prices —
        // Stripe's recommended model for billing intervals).
        let productId: string | null;
        try {
            const monthlyPrice = await stripe.prices.retrieve(monthlyPriceId);
            productId = stripeRefId(monthlyPrice.product as string | { id: string });
            if (monthlyPrice.currency !== currency) {
                console.error(`  ✗ ${label}: monthly price currency ${monthlyPrice.currency} != plan currency ${currency} — fix the plan row first, skipping.`);
                continue;
            }
        } catch (err) {
            console.error(`  ✗ ${label}: cannot retrieve monthly price ${monthlyPriceId}: ${(err as Error).message} — skipping.`);
            continue;
        }
        if (!productId) {
            console.error(`  ✗ ${label}: monthly price has no product — skipping.`);
            continue;
        }

        // Idempotency: if a matching yearly price already exists on the
        // product (a previous partial run, or one created by hand in the
        // Dashboard), adopt it instead of creating a duplicate.
        const existing = await stripe.prices.list({ product: productId, active: true, limit: 100 });
        const match = findAdoptableYearlyPrice(existing.data, yearlyAmount, currency);

        let yearlyPriceId: string;
        if (match) {
            yearlyPriceId = match.id;
            console.log(`  = ${label}: adopting existing yearly price ${yearlyPriceId} ($${(yearlyAmount / 100).toFixed(2)}/yr)`);
        } else if (!apply) {
            console.log(`  → ${label}: would create yearly price $${(yearlyAmount / 100).toFixed(2)}/yr on product ${productId}`);
            continue;
        } else {
            try {
                const created = await stripe.prices.create({
                    product: productId,
                    unit_amount: yearlyAmount,
                    currency,
                    recurring: { interval: 'year' },
                    lookup_key: `${plan.slug}-yearly`,
                    metadata: { planSlug: plan.slug, source: 'create-yearly-prices script' },
                });
                yearlyPriceId = created.id;
            } catch (err) {
                // e.g. the lookup_key is held by a non-matching price — surface
                // it and keep going so one plan can't block the others.
                console.error(`  ✗ ${label}: Stripe price creation failed: ${(err as Error).message} — skipping.`);
                process.exitCode = 1;
                continue;
            }
            console.log(`  + ${label}: created yearly price ${yearlyPriceId} ($${(yearlyAmount / 100).toFixed(2)}/yr)`);
        }

        if (apply) {
            await db
                .update(plans)
                .set({ stripeYearlyPriceId: yearlyPriceId, updatedAt: new Date() })
                .where(eq(plans.id, plan.id));
            written += 1;
            console.log(`    ↳ plans.stripe_yearly_price_id set for ${plan.slug}`);
        } else {
            console.log(`    ↳ would set plans.stripe_yearly_price_id = ${yearlyPriceId} for ${plan.slug}`);
        }
    }

    // `plans` changed ⇒ the statically generated pricing pages are stale. Every
    // other writer of this table does this (routes/plans.ts create/update/delete,
    // seed-plans.ts); without it the merchant keeps seeing the old page for a
    // full ISR window (revalidate: 3600) with no way to push the update.
    // revalidatePlanPages() never throws — a misconfigured frontend must not
    // fail a run whose Stripe and DB writes already succeeded.
    if (written > 0) {
        await revalidatePlanPages();
    }

    console.log('[create-yearly-prices] done.');
}

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
        console.error('[create-yearly-prices] failed:', err);
        process.exit(1);
    });
