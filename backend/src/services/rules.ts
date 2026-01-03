import { db } from '../db';
import { rules, templates } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { CreateRuleDTO, UpdateRuleDTO } from '../types';

export class RulesService {
    /**
     * Create a new rule
     */
    async createRule(userId: string, data: CreateRuleDTO) {
        const [newRule] = await db
            .insert(rules)
            .values({
                userId,
                name: data.name,
                keywords: data.keywords,
                templateId: data.templateId,
                priority: data.priority || 0,
                active: data.active ?? true,
            })
            .returning();
        
        return newRule;
    }

    /**
     * Get all rules for a user
     */
    async getRules(userId: string) {
        return db
            .select({
                id: rules.id,
                name: rules.name,
                keywords: rules.keywords,
                priority: rules.priority,
                active: rules.active,
                templateId: rules.templateId,
                createdAt: rules.createdAt,
                updatedAt: rules.updatedAt,
                templateName: templates.name
            })
            .from(rules)
            .leftJoin(templates, eq(rules.templateId, templates.id))
            .where(eq(rules.userId, userId))
            .orderBy(desc(rules.priority), desc(rules.createdAt));
    }

    /**
     * Get a single rule by ID
     */
    async getRule(userId: string, ruleId: string) {
        const result = await db
            .select()
            .from(rules)
            .where(and(eq(rules.id, ruleId), eq(rules.userId, userId)));
        
        return result[0] || null;
    }

    /**
     * Update a rule
     */
    async updateRule(userId: string, ruleId: string, data: UpdateRuleDTO) {
        const [updatedRule] = await db
            .update(rules)
            .set({
                ...data,
                updatedAt: new Date(),
            })
            .where(and(eq(rules.id, ruleId), eq(rules.userId, userId)))
            .returning();
        
        return updatedRule;
    }

    /**
     * Delete a rule
     */
    async deleteRule(userId: string, ruleId: string) {
        await db
            .delete(rules)
            .where(and(eq(rules.id, ruleId), eq(rules.userId, userId)));
    }

    /**
     * Find matching rule for a comment
     */
    async findMatchingRule(userId: string, commentText: string) {
        // Get all active rules for the user, ordered by priority
        const userRules = await db
            .select()
            .from(rules)
            .where(and(eq(rules.userId, userId), eq(rules.active, true)))
            .orderBy(desc(rules.priority));

        const lowerComment = commentText.toLowerCase();

        // Simple keyword matching
        // In a real app, this might be more sophisticated (regex, fuzzy match, etc.)
        for (const rule of userRules) {
            if (rule.keywords && rule.keywords.length > 0) {
                const match = rule.keywords.some(keyword => 
                    lowerComment.includes(keyword.toLowerCase())
                );
                if (match) {
                    return rule;
                }
            }
        }

        return null;
    }
}

export const rulesService = new RulesService();

