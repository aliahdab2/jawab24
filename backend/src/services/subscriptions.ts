import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { subscriptions, plans, usage, usageLogs, pages, templates, rules } from '../db/schema';
import { plansService } from './plans';
import type { Subscription, Plan, Usage, UsageSummary, SubscriptionStatus, LimitCheckResult } from '@jawab24/shared';

/**
 * Subscriptions Service - Manages user subscriptions and usage
 */
// Shared SQL for subscription priority: Active/Trialing > Past Due > Others
const SUBSCRIPTION_PRIORITY_SQL = sql`CASE WHEN ${subscriptions.status} IN ('active', 'trialing') THEN 1 WHEN ${subscriptions.status} = 'past_due' THEN 2 ELSE 3 END`;

/**
 * Subscriptions Service - Manages user subscriptions and usage
 */
export const subscriptionsService = {
    // Export for use in other files (like PaymentController)
    PRIORITY_SQL: SUBSCRIPTION_PRIORITY_SQL,
    /**
     * Get user's current subscription with plan details
     * Includes automatic expiration check - updates status if period has ended
     */
    async getUserSubscription(userId: string): Promise<(Subscription & { plan: Plan }) | null> {
        const result = await db
            .select({
                subscription: subscriptions,
                plan: plans,
            })
            .from(subscriptions)
            .innerJoin(plans, eq(subscriptions.planId, plans.id))
            .where(eq(subscriptions.userId, userId))
            .orderBy(
                SUBSCRIPTION_PRIORITY_SQL,
                desc(subscriptions.createdAt)
            )
            .limit(1);

        if (!result[0]) return null;

        const sub = result[0].subscription;
        const now = new Date();

        // Check for expired subscription and auto-update status
        let needsUpdate = false;
        let newStatus: SubscriptionStatus | null = null;

        // Check trial expiration
        if (sub.status === 'trialing' && sub.trialEndsAt) {
            const trialEnd = new Date(sub.trialEndsAt);
            if (trialEnd < now) {
                needsUpdate = true;
                newStatus = 'past_due';
            }
        }

        // Check period expiration for active subscriptions
        if (sub.status === 'active' && sub.currentPeriodEnd) {
            const periodEnd = new Date(sub.currentPeriodEnd);
            if (periodEnd < now) {
                needsUpdate = true;
                newStatus = 'past_due';
            }
        }

        // Auto-update status if expired
        if (needsUpdate && newStatus) {
            await db
                .update(subscriptions)
                .set({
                    status: newStatus,
                    updatedAt: now,
                })
                .where(eq(subscriptions.id, sub.id));

            // Return updated subscription
            return {
                ...this.mapToSubscription({
                    ...sub,
                    status: newStatus,
                    updatedAt: now,
                }),
                plan: plansService.mapToPlan(result[0].plan),
            };
        }

        return {
            ...this.mapToSubscription(sub),
            plan: plansService.mapToPlan(result[0].plan),
        };
    },

    /**
     * Create subscription for a new user
     */
    async createSubscription(userId: string, planId?: string): Promise<Subscription> {
        // Get the plan (or default plan)
        let plan: Plan | null;
        if (planId) {
            plan = await plansService.getPlanById(planId);
        } else {
            plan = await plansService.getDefaultPlan();
        }

        if (!plan) {
            throw new Error('No valid plan found');
        }

        // Calculate trial end date if applicable
        const now = new Date();
        const trialEndsAt = plan.trialDays > 0
            ? new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000)
            : null;

        // Calculate period end (1 month from now)
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        // Determine initial status
        const status: SubscriptionStatus = plan.trialDays > 0 ? 'trialing' : 'active';

        const result = await db
            .insert(subscriptions)
            .values({
                userId,
                planId: plan.id,
                status,
                trialEndsAt,
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
            })
            .returning();

        // Initialize usage tracking for this period
        await this.initializeUsagePeriod(userId, now, periodEnd);

        return this.mapToSubscription(result[0]);
    },

    /**
     * Change user's subscription plan
     */
    async changePlan(userId: string, newPlanId: string): Promise<Subscription | null> {
        const plan = await plansService.getPlanById(newPlanId);
        if (!plan) {
            throw new Error('Plan not found');
        }

        const result = await db
            .update(subscriptions)
            .set({
                planId: newPlanId,
                status: 'active',
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.userId, userId))
            .returning();

        return result[0] ? this.mapToSubscription(result[0]) : null;
    },

    /**
     * Cancel subscription
     */
    async cancelSubscription(userId: string, reason?: string): Promise<Subscription | null> {
        const result = await db
            .update(subscriptions)
            .set({
                status: 'canceled',
                canceledAt: new Date(),
                cancelReason: reason,
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.userId, userId))
            .returning();

        return result[0] ? this.mapToSubscription(result[0]) : null;
    },

    /**
     * Pause subscription
     */
    async pauseSubscription(userId: string): Promise<Subscription | null> {
        const result = await db
            .update(subscriptions)
            .set({
                status: 'paused',
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.userId, userId))
            .returning();

        return result[0] ? this.mapToSubscription(result[0]) : null;
    },

    /**
     * Resume subscription
     */
    async resumeSubscription(userId: string): Promise<Subscription | null> {
        const result = await db
            .update(subscriptions)
            .set({
                status: 'active',
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.userId, userId))
            .returning();

        return result[0] ? this.mapToSubscription(result[0]) : null;
    },

    /**
     * Initialize usage tracking for a billing period
     */
    async initializeUsagePeriod(userId: string, periodStart: Date, periodEnd: Date): Promise<void> {
        // Check if period already exists
        const existing = await db
            .select()
            .from(usage)
            .where(
                and(
                    eq(usage.userId, userId),
                    eq(usage.periodStart, periodStart)
                )
            )
            .limit(1);

        if (existing.length > 0) return;

        await db.insert(usage).values({
            userId,
            periodStart,
            periodEnd,
            aiRepliesCount: 0,
            templateRepliesCount: 0,
            totalCommentsProcessed: 0,
            totalMessagesProcessed: 0,
            dailyBreakdown: {},
        });
    },

    /**
     * Get current usage for user
     */
    async getCurrentUsage(userId: string): Promise<Usage | null> {
        const now = new Date();

        const result = await db
            .select()
            .from(usage)
            .where(
                and(
                    eq(usage.userId, userId),
                    lte(usage.periodStart, now),
                    gte(usage.periodEnd, now)
                )
            )
            .limit(1);

        return result[0] ? this.mapToUsage(result[0]) : null;
    },

    /**
     * Get full usage summary with limits and subscription info
     */
    async getUsageSummary(userId: string): Promise<UsageSummary | null> {
        const subscription = await this.getUserSubscription(userId);
        if (!subscription) return null;

        const currentUsage = await this.getCurrentUsage(userId);
        const plan = subscription.plan;

        // Count user's resources
        const [pagesCount] = await db
            .select({ count: pages.id })
            .from(pages)
            .where(eq(pages.userId, userId));

        const [templatesCount] = await db
            .select({ count: templates.id })
            .from(templates)
            .where(eq(templates.userId, userId));

        const [rulesCount] = await db
            .select({ count: rules.id })
            .from(rules)
            .where(eq(rules.userId, userId));

        // Calculate trial days remaining
        let trialDaysRemaining: number | undefined;
        if (subscription.status === 'trialing' && subscription.trialEndsAt) {
            const trialEnd = new Date(subscription.trialEndsAt);
            const now = new Date();
            trialDaysRemaining = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
        }

        const aiUsed = currentUsage?.aiRepliesCount || 0;
        const aiLimit = plan.maxAiRepliesPerMonth;

        return {
            currentPeriod: {
                start: currentUsage?.periodStart?.toString() || new Date().toISOString(),
                end: currentUsage?.periodEnd?.toString() || new Date().toISOString(),
            },
            aiReplies: {
                used: aiUsed,
                limit: aiLimit,
                remaining: aiLimit ? Math.max(0, aiLimit - aiUsed) : null,
                percentUsed: aiLimit ? Math.min(100, (aiUsed / aiLimit) * 100) : 0,
            },
            pages: {
                used: Number(pagesCount?.count) || 0,
                limit: plan.maxPages,
                remaining: plan.maxPages ? Math.max(0, plan.maxPages - (Number(pagesCount?.count) || 0)) : null,
            },
            templates: {
                used: Number(templatesCount?.count) || 0,
                limit: plan.maxTemplates,
                remaining: plan.maxTemplates ? Math.max(0, plan.maxTemplates - (Number(templatesCount?.count) || 0)) : null,
            },
            rules: {
                used: Number(rulesCount?.count) || 0,
                limit: plan.maxRules,
                remaining: plan.maxRules ? Math.max(0, plan.maxRules - (Number(rulesCount?.count) || 0)) : null,
            },
            subscription: {
                plan,
                status: subscription.status,
                trialDaysRemaining,
                renewsAt: subscription.currentPeriodEnd?.toString(),
            },
        };
    },

    /**
     * Increment AI reply usage
     */
    async incrementAiReplies(userId: string, count: number = 1): Promise<void> {
        const now = new Date();
        const _today = now.toISOString().split('T')[0];

        // Get current usage period
        const currentUsage = await this.getCurrentUsage(userId);

        if (!currentUsage) {
            // Create new usage period if doesn't exist
            const periodEnd = new Date(now);
            periodEnd.setMonth(periodEnd.getMonth() + 1);
            await this.initializeUsagePeriod(userId, now, periodEnd);
        }

        // Update usage count
        await db
            .update(usage)
            .set({
                aiRepliesCount: (currentUsage?.aiRepliesCount || 0) + count,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(usage.userId, userId),
                    lte(usage.periodStart, now),
                    gte(usage.periodEnd, now)
                )
            );

        // Log the usage event
        await this.logUsageEvent(userId, 'ai_reply', { count });
    },

    /**
     * Increment template reply usage
     */
    async incrementTemplateReplies(userId: string, count: number = 1): Promise<void> {
        const now = new Date();

        // Get current usage to increment properly
        const currentUsage = await this.getCurrentUsage(userId);

        await db
            .update(usage)
            .set({
                templateRepliesCount: (currentUsage?.templateRepliesCount || 0) + count,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(usage.userId, userId),
                    lte(usage.periodStart, now),
                    gte(usage.periodEnd, now)
                )
            );

        await this.logUsageEvent(userId, 'template_reply', { count });
    },

    /**
     * Check if user can use AI replies
     */
    async canUseAiReplies(userId: string): Promise<LimitCheckResult> {
        const subscription = await this.getUserSubscription(userId);

        if (!subscription) {
            return { allowed: false, reason: 'No active subscription' };
        }

        // Check subscription status
        if (subscription.status === 'canceled' || subscription.status === 'paused') {
            return { allowed: false, reason: `Subscription is ${subscription.status}` };
        }

        // Check past_due status with grace period (7 days)
        if (subscription.status === 'past_due') {
            const GRACE_PERIOD_DAYS = 7;
            const periodEnd = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
            
            if (periodEnd) {
                const gracePeriodEnd = new Date(periodEnd);
                gracePeriodEnd.setDate(gracePeriodEnd.getDate() + GRACE_PERIOD_DAYS);
                
                if (new Date() > gracePeriodEnd) {
                    return { 
                        allowed: false, 
                        reason: 'Subscription expired. Please renew to continue using AI replies.' 
                    };
                }
                // Within grace period - still allow but warn
            }
        }

        // Check trial expiration (already handled by getUserSubscription, but double-check)
        if (subscription.status === 'trialing' && subscription.trialEndsAt) {
            const trialEnd = new Date(subscription.trialEndsAt);
            if (trialEnd < new Date()) {
                return { allowed: false, reason: 'Trial has expired. Please upgrade to continue.' };
            }
        }

        const plan = subscription.plan;

        // Check if AI limit is unlimited (null)
        if (plan.maxAiRepliesPerMonth === null) {
            return { allowed: true };
        }

        // Check current usage
        const currentUsage = await this.getCurrentUsage(userId);
        const used = currentUsage?.aiRepliesCount || 0;
        const limit = plan.maxAiRepliesPerMonth;

        if (used >= limit) {
            return {
                allowed: false,
                reason: 'Monthly AI reply limit reached',
                limit,
                used,
                remaining: 0,
            };
        }

        return {
            allowed: true,
            limit,
            used,
            remaining: limit - used,
        };
    },

    /**
     * Check if user can add more pages
     */
    async canAddPage(userId: string): Promise<LimitCheckResult> {
        const subscription = await this.getUserSubscription(userId);

        if (!subscription) {
            return { allowed: false, reason: 'No active subscription' };
        }

        const plan = subscription.plan;

        // Check if pages limit is unlimited (null)
        if (plan.maxPages === null) {
            return { allowed: true };
        }

        // Count current pages
        const [result] = await db
            .select({ count: pages.id })
            .from(pages)
            .where(eq(pages.userId, userId));

        const used = Number(result?.count) || 0;
        const limit = plan.maxPages;

        if (used >= limit) {
            return {
                allowed: false,
                reason: 'Page limit reached. Upgrade to add more pages.',
                limit,
                used,
                remaining: 0,
            };
        }

        return {
            allowed: true,
            limit,
            used,
            remaining: limit - used,
        };
    },

    /**
     * Check if user can add more templates
     */
    async canAddTemplate(userId: string): Promise<LimitCheckResult> {
        const subscription = await this.getUserSubscription(userId);

        if (!subscription) {
            return { allowed: false, reason: 'No active subscription' };
        }

        const plan = subscription.plan;

        // Check if templates limit is unlimited (null)
        if (plan.maxTemplates === null) {
            return { allowed: true };
        }

        // Count current templates
        const [result] = await db
            .select({ count: templates.id })
            .from(templates)
            .where(eq(templates.userId, userId));

        const used = Number(result?.count) || 0;
        const limit = plan.maxTemplates;

        if (used >= limit) {
            return {
                allowed: false,
                reason: 'Template limit reached. Upgrade to create more templates.',
                limit,
                used,
                remaining: 0,
            };
        }

        return {
            allowed: true,
            limit,
            used,
            remaining: limit - used,
        };
    },

    /**
     * Check if user can add more rules
     */
    async canAddRule(userId: string): Promise<LimitCheckResult> {
        const subscription = await this.getUserSubscription(userId);

        if (!subscription) {
            return { allowed: false, reason: 'No active subscription' };
        }

        const plan = subscription.plan;

        // Check if rules limit is unlimited (null)
        if (plan.maxRules === null) {
            return { allowed: true };
        }

        // Count current rules
        const [result] = await db
            .select({ count: rules.id })
            .from(rules)
            .where(eq(rules.userId, userId));

        const used = Number(result?.count) || 0;
        const limit = plan.maxRules;

        if (used >= limit) {
            return {
                allowed: false,
                reason: 'Rule limit reached. Upgrade to create more rules.',
                limit,
                used,
                remaining: 0,
            };
        }

        return {
            allowed: true,
            limit,
            used,
            remaining: limit - used,
        };
    },

    /**
     * Log a usage event
     */
    async logUsageEvent(
        userId: string,
        eventType: string,
        metadata?: Record<string, unknown>,
        pageId?: string,
        platform?: string
    ): Promise<void> {
        await db.insert(usageLogs).values({
            userId,
            eventType,
            pageId,
            platform,
            metadata: metadata || {},
        });
    },

    /**
     * Map database result to Subscription type
     */
    mapToSubscription(row: typeof subscriptions.$inferSelect): Subscription {
        return {
            id: row.id,
            userId: row.userId,
            planId: row.planId,
            status: (row.status || 'active') as SubscriptionStatus,
            trialEndsAt: row.trialEndsAt,
            currentPeriodStart: row.currentPeriodStart || new Date(),
            currentPeriodEnd: row.currentPeriodEnd,
            canceledAt: row.canceledAt,
            cancelReason: row.cancelReason,
            createdAt: row.createdAt || new Date(),
        };
    },

    /**
     * Map database result to Usage type
     */
    mapToUsage(row: typeof usage.$inferSelect): Usage {
        return {
            id: row.id,
            userId: row.userId,
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            aiRepliesCount: row.aiRepliesCount || 0,
            templateRepliesCount: row.templateRepliesCount || 0,
            totalCommentsProcessed: row.totalCommentsProcessed || 0,
            totalMessagesProcessed: row.totalMessagesProcessed || 0,
            dailyBreakdown: (row.dailyBreakdown as Record<string, { ai: number; template: number }>) || {},
        };
    },
};

