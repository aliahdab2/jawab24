import { db } from '../db';
import { templates, rules } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { CreateTemplateDTO, UpdateTemplateDTO } from '../types';

export class TemplatesService {
    /**
     * Create a new template
     */
    async createTemplate(workspaceId: string, data: CreateTemplateDTO) {
        const [newTemplate] = await db
            .insert(templates)
            .values({
                workspaceId,
                name: data.name,
                message: data.message,

                active: data.active ?? true,
            })
            .returning();
        
        return newTemplate;
    }

    /**
     * Get all templates for a user
     */
    async getTemplates(workspaceId: string) {
        return db
            .select()
            .from(templates)
            .where(eq(templates.workspaceId, workspaceId))
            .orderBy(desc(templates.createdAt));
    }

    /**
     * Get a single template by ID
     */
    async getTemplate(workspaceId: string, templateId: string) {
        const result = await db
            .select()
            .from(templates)
            .where(and(eq(templates.id, templateId), eq(templates.workspaceId, workspaceId)));
        
        return result[0] || null;
    }

    /**
     * Update a template
     */
    async updateTemplate(workspaceId: string, templateId: string, data: UpdateTemplateDTO) {
        const [updatedTemplate] = await db
            .update(templates)
            .set({
                ...data,
                updatedAt: new Date(),
            })
            .where(and(eq(templates.id, templateId), eq(templates.workspaceId, workspaceId)))
            .returning();
        
        return updatedTemplate;
    }

    /**
     * Delete a template
     */
    async deleteTemplate(workspaceId: string, templateId: string) {
        // Deactivate rules that reference this template before deleting
        await db
            .update(rules)
            .set({ active: false, updatedAt: new Date() })
            .where(and(eq(rules.templateId, templateId), eq(rules.workspaceId, workspaceId)));

        await db
            .delete(templates)
            .where(and(eq(templates.id, templateId), eq(templates.workspaceId, workspaceId)));
    }
}

export const templatesService = new TemplatesService();

