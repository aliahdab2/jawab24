import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db';
import { plans } from '../db/schema';
import type { Plan } from '@jawab24/shared';

/**
 * Plans Service - Manages pricing plans
 */
export const plansService = {
    /**
     * Get all active plans, sorted by sort order
     */
    async getActivePlans(): Promise<Plan[]> {
        const result = await db
            .select()
            .from(plans)
            .where(and(eq(plans.isActive, true), eq(plans.isPublic, true)))
            .orderBy(asc(plans.sortOrder));

        return result.map(this.mapToPlan);
    },

    /**
     * Get all plans (including inactive) - for admin
     */
    async getAllPlans(): Promise<Plan[]> {
        const result = await db
            .select()
            .from(plans)
            .orderBy(asc(plans.sortOrder));
        
        return result.map(this.mapToPlan);
    },

    /**
     * Get plan by ID
     */
    async getPlanById(planId: string): Promise<Plan | null> {
        const result = await db
            .select()
            .from(plans)
            .where(eq(plans.id, planId))
            .limit(1);
        
        return result[0] ? this.mapToPlan(result[0]) : null;
    },

    /**
     * Get plan by slug
     */
    async getPlanBySlug(slug: string): Promise<Plan | null> {
        const result = await db
            .select()
            .from(plans)
            .where(eq(plans.slug, slug))
            .limit(1);
        
        return result[0] ? this.mapToPlan(result[0]) : null;
    },

    /**
     * Get the default plan (for new users)
     */
    async getDefaultPlan(): Promise<Plan | null> {
        const result = await db
            .select()
            .from(plans)
            .where(and(eq(plans.isDefault, true), eq(plans.isActive, true)))
            .limit(1);
        
        // Fallback to 'free' slug if no default set
        if (!result[0]) {
            return this.getPlanBySlug('free');
        }
        
        return this.mapToPlan(result[0]);
    },

    /**
     * Create a new plan - Admin only
     */
    async createPlan(data: Partial<Plan>): Promise<Plan> {
        const result = await db
            .insert(plans)
            .values({
                name: data.name || 'New Plan',
                slug: data.slug || `plan-${Date.now()}`,
                description: data.description,
                price: data.price || 0,
                currency: data.currency || 'USD',
                interval: data.interval || 'month',
                maxPages: data.maxPages ?? 1,
                maxAiRepliesPerMonth: data.maxAiRepliesPerMonth ?? 50,
                maxProducts: data.maxProducts ?? 50,
                facebookEnabled: data.facebookEnabled ?? true,
                instagramEnabled: data.instagramEnabled ?? true,
                whatsappEnabled: data.whatsappEnabled ?? false,
                ecommerceEnabled: data.ecommerceEnabled ?? true,
                showBranding: data.showBranding ?? true,
                prioritySupport: data.prioritySupport ?? false,
                trialDays: data.trialDays ?? 0,
                regionalPricing: data.regionalPricing ?? {},
                isActive: data.isActive ?? true,
                isPublic: data.isPublic ?? true,
                isDefault: data.isDefault ?? false,
                sortOrder: data.sortOrder ?? 0,
            })
            .returning();
        
        return this.mapToPlan(result[0]);
    },

    /**
     * Update a plan - Admin only
     */
    async updatePlan(planId: string, data: Partial<Plan>): Promise<Plan | null> {
        const result = await db
            .update(plans)
            .set({
                ...(data.name !== undefined && { name: data.name }),
                ...(data.slug !== undefined && { slug: data.slug }),
                ...(data.description !== undefined && { description: data.description }),
                ...(data.price !== undefined && { price: data.price }),
                ...(data.currency !== undefined && { currency: data.currency }),
                ...(data.interval !== undefined && { interval: data.interval }),
                ...(data.maxPages !== undefined && { maxPages: data.maxPages }),
                ...(data.maxAiRepliesPerMonth !== undefined && { maxAiRepliesPerMonth: data.maxAiRepliesPerMonth }),
                ...(data.facebookEnabled !== undefined && { facebookEnabled: data.facebookEnabled }),
                ...(data.instagramEnabled !== undefined && { instagramEnabled: data.instagramEnabled }),
                ...(data.whatsappEnabled !== undefined && { whatsappEnabled: data.whatsappEnabled }),
                ...(data.ecommerceEnabled !== undefined && { ecommerceEnabled: data.ecommerceEnabled }),
                ...(data.showBranding !== undefined && { showBranding: data.showBranding }),
                ...(data.prioritySupport !== undefined && { prioritySupport: data.prioritySupport }),
                ...(data.trialDays !== undefined && { trialDays: data.trialDays }),
                ...(data.regionalPricing !== undefined && { regionalPricing: data.regionalPricing }),
                ...(data.isActive !== undefined && { isActive: data.isActive }),
                ...(data.isPublic !== undefined && { isPublic: data.isPublic }),
                ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
                ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
                updatedAt: new Date(),
            })
            .where(eq(plans.id, planId))
            .returning();
        
        return result[0] ? this.mapToPlan(result[0]) : null;
    },

    /**
     * Delete a plan - Admin only (soft delete by setting isActive to false)
     */
    async deletePlan(planId: string): Promise<boolean> {
        const result = await db
            .update(plans)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(plans.id, planId))
            .returning();
        
        return result.length > 0;
    },

    /**
     * Hard delete a plan - Admin only (use with caution)
     */
    async hardDeletePlan(planId: string): Promise<boolean> {
        const result = await db
            .delete(plans)
            .where(eq(plans.id, planId))
            .returning();
        
        return result.length > 0;
    },

    /**
     * Set a plan as the default
     */
    async setDefaultPlan(planId: string): Promise<boolean> {
        // First, unset all other defaults
        await db.update(plans).set({ isDefault: false });
        
        // Then set the new default
        const result = await db
            .update(plans)
            .set({ isDefault: true, updatedAt: new Date() })
            .where(eq(plans.id, planId))
            .returning();
        
        return result.length > 0;
    },

    /**
     * Get price for a specific region
     */
    getPriceForRegion(plan: Plan, regionCode: string): number {
        if (plan.regionalPricing && plan.regionalPricing[regionCode]) {
            return plan.regionalPricing[regionCode];
        }
        return plan.price;
    },

    /**
     * Map database result to Plan type
     */
    mapToPlan(row: typeof plans.$inferSelect): Plan {
        return {
            id: row.id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            price: row.price,
            yearlyPrice: row.yearlyPrice ?? null,
            yearlyAvailable: Boolean(row.stripeYearlyPriceId),
            currency: row.currency || 'USD',
            interval: (row.interval || 'month') as 'month' | 'year',
            maxPages: row.maxPages,
            maxAiRepliesPerMonth: row.maxAiRepliesPerMonth,
            maxProducts: row.maxProducts,
            facebookEnabled: row.facebookEnabled ?? true,
            instagramEnabled: row.instagramEnabled ?? true,
            whatsappEnabled: row.whatsappEnabled ?? false,
            ecommerceEnabled: row.ecommerceEnabled ?? false,
            showBranding: row.showBranding ?? true,
            prioritySupport: row.prioritySupport ?? false,
            trialDays: row.trialDays ?? 0,
            regionalPricing: (row.regionalPricing as Record<string, number>) ?? {},
            isActive: row.isActive ?? true,
            isPublic: row.isPublic ?? true,
            isDefault: row.isDefault ?? false,
            sortOrder: row.sortOrder ?? 0,
        };
    },
};

