import { db } from '../db';
import { subscriptions } from '../db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { subscriptionsService } from './subscriptions';
import { LIVE_SUBSCRIPTION_STATUSES } from '../config/shopifyBilling';

/**
 * A marketplace rail's identity on the `subscriptions` mirror: the
 * `payment_method` value it writes and the store-id column it is keyed on.
 * One descriptor per rail, declared next to the rail's service.
 */
export interface MarketplaceMirrorRail {
    paymentMethod: 'zid' | 'salla';
    storeIdColumn: PgColumn;
}

/**
 * Transition every LIVE mirror row a rail holds for one store. The WHERE
 * triple is THE row-targeting invariant of the billing mirrors — the same
 * shape as each rail's partial unique index (migrations 0161/0181) — so
 * cancel (uninstall) and pause (the marketplace shows no subscription) share
 * one copy of it across rails instead of drifting apart (Rule 10.8; this was
 * a byte-identical private copy in zidBilling and sallaBilling).
 */
export async function updateLiveMirrorsForStore(
    rail: MarketplaceMirrorRail,
    storeId: string,
    set: Partial<typeof subscriptions.$inferInsert>,
): Promise<Array<{ id: string; userId: string }>> {
    const rows = await db
        .update(subscriptions)
        .set(set)
        .where(and(
            eq(subscriptions.paymentMethod, rail.paymentMethod),
            eq(rail.storeIdColumn, storeId),
            inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
        ))
        .returning({ id: subscriptions.id, userId: subscriptions.userId });

    for (const row of rows) {
        await subscriptionsService.invalidateStatusCache(row.userId);
    }
    return rows;
}
