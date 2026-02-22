import { db } from '../db';
import { rules, templates } from '../db/schema';
import { eq, and, asc, sql } from 'drizzle-orm';
import { CreateRuleDTO, UpdateRuleDTO } from '../types';
import { normalizeArabic } from '@jawab24/shared';

const ARABIC_RE = /[\u0600-\u06FF]/;

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match a keyword against text with proper boundary handling.
 * - English keywords: word-boundary regex (\b) to avoid "price" matching "surprise"
 * - Arabic keywords: substring matching (Arabic morphology expects partial stem matching)
 * Both sides are pre-normalized with normalizeArabic() before this is called.
 */
export function matchesKeyword(normalizedText: string, normalizedKeyword: string): boolean {
    if (!normalizedKeyword) return false;

    // Arabic keywords: use substring matching (stems naturally overlap)
    if (ARABIC_RE.test(normalizedKeyword)) {
        return normalizedText.includes(normalizedKeyword);
    }

    // English/Latin keywords: word-boundary matching
    const pattern = new RegExp(`\\b${escapeRegex(normalizedKeyword)}\\b`, 'i');
    return pattern.test(normalizedText);
}

export interface PaginationOptions {
    page?: number;
    limit?: number;
}

export interface PaginatedResult<T> {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

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
     * Get all rules for a user with pagination
     */
    async getRules(userId: string, options: PaginationOptions = {}): Promise<PaginatedResult<typeof rules.$inferSelect & { templateName: string | null }>> {
        const page = options.page || 1;
        const limit = options.limit || 20;
        const offset = (page - 1) * limit;

        // Get total count
        const [countResult] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(rules)
            .where(eq(rules.userId, userId));
        const total = countResult?.count || 0;

        // Get paginated results
        const data = await db
            .select({
                id: rules.id,
                userId: rules.userId,
                workspaceId: rules.workspaceId,
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
            .orderBy(asc(rules.priority), asc(rules.createdAt))
            .limit(limit)
            .offset(offset);

        return {
            data,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
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
        // Get active rules for the user, ordered by priority.
        // Capped at 100 to prevent unbounded fetches if limits aren't enforced at the app layer.
        const userRules = await db
            .select()
            .from(rules)
            .where(and(eq(rules.userId, userId), eq(rules.active, true)))
            .orderBy(asc(rules.priority))
            .limit(100);

        // Normalize once outside the loop
        const normalizedComment = normalizeArabic(commentText.toLowerCase());

        for (const rule of userRules) {
            if (rule.keywords && rule.keywords.length > 0) {
                const match = rule.keywords.some(keyword =>
                    matchesKeyword(normalizedComment, normalizeArabic(keyword.toLowerCase()))
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

