import { db } from '../db';
import { pages } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { CreatePageDTO, UpdatePageDTO } from '../types';
import { facebookService } from './facebook';

export class PagesService {
    /**
     * Create a new page
     */
    async createPage(userId: string, data: CreatePageDTO) {
        const [newPage] = await db
            .insert(pages)
            .values({
                userId,
                facebookPageId: data.facebookPageId,
                name: data.name,
                accessToken: data.accessToken,
                autoReplyEnabled: data.autoReplyEnabled ?? true,
            })
            .returning();
        
        return newPage;
    }

    /**
     * Get all pages for a user
     */
    async getPages(userId: string) {
        return await db
            .select()
            .from(pages)
            .where(eq(pages.userId, userId))
            .orderBy(desc(pages.createdAt));
    }

    /**
     * Get a single page by ID
     */
    async getPage(userId: string, pageId: string) {
        const result = await db
            .select()
            .from(pages)
            .where(and(eq(pages.id, pageId), eq(pages.userId, userId)));
        
        return result[0] || null;
    }

    /**
     * Get page by Facebook Page ID
     */
    async getPageByFacebookId(facebookPageId: string) {
        const result = await db
            .select()
            .from(pages)
            .where(eq(pages.facebookPageId, facebookPageId));
        
        return result[0] || null;
    }

    /**
     * Update a page
     */
    async updatePage(userId: string, pageId: string, data: UpdatePageDTO) {
        const [updatedPage] = await db
            .update(pages)
            .set({
                ...data,
                updatedAt: new Date(),
            })
            .where(and(eq(pages.id, pageId), eq(pages.userId, userId)))
            .returning();
        
        return updatedPage;
    }

    /**
     * Delete a page
     */
    async deletePage(userId: string, pageId: string) {
        await db
            .delete(pages)
            .where(and(eq(pages.id, pageId), eq(pages.userId, userId)));
    }

    /**
     * Toggle auto-reply for a page
     */
    async toggleAutoReply(userId: string, pageId: string, enabled: boolean) {
        const [updatedPage] = await db
            .update(pages)
            .set({
                autoReplyEnabled: enabled,
                updatedAt: new Date(),
            })
            .where(and(eq(pages.id, pageId), eq(pages.userId, userId)))
            .returning();
        
        return updatedPage;
    }

    /**
     * Sync pages from Facebook
     */
    async syncFromFacebook(userId: string, userAccessToken: string) {
        console.log(`[Pages] Starting sync for user ${userId}`);
        
        const fbPages = await facebookService.getUserPages(userAccessToken);
        const syncedPages = [];

        if (!fbPages.data || fbPages.data.length === 0) {
            console.log('[Pages] No pages returned from Facebook API');
            console.log('[Pages] This could mean:');
            console.log('  - User is not an admin of any Facebook pages');
            console.log('  - pages_show_list permission not granted');
            console.log('  - Facebook App is in development mode and user is not a tester');
            return [];
        }

        console.log(`[Pages] Processing ${fbPages.data.length} pages from Facebook`);

        for (const fbPage of fbPages.data) {
            console.log(`[Pages] Processing page: ${fbPage.name} (${fbPage.id})`);
            
            // Check if page already exists
            const existingPage = await this.getPageByFacebookId(fbPage.id);
            
            if (existingPage) {
                // Update existing page
                console.log(`[Pages] Updating existing page: ${fbPage.name}`);
                const updated = await db
                    .update(pages)
                    .set({
                        name: fbPage.name,
                        accessToken: fbPage.access_token,
                        updatedAt: new Date(),
                    })
                    .where(eq(pages.id, existingPage.id))
                    .returning();
                syncedPages.push(updated[0]);
            } else {
                // Create new page
                console.log(`[Pages] Creating new page: ${fbPage.name}`);
                const created = await this.createPage(userId, {
                    facebookPageId: fbPage.id,
                    name: fbPage.name,
                    accessToken: fbPage.access_token,
                });
                syncedPages.push(created);
            }
        }

        console.log(`[Pages] Sync complete. ${syncedPages.length} pages synced.`);
        return syncedPages;
    }
}

export const pagesService = new PagesService();

