import { db } from '../db';
import { pages } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { CreatePageDTO, UpdatePageDTO, Logger, noopLogger } from '../types';
import { facebookService } from './facebook';
import { instagramService } from './instagram';

export class PagesService {
    private logger: Logger = noopLogger;
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
        return db
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
     * Sync pages from Facebook (and linked Instagram accounts)
     * @param userId - The user ID to sync pages for
     * @param userAccessToken - Facebook user access token
     * @param logger - Optional logger for tracking sync progress
     */
    async syncFromFacebook(userId: string, userAccessToken: string, logger: Logger = noopLogger) {
        logger.info(`[Pages] Starting sync for user ${userId}`);

        const fbPages = await facebookService.getUserPages(userAccessToken);
        const syncedPages = [];

        if (!fbPages.data || fbPages.data.length === 0) {
            logger.info('[Pages] No pages returned from Facebook API');
            return [];
        }

        logger.info(`[Pages] Processing ${fbPages.data.length} pages from Facebook`);

        for (const fbPage of fbPages.data) {
            logger.info(`[Pages] Processing page: ${fbPage.name} (${fbPage.id})`);

            // Try to fetch linked Instagram account
            let instagramAccountId: string | null = null;
            let instagramUsername: string | null = null;

            try {
                const igAccount = await instagramService.getLinkedInstagramAccount(
                    fbPage.id,
                    fbPage.access_token
                );
                if (igAccount) {
                    instagramAccountId = igAccount.id;
                    instagramUsername = igAccount.username;
                    logger.info(`[Pages] Found linked Instagram: @${instagramUsername}`);
                }
            } catch {
                logger.info(`[Pages] Could not fetch Instagram account (may not be linked)`);
            }

            // Check if page already exists
            const existingPage = await this.getPageByFacebookId(fbPage.id);

            if (existingPage) {
                // Update existing page
                logger.info(`[Pages] Updating existing page: ${fbPage.name}`);
                const updated = await db
                    .update(pages)
                    .set({
                        name: fbPage.name,
                        accessToken: fbPage.access_token,
                        instagramAccountId,
                        instagramUsername,
                        updatedAt: new Date(),
                    })
                    .where(eq(pages.id, existingPage.id))
                    .returning();
                syncedPages.push(updated[0]);
            } else {
                // Create new page
                logger.info(`[Pages] Creating new page: ${fbPage.name}`);
                const [created] = await db
                    .insert(pages)
                    .values({
                        userId,
                        facebookPageId: fbPage.id,
                        name: fbPage.name,
                        accessToken: fbPage.access_token,
                        autoReplyEnabled: true,
                        instagramAccountId,
                        instagramUsername,
                        instagramAutoReplyEnabled: false, // Default to OFF so user must explicitly enable it
                    })
                    .returning();
                syncedPages.push(created);
            }
        }

        logger.info(`[Pages] Sync complete. ${syncedPages.length} pages synced.`);
        return syncedPages;
    }

    /**
     * Toggle Instagram auto-reply for a page
     */
    async toggleInstagramAutoReply(userId: string, pageId: string, enabled: boolean) {
        const [updatedPage] = await db
            .update(pages)
            .set({
                instagramAutoReplyEnabled: enabled,
                updatedAt: new Date(),
            })
            .where(and(eq(pages.id, pageId), eq(pages.userId, userId)))
            .returning();

        return updatedPage;
    }

    /**
     * Get page by Instagram Account ID
     */
    async getPageByInstagramId(instagramAccountId: string) {
        const result = await db
            .select()
            .from(pages)
            .where(eq(pages.instagramAccountId, instagramAccountId));

        return result[0] || null;
    }
}

export const pagesService = new PagesService();

