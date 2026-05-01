#!/usr/bin/env npx tsx
/**
 * Fix orphaned subscription rows for a single user.
 *
 * Use case: a subscription row was created/upgraded manually (no Stripe
 * subscription ID) and now coexists with a newer paid subscription. The plan
 * resolver picks by status priority + createdAt DESC, but if the manual row
 * is also `active` it can win or muddle billing reports. This script cancels
 * any active/trialing rows that have no externalSubscriptionId AND a newer
 * Stripe-backed active row exists for the same user.
 *
 * Usage:
 *   npx tsx scripts/fix-orphan-subscription.ts <email>            # dry run
 *   npx tsx scripts/fix-orphan-subscription.ts <email> --apply    # write
 */

import dotenv from 'dotenv';
dotenv.config();

import { and, eq } from 'drizzle-orm';
import { db } from '../src/db';
import { plans, subscriptions, users } from '../src/db/schema';
import { subscriptionsService } from '../src/services/subscriptions';

async function main() {
    const [, , email, flag] = process.argv;
    const apply = flag === '--apply';

    if (!email) {
        console.error('Usage: npx tsx scripts/fix-orphan-subscription.ts <email> [--apply]');
        process.exit(1);
    }

    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) {
        console.error(`User not found: ${email}`);
        process.exit(1);
    }

    const rows = await db
        .select({
            id: subscriptions.id,
            planName: plans.name,
            planId: subscriptions.planId,
            status: subscriptions.status,
            externalSubscriptionId: subscriptions.externalSubscriptionId,
            paymentMethod: subscriptions.paymentMethod,
            createdAt: subscriptions.createdAt,
            currentPeriodEnd: subscriptions.currentPeriodEnd,
        })
        .from(subscriptions)
        .innerJoin(plans, eq(subscriptions.planId, plans.id))
        .where(eq(subscriptions.userId, user.id))
        .orderBy(subscriptions.createdAt);

    console.log(`\nUser: ${email} (${user.id})`);
    console.log(`Subscription rows: ${rows.length}`);
    for (const r of rows) {
        console.log(
            `  ${r.createdAt?.toISOString()}  ${r.status?.padEnd(9)}  ${r.planName.padEnd(10)}  stripeSub=${r.externalSubscriptionId ?? '—'}  method=${r.paymentMethod ?? '—'}`
        );
    }

    const activeStripeBacked = rows.filter(
        r => (r.status === 'active' || r.status === 'trialing') && r.externalSubscriptionId
    );
    const activeOrphans = rows.filter(
        r => (r.status === 'active' || r.status === 'trialing') && !r.externalSubscriptionId
    );

    if (activeStripeBacked.length === 0) {
        console.log('\nNo active Stripe-backed subscription found — refusing to cancel orphans without a paid replacement.');
        process.exit(0);
    }
    if (activeOrphans.length === 0) {
        console.log('\nNo orphaned active subscriptions to cancel. Nothing to do.');
        process.exit(0);
    }

    const newestStripe = activeStripeBacked.reduce((a, b) =>
        (a.createdAt?.getTime() ?? 0) > (b.createdAt?.getTime() ?? 0) ? a : b
    );

    const toCancel = activeOrphans.filter(
        r => (r.createdAt?.getTime() ?? 0) < (newestStripe.createdAt?.getTime() ?? 0)
    );

    console.log(`\nNewest paid subscription: ${newestStripe.planName} (created ${newestStripe.createdAt?.toISOString()})`);
    console.log(`Orphan rows to cancel: ${toCancel.length}`);
    for (const r of toCancel) {
        console.log(`  - ${r.id} ${r.planName} status=${r.status}`);
    }

    if (!apply) {
        console.log('\nDry run. Re-run with --apply to write changes.');
        process.exit(0);
    }

    for (const r of toCancel) {
        await db
            .update(subscriptions)
            .set({
                status: 'canceled',
                canceledAt: new Date(),
                cancelReason: 'Orphan manual subscription replaced by paid subscription (admin fix)',
                updatedAt: new Date(),
            })
            .where(and(eq(subscriptions.id, r.id), eq(subscriptions.userId, user.id)));
        console.log(`Canceled ${r.id}`);
    }

    await subscriptionsService.invalidateStatusCache(user.id);
    console.log('\nDone. Status cache invalidated.');
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
