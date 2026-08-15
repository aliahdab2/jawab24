#!/usr/bin/env npx tsx
/**
 * Reconcile the `plans` table from src/config/plans.ts.
 *
 * Runs after `db:migrate` on every deploy — plans are treated as versioned
 * config, not hand-edited DB rows. Idempotent: upserts by slug, guarantees
 * exactly one default plan. Never touches stripe_price_id / stripe_yearly_price_id
 * (those are env-specific and set manually).
 *
 * Usage:
 *   npm run seed:plans           # production / CI
 *   npx tsx src/scripts/seed-plans.ts
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql, eq, notInArray, and } from 'drizzle-orm';
import postgres from 'postgres';
import dotenv from 'dotenv';
import { plans } from '../db/schema';
import { PLANS } from '../config/plans';
import { revalidatePlanPages } from '../services/revalidation';

dotenv.config();

async function seedPlans() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not defined');

    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);

    console.error(`🌱 Seeding ${PLANS.length} plan(s) from config/plans.ts`);

    try {
        const defaults = PLANS.filter((p) => p.isDefault);
        if (defaults.length !== 1) {
            throw new Error(`Config error: expected exactly 1 default plan, found ${defaults.length}`);
        }
        const defaultSlug = defaults[0].slug;

        for (const plan of PLANS) {
            await db
                .insert(plans)
                .values({
                    slug: plan.slug,
                    name: plan.name,
                    description: plan.description,
                    price: plan.price,
                    yearlyPrice: plan.yearlyPrice,
                    currency: plan.currency,
                    interval: plan.interval,
                    maxPages: plan.maxPages,
                    maxAiRepliesPerMonth: plan.maxAiRepliesPerMonth,
                    facebookEnabled: plan.facebookEnabled,
                    instagramEnabled: plan.instagramEnabled,
                    whatsappEnabled: plan.whatsappEnabled,
                    ecommerceEnabled: plan.ecommerceEnabled,
                    prioritySupport: plan.prioritySupport,
                    trialDays: plan.trialDays,
                    isActive: plan.isActive,
                    isPublic: plan.isPublic,
                    isDefault: plan.isDefault,
                    sortOrder: plan.sortOrder,
                })
                .onConflictDoUpdate({
                    target: plans.slug,
                    set: {
                        name: plan.name,
                        description: plan.description,
                        price: plan.price,
                        yearlyPrice: plan.yearlyPrice,
                        currency: plan.currency,
                        interval: plan.interval,
                        maxPages: plan.maxPages,
                        maxAiRepliesPerMonth: plan.maxAiRepliesPerMonth,
                        facebookEnabled: plan.facebookEnabled,
                        instagramEnabled: plan.instagramEnabled,
                        whatsappEnabled: plan.whatsappEnabled,
                        ecommerceEnabled: plan.ecommerceEnabled,
                        prioritySupport: plan.prioritySupport,
                        trialDays: plan.trialDays,
                        isActive: plan.isActive,
                        isPublic: plan.isPublic,
                        isDefault: plan.isDefault,
                        sortOrder: plan.sortOrder,
                        updatedAt: sql`NOW()`,
                    },
                });
            console.error(`  ✓ ${plan.slug.padEnd(10)} $${(plan.price / 100).toFixed(0).padStart(3)}/mo  ${plan.maxAiRepliesPerMonth} replies  ${plan.maxPages} page(s)`);
        }

        await db
            .update(plans)
            .set({ isDefault: false, updatedAt: sql`NOW()` })
            .where(and(eq(plans.isDefault, true), notInArray(plans.slug, [defaultSlug])));

        const configSlugs = PLANS.map((p) => p.slug);
        const extras = await db
            .select({ slug: plans.slug, isActive: plans.isActive })
            .from(plans)
            .where(and(eq(plans.isActive, true), notInArray(plans.slug, configSlugs)));

        if (extras.length > 0) {
            console.error(`ℹ️  Active plans in DB not in config (left untouched):`);
            for (const extra of extras) console.error(`   - ${extra.slug}`);
        }

        console.error(`✅ Plans reconciled. Default: ${defaultSlug}`);

        await revalidatePlanPages();
    } catch (err) {
        console.error('❌ Plan seed failed:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

seedPlans().catch((err) => {
    console.error('❌ Unexpected error during plan seed:', err);
    process.exit(1);
});
