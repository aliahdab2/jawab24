/**
 * Cross-rail vocabulary: which `subscriptions.payment_method` values mean "a
 * paying relationship lives on this row".
 *
 * ONE predicate for the three marketplace adopt-over guards (Shopify, Zid,
 * Salla). Each used to carry its own literal list — `['stripe', 'manual',
 * 'paypal', <the other two marketplaces>]` — and none of them knew
 * `bank_transfer`, `syrian_bank` or `sham_cash`: a Syrian merchant who paid a
 * year through Sham Cash and then installed the Salla app for catalogue sync
 * would have had that paid row rewritten in place to a 14-day Salla trial.
 * The offline set is imported, never re-listed, so a new offline method is
 * protected the day it exists (Rule 10.8; D-110 amended).
 */
import { OFFLINE_PAYMENT_METHODS } from '@jawab24/shared';

/** Processor-advanced rails. 'paypal' is a documented legacy value for the column. */
export const MANAGED_PAYMENT_METHODS = ['stripe', 'paypal', 'shopify', 'zid', 'salla'] as const;

const PAYING_METHODS: ReadonlySet<string> = new Set<string>([
    ...MANAGED_PAYMENT_METHODS,
    ...OFFLINE_PAYMENT_METHODS,
]);

/**
 * Would adopting `self` over a LIVE row on `paymentMethod` silently take over a
 * paying relationship on another rail (the D-H rule)?
 *
 * The caller supplies the liveness test (`LIVE_SUBSCRIPTION_STATUSES`); this
 * answers only the rail question. A null/unknown method (fresh trial) is not a
 * paying relationship. `self` is excluded so a rail may re-adopt its own row.
 */
export function collidesWithLiveRail(
    paymentMethod: string | null | undefined,
    self: (typeof MANAGED_PAYMENT_METHODS)[number],
): boolean {
    if (!paymentMethod || paymentMethod === self) return false;
    return PAYING_METHODS.has(paymentMethod);
}
