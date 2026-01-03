import { db } from '../db';
import { templates } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { CreateTemplateDTO, UpdateTemplateDTO } from '../types';

export class TemplatesService {
    /**
     * Create a new template
     */
    async createTemplate(userId: string, data: CreateTemplateDTO) {
        const [newTemplate] = await db
            .insert(templates)
            .values({
                userId,
                name: data.name,
                translations: data.translations,
                keywords: data.keywords,
                active: data.active ?? true,
            })
            .returning();
        
        return newTemplate;
    }

    /**
     * Get all templates for a user
     */
    async getTemplates(userId: string) {
        return db
            .select()
            .from(templates)
            .where(eq(templates.userId, userId))
            .orderBy(desc(templates.createdAt));
    }

    /**
     * Get a single template by ID
     */
    async getTemplate(userId: string, templateId: string) {
        const result = await db
            .select()
            .from(templates)
            .where(and(eq(templates.id, templateId), eq(templates.userId, userId)));
        
        return result[0] || null;
    }

    /**
     * Update a template
     */
    async updateTemplate(userId: string, templateId: string, data: UpdateTemplateDTO) {
        const [updatedTemplate] = await db
            .update(templates)
            .set({
                ...data,
                updatedAt: new Date(),
            })
            .where(and(eq(templates.id, templateId), eq(templates.userId, userId)))
            .returning();
        
        return updatedTemplate;
    }

    /**
     * Delete a template
     */
    async deleteTemplate(userId: string, templateId: string) {
        await db
            .delete(templates)
            .where(and(eq(templates.id, templateId), eq(templates.userId, userId)));
    }
}

export const templatesService = new TemplatesService();

