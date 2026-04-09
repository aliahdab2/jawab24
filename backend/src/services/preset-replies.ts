/**
 * Preset Replies — unified API over templates + rules tables.
 *
 * Design decisions:
 * - Merges the old separate Templates + Rules pages into one concept.
 *   Each "preset reply" is a template (the reply text) + a rule (keywords)
 *   created/updated/deleted atomically inside a DB transaction.
 *
 * Routing (handled in generator.ts, NOT here):
 * - Comments only — DMs always go to AI (Smart Reply).
 * - Short comments only (< 6 words, TEMPLATE_WORD_LIMIT in generator.ts).
 * - Skipped when page has a connected store (ecommerceStoreId) — AI answers
 *   with product catalog instead.
 *
 * Phase 2 (deferred): per-page targeting via page_ids on the rules table.
 */
import { db } from '../db';
import { templates, rules } from '../db/schema';
import { and, eq } from 'drizzle-orm';

export interface CreatePresetReplyDTO {
    keywords: string[];
    message: string;
}

export interface UpdatePresetReplyDTO {
    keywords?: string[];
    message?: string;
    active?: boolean;
}

const presetRepliesService = {

    async create(workspaceId: string, data: CreatePresetReplyDTO) {
        return db.transaction(async (tx) => {
            const name = data.keywords[0] ?? 'Preset Reply';
            const [template] = await tx.insert(templates)
                .values({ workspaceId, name, message: data.message, active: true })
                .returning();
            const [rule] = await tx.insert(rules)
                .values({ workspaceId, name, keywords: data.keywords, templateId: template.id, active: true, priority: 0 })
                .returning();
            return { ...rule, message: template.message };
        });
    },

    async getAll(workspaceId: string) {
        return db.select({
            id: rules.id,
            keywords: rules.keywords,
            message: templates.message,
            active: rules.active,
            templateId: rules.templateId,
            createdAt: rules.createdAt,
        })
        .from(rules)
        .leftJoin(templates, eq(rules.templateId, templates.id))
        .where(eq(rules.workspaceId, workspaceId));
    },

    async update(workspaceId: string, ruleId: string, data: UpdatePresetReplyDTO) {
        return db.transaction(async (tx) => {
            const [rule] = await tx.select().from(rules)
                .where(and(eq(rules.id, ruleId), eq(rules.workspaceId, workspaceId)))
                .limit(1);
            if (!rule) throw new Error('Not found');

            const name = data.keywords?.[0];
            await tx.update(rules).set({
                ...(data.keywords && { keywords: data.keywords, ...(name && { name }) }),
                ...(data.active !== undefined && { active: data.active }),
                updatedAt: new Date(),
            }).where(eq(rules.id, ruleId));

            if (data.message !== undefined && rule.templateId) {
                await tx.update(templates).set({
                    message: data.message,
                    ...(name && { name }),
                    updatedAt: new Date(),
                }).where(eq(templates.id, rule.templateId));
            }
        });
    },

    async delete(workspaceId: string, ruleId: string) {
        return db.transaction(async (tx) => {
            const [rule] = await tx.select().from(rules)
                .where(and(eq(rules.id, ruleId), eq(rules.workspaceId, workspaceId)))
                .limit(1);
            if (!rule) return;
            await tx.delete(rules).where(eq(rules.id, ruleId));
            if (rule.templateId) {
                await tx.delete(templates).where(eq(templates.id, rule.templateId));
            }
        });
    },
};

export default presetRepliesService;
