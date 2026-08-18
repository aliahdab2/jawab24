/**
 * Create the missing MONTHLY Stripe price (and Product) for any plan that has
 * no `stripe_price_id`.
 *
 * Why this exists: `plans.stripe_price_id` is environment-specific and the seed
 * deliberately never writes it, so a NEW plan lands in the database with no
 * Stripe price at all. Until one exists, `resolveStripePriceForInterval` refuses
 * checkout (400) — which is why a new plan ships `isActive: false` and is only
 * flipped on after this script has run.
 *
 * The sibling script create-yearly-prices.ts cannot do this: it resolves the
 * plan's Product by reading the existing monthly price, so it only works once a
 * monthly price is already there. This one handles the bootstrap case, creating
 * the Product too when the plan has never been sold before.
 *
 * What it does, per plan with `price > 0` and `stripe_price_id` missing:
 *   1. Finds the plan's Product by `metadata.planSlug`, or creates one.
 *   2. Reuses an existing monthly price on that product if one matches
 *      (amount + currency + interval) — re-running never duplicates prices.
 *   3. Otherwise creates a monthly recurring price (unit_amount = plans.price,
 *      lookup_key = `<slug>-monthly`).
 *   4. Writes the price id back to `plans.stripe_price_id`.
 *
 * Inactive plans are INCLUDED on purpose — that is the whole point: the price
 * must exist before the plan is activated, never after.
 *
 * Defaults to DRY-RUN (no Stripe writes, no DB writes). Pass --apply to act.
 *
 * Run from inside the backend container so it has the env's Stripe key + DB.
 * Blue/green alternates — confirm which side is live first, do not assume:
 *
 *   curl -s https://jawab24.com/api/version   # -> "environment":"blue"|"green"
 *
 *   # Dry-run (safe, read-only):
 *   docker exec jawab24-backend-<blue|green> npx tsx src/scripts/create-monthly-prices.ts
 *
 *   # Apply for real:
 *   docker exec jawab24-backend-<blue|green> npx tsx src/scripts/create-monthly-prices.ts --apply
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db';
import { plans } from '../db/schema';
import { stripe } from '../services/stripe';
import { revalidatePlanPages } from '../services/revalidation';
import { findAdoptablePrice } from '../utils/stripePrice';

async function main() {
    const apply = process.argv.includes('--apply');
    console.log(`[create-monthly-prices] mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);

    if (!stripe) {
        console.error('[create-monthly-prices] STRIPE_SECRET_KEY is not configured — aborting.');
        process.exitCode = 1;
        return;
    }
    // Say which Stripe environment we are about to write to, without echoing
    // any part of the key itself.
    const keyMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'LIVE' : 'test';
    console.log(`[create-monthly-prices] Stripe environment: ${keyMode}`);

    const candidates = await db
        .select()
        .from(plans)
        .where(and(
            gt(plans.price, 0),
            isNull(plans.stripePriceId),
        ));

    if (candidates.length === 0) {
        console.log('[create-monthly-prices] Nothing to do — every paid plan already has a monthly Stripe price id.');
        return;
    }

    let written = 0;

    for (const plan of candidates) {
        const amount = plan.price;
        const currency = (plan.currency || 'USD').toLowerCase();
        const label = `${plan.slug} (${plan.name})`;

        // Resolve the Product by planSlug metadata. A brand-new plan has never
        // been sold, so unlike the yearly script there is no existing price to
        // read the product from — search, then create.
        let productId: string | null = null;
        try {
            const search = await stripe.products.search({
                query: `metadata['planSlug']:'${plan.slug}' AND active:'true'`,
                limit: 1,
            });
            productId = search.data[0]?.id ?? null;
        } catch (err) {
            console.error(`  ✗ ${label}: product search failed: ${(err as Error).message} — skipping.`);
            process.exitCode = 1;
            continue;
        }

        if (productId) {
            console.log(`  = ${label}: using existing product ${productId}`);
        } else if (!apply) {
            console.log(`  → ${label}: would create product + monthly price $${(amount / 100).toFixed(2)}/mo`);
            continue;
        } else {
            try {
                const product = await stripe.products.create({
                    name: `Jawab24 ${plan.name}`,
                    description: plan.description || undefined,
                    metadata: { planSlug: plan.slug, source: 'create-monthly-prices script' },
                });
                productId = product.id;
                console.log(`  + ${label}: created product ${productId}`);
            } catch (err) {
                console.error(`  ✗ ${label}: product creation failed: ${(err as Error).message} — skipping.`);
                process.exitCode = 1;
                continue;
            }
        }

        // Idempotency: adopt a matching monthly price if the product already
        // carries one (a previous partial run, or a hand-made Dashboard price).
        const existing = await stripe.prices.list({ product: productId, active: true, limit: 100 });
        const match = findAdoptablePrice(existing.data, amount, currency, 'month');

        let monthlyPriceId: string;
        if (match) {
            monthlyPriceId = match.id;
            console.log(`  = ${label}: adopting existing monthly price ${monthlyPriceId} ($${(amount / 100).toFixed(2)}/mo)`);
        } else if (!apply) {
            console.log(`  → ${label}: would create monthly price $${(amount / 100).toFixed(2)}/mo on product ${productId}`);
            continue;
        } else {
            try {
                const created = await stripe.prices.create({
                    product: productId,
                    unit_amount: amount,
                    currency,
                    recurring: { interval: 'month' },
                    lookup_key: `${plan.slug}-monthly`,
                    metadata: { planSlug: plan.slug, source: 'create-monthly-prices script' },
                });
                monthlyPriceId = created.id;
            } catch (err) {
                // e.g. the lookup_key is held by a non-matching price — surface
                // it and keep going so one plan can't block the others.
                console.error(`  ✗ ${label}: Stripe price creation failed: ${(err as Error).message} — skipping.`);
                process.exitCode = 1;
                continue;
            }
            console.log(`  + ${label}: created monthly price ${monthlyPriceId} ($${(amount / 100).toFixed(2)}/mo)`);
        }

        if (apply) {
            await db
                .update(plans)
                .set({ stripePriceId: monthlyPriceId, updatedAt: new Date() })
                .where(eq(plans.id, plan.id));
            written += 1;
            console.log(`    ↳ plans.stripe_price_id set for ${plan.slug}`);
        } else {
            console.log(`    ↳ would set plans.stripe_price_id = ${monthlyPriceId} for ${plan.slug}`);
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

    console.log('[create-monthly-prices] done.');
}

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
        console.error('[create-monthly-prices] failed:', err);
        process.exit(1);
    });
