import { db } from '../../db';
import { users, subscriptions, plans, adminAuditLogs } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { subscriptionsService } from '../subscriptions';
import { NotFoundError } from '../../utils/errors';
import type { ManualUpgradeBody } from '../../types/admin';

/**
 * Admin Subscriptions service — manual (non-Stripe) subscription upgrades.
 *
 * Behaviour-preserving move of the inline /upgrade handler. NOTE: this is NOT
 * wrapped in a DB transaction — that is intentionally out of scope for the
 * refactor (a separate behaviour-change PR).
 */

export interface ManualUpgradeResult {
    subscription: typeof subscriptions.$inferSelect;
    plan: { id: string; name: string; slug: string };
    periodEnd: string;
}

/** `db` or a transaction handle from `db.transaction(async (tx) => …)`. */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

class AdminSubscriptionsService {
    /**
     * Manually upgrade (or create) a user's subscription to a plan for N months.
     * Resets the usage period so the customer gets a fresh quota immediately,
     * and writes an admin audit log. Throws NotFoundError for unknown user/plan.
     */
    async manualUpgrade(
        userId: string,
        body: ManualUpgradeBody,
        adminUserId: string | undefined,
        // Pass a transaction to make the grant atomic with the caller's own
        // writes — the Sham Cash review flips a claim to `approved` and grants
        // in ONE transaction, so "approved but never activated" cannot exist.
        executor: DbExecutor = db,
    ): Promise<ManualUpgradeResult> {
        const { planId, periodMonths, paymentMethod, paymentReference, note } = body;

        // Verify user exists
        const [user] = await executor
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        if (!user) {
            throw new NotFoundError('User not found');
        }

        // Verify plan exists
        const [plan] = await executor
            .select({ id: plans.id, name: plans.name, slug: plans.slug })
            .from(plans)
            .where(eq(plans.id, planId))
            .limit(1);
        if (!plan) {
            throw new NotFoundError('Plan not found');
        }

        // Existing subscription for audit log
        const [existingSubscription] = await executor
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.userId, userId))
            .limit(1);

        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + periodMonths);

        let newSubscription;
        if (existingSubscription) {
            [newSubscription] = await executor
                .update(subscriptions)
                .set({
                    planId,
                    status: 'active',
                    paymentMethod,
                    currentPeriodStart: now,
                    currentPeriodEnd: periodEnd,
                    trialEndsAt: null, // Clear any trial
                    canceledAt: null,
                    cancelReason: null,
                    cancelAtPeriodEnd: false,
                    updatedAt: now,
                })
                .where(eq(subscriptions.id, existingSubscription.id))
                .returning();
        } else {
            [newSubscription] = await executor
                .insert(subscriptions)
                .values({
                    userId,
                    planId,
                    status: 'active',
                    paymentMethod,
                    currentPeriodStart: now,
                    currentPeriodEnd: periodEnd,
                })
                .returning();
        }

        // Reset quota for the new billing period so the customer immediately
        // gets their fresh allowance after renewal.
        await subscriptionsService.initializeUsagePeriod(userId, now, periodEnd, executor);

        // Audit log
        await executor.insert(adminAuditLogs).values({
            adminUserId,
            targetUserId: userId,
            action: 'manual_upgrade',
            previousValue: existingSubscription
                ? {
                    planId: existingSubscription.planId,
                    status: existingSubscription.status,
                    periodEnd: existingSubscription.currentPeriodEnd,
                    paymentMethod: existingSubscription.paymentMethod,
                }
                : null,
            newValue: {
                planId,
                planName: plan.name,
                status: 'active',
                periodMonths,
                periodEnd: periodEnd.toISOString(),
                paymentMethod,
            },
            paymentReference,
            note,
        });

        return { subscription: newSubscription, plan, periodEnd: periodEnd.toISOString() };
    }
}

export const adminSubscriptionsService = new AdminSubscriptionsService();
