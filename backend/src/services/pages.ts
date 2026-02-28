import { db } from '../db';
import { pages, posts, comments, instagramComments, instagramMedia } from '../db/schema';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { CreatePageDTO, UpdatePageDTO, Logger, noopLogger, FacebookPage, FacebookPageHours } from '../types';
import type { BusinessProfile } from '@jawab24/shared';
import { facebookService } from './facebook';
import { instagramService } from './instagram';
import { subscriptionsService } from './subscriptions';
import { captureError } from '../utils/sentryHelpers';
import { config } from '../config';
import { KbIngestionService } from './kb/ingestion';
import { OpenAIEmbeddingProvider } from './kb/embedding';
import { PgVectorStore } from './kb/pgvector-store';

/** Lazy-init ingestion service (only created when OPENAI_API_KEY exists) */
let _ingestionService: KbIngestionService | null = null;
export function getIngestionService(): KbIngestionService | null {
    if (!config.openai?.apiKey) return null;
    if (!_ingestionService) {
        const embeddingProvider = new OpenAIEmbeddingProvider(config.openai.apiKey);
        const vectorStore = new PgVectorStore();
        _ingestionService = new KbIngestionService(embeddingProvider, vectorStore);
    }
    return _ingestionService;
}

/**
 * Format Facebook hours object into readable text
 * Facebook returns hours like: { "mon_1_open": "09:00", "mon_1_close": "18:00", ... }
 */
function formatBusinessHours(hours: FacebookPageHours | undefined): string | null {
    if (!hours || Object.keys(hours).length === 0) return null;

    const dayNames: Record<string, string> = {
        mon: 'الإثنين',
        tue: 'الثلاثاء',
        wed: 'الأربعاء',
        thu: 'الخميس',
        fri: 'الجمعة',
        sat: 'السبت',
        sun: 'الأحد',
    };

    const dayHours: Record<string, { open: string; close: string }[]> = {};

    // Parse the hours object
    for (const [key, value] of Object.entries(hours)) {
        const match = key.match(/^(mon|tue|wed|thu|fri|sat|sun)_(\d+)_(open|close)$/);
        if (match) {
            const [, day, slot, type] = match;
            if (!dayHours[day]) dayHours[day] = [];
            if (!dayHours[day][parseInt(slot) - 1]) {
                dayHours[day][parseInt(slot) - 1] = { open: '', close: '' };
            }
            dayHours[day][parseInt(slot) - 1][type as 'open' | 'close'] = value;
        }
    }

    // Format into readable string
    const lines: string[] = [];
    for (const [day, slots] of Object.entries(dayHours)) {
        const dayName = dayNames[day] || day;
        const times = slots
            .filter(s => s.open && s.close)
            .map(s => `${s.open} - ${s.close}`)
            .join(', ');
        if (times) {
            lines.push(`${dayName}: ${times}`);
        }
    }

    return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Generate knowledge base text from Facebook page data
 */
function generateKnowledgeBase(fbPage: FacebookPage): string {
    const parts: string[] = [];

    if (fbPage.category) {
        parts.push(`🏷️ نوع النشاط: ${fbPage.category}`);
    }

    if (fbPage.about) {
        parts.push(fbPage.about);
    }

    if (fbPage.single_line_address) {
        parts.push(`📍 العنوان: ${fbPage.single_line_address}`);
    }

    if (fbPage.phone) {
        parts.push(`📞 الهاتف: ${fbPage.phone}`);
    }

    if (fbPage.website) {
        parts.push(`🌐 الموقع: ${fbPage.website}`);
    }

    const formattedHours = formatBusinessHours(fbPage.hours);
    if (formattedHours) {
        parts.push(`⏰ ساعات العمل:\n${formattedHours}`);
    }

    return parts.join('\n\n');
}

/**
 * Parse Facebook hours into structured format: { "mon": ["09:00-18:00"], ... }
 */
export function parseBusinessHours(hours: FacebookPageHours | undefined): Record<string, string[]> | undefined {
    if (!hours || Object.keys(hours).length === 0) return undefined;

    const daySlots: Record<string, { open: string; close: string }[]> = {};

    for (const [key, value] of Object.entries(hours)) {
        const match = key.match(/^(mon|tue|wed|thu|fri|sat|sun)_(\d+)_(open|close)$/);
        if (match) {
            const [, day, slot, type] = match;
            if (!daySlots[day]) daySlots[day] = [];
            if (!daySlots[day][parseInt(slot) - 1]) {
                daySlots[day][parseInt(slot) - 1] = { open: '', close: '' };
            }
            daySlots[day][parseInt(slot) - 1][type as 'open' | 'close'] = value;
        }
    }

    const result: Record<string, string[]> = {};
    for (const [day, slots] of Object.entries(daySlots)) {
        const ranges = slots
            .filter(s => s.open && s.close)
            .map(s => `${s.open}-${s.close}`);
        if (ranges.length > 0) {
            result[day] = ranges;
        }
    }

    return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Detect language hint from text — simple Arabic character ratio check
 */
export function detectLanguageHint(text: string): 'ar' | 'en' {
    const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
    return arabicChars / Math.max(text.length, 1) > 0.3 ? 'ar' : 'en';
}

/**
 * Build structured business profile from Facebook page data.
 * All fields are optional — partial profile is still valuable.
 */
export function buildBusinessProfile(fbPage: FacebookPage): BusinessProfile {
    const profile: BusinessProfile = {};

    if (fbPage.name) profile.name = fbPage.name;
    if (fbPage.category) profile.category = fbPage.category;
    if (fbPage.about) profile.about = fbPage.about;
    if (fbPage.phone) profile.phone = fbPage.phone;
    if (fbPage.website) profile.website = fbPage.website;
    if (fbPage.single_line_address) profile.address = fbPage.single_line_address;

    const hours = parseBusinessHours(fbPage.hours);
    if (hours) profile.hours = hours;

    // Detect language hint from name + about text
    const textForDetection = [fbPage.name, fbPage.about].filter(Boolean).join(' ');
    if (textForDetection) {
        profile.language_hint = detectLanguageHint(textForDetection);
    }

    return profile;
}

export class PagesService {
    private logger: Logger = noopLogger;
    /**
     * Create a new page
     */
    async createPage(workspaceId: string, userId: string, data: CreatePageDTO) {
        const [newPage] = await db
            .insert(pages)
            .values({
                workspaceId,
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
     * Get all pages for a user, with computed comment stats
     */
    async getPages(workspaceId: string) {
        const workspacePages = await db
            .select()
            .from(pages)
            .where(eq(pages.workspaceId, workspaceId))
            .orderBy(desc(pages.createdAt));

        const emptyStats = { commentsCount: 0, repliesCount: 0, replyRate: 0, lastActivity: null as number | null };
        if (workspacePages.length === 0) return workspacePages.map(p => ({ ...p, ...emptyStats }));

        // Stats are best-effort — if the query fails, pages still load with zeroed stats
        // Two parallel queries (FB + IG) grouped by page_id — same pattern as commentsService.getStats()
        const statsMap = new Map<string, { commentsCount: number; repliesCount: number; lastActivity: number | null }>();
        try {
            const [fbRows, igRows] = await Promise.all([
                db.select({
                    pageId: pages.id,
                    commentsCount: count(),
                    repliesCount: sql<number>`count(*) FILTER (WHERE ${comments.replied} = true)`,
                    lastActivity: sql<number | null>`EXTRACT(EPOCH FROM MAX(${comments.repliedAt}))`,
                })
                    .from(comments)
                    .innerJoin(posts, eq(comments.postId, posts.id))
                    .innerJoin(pages, eq(posts.pageId, pages.id))
                    .where(eq(pages.workspaceId, workspaceId))
                    .groupBy(pages.id),

                db.select({
                    pageId: pages.id,
                    commentsCount: count(),
                    repliesCount: sql<number>`count(*) FILTER (WHERE ${instagramComments.replied} = true)`,
                    lastActivity: sql<number | null>`EXTRACT(EPOCH FROM MAX(${instagramComments.repliedAt}))`,
                })
                    .from(instagramComments)
                    .innerJoin(instagramMedia, eq(instagramComments.mediaId, instagramMedia.id))
                    .innerJoin(pages, eq(instagramMedia.pageId, pages.id))
                    .where(eq(pages.workspaceId, workspaceId))
                    .groupBy(pages.id),
            ]);

            for (const row of fbRows) {
                const existing = statsMap.get(row.pageId) ?? { commentsCount: 0, repliesCount: 0, lastActivity: null };
                statsMap.set(row.pageId, {
                    commentsCount: existing.commentsCount + Number(row.commentsCount),
                    repliesCount: existing.repliesCount + Number(row.repliesCount),
                    lastActivity: row.lastActivity ? Math.round(Number(row.lastActivity) * 1000) : existing.lastActivity,
                });
            }
            for (const row of igRows) {
                const existing = statsMap.get(row.pageId) ?? { commentsCount: 0, repliesCount: 0, lastActivity: null };
                statsMap.set(row.pageId, {
                    commentsCount: existing.commentsCount + Number(row.commentsCount),
                    repliesCount: existing.repliesCount + Number(row.repliesCount),
                    lastActivity: row.lastActivity ? Math.round(Number(row.lastActivity) * 1000) : existing.lastActivity,
                });
            }
        } catch (err) {
            captureError(err, 'Pages stats query failed', { level: 'warning', tags: { service: 'pages' } });
        }

        return workspacePages.map(page => {
            const stats = statsMap.get(page.id) || { commentsCount: 0, repliesCount: 0, lastActivity: null };
            return {
                ...page,
                ...stats,
                replyRate: stats.commentsCount > 0
                    ? Math.round((stats.repliesCount / stats.commentsCount) * 100)
                    : 0,
            };
        });
    }

    /**
     * Get a single page by ID
     */
    async getPage(workspaceId: string, pageId: string) {
        const result = await db
            .select()
            .from(pages)
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)));

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
     * Update a page.
     * When knowledgeBase changes, bumps kbVersion and sets kbUpdatedAt.
     * kbActiveVersion is NOT touched here — it's set after ingestion completes.
     */
    async updatePage(workspaceId: string, pageId: string, data: UpdatePageDTO) {
        const setData: Record<string, unknown> = {
            ...data,
            updatedAt: new Date(),
        };

        // Bump KB version when knowledge base content changes
        if (data.knowledgeBase !== undefined) {
            setData.kbVersion = sql`COALESCE(${pages.kbVersion}, 0) + 1`;
            setData.kbUpdatedAt = new Date();
        }

        // Update businessProfileUpdatedAt when businessProfile changes
        if (data.businessProfile !== undefined) {
            setData.businessProfileUpdatedAt = new Date();
        }

        const [updatedPage] = await db
            .update(pages)
            .set(setData)
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .returning();

        // Fire-and-forget: trigger KB ingestion when knowledge base content changes
        if (data.knowledgeBase !== undefined && data.knowledgeBase.trim() && updatedPage?.kbVersion) {
            const ingestion = getIngestionService();
            if (ingestion) {
                ingestion.ingestKnowledgeBase(pageId, data.knowledgeBase, updatedPage.kbVersion)
                    .catch(err => captureError(err, 'KB ingestion failed during updatePage', { tags: { service: 'kb-ingestion', action: 'updatePage' }, extra: { pageId } }));
            }
        }

        return updatedPage;
    }

    /**
     * Delete a page
     */
    async deletePage(workspaceId: string, pageId: string) {
        await db
            .delete(pages)
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)));
    }

    /**
     * Toggle auto-reply for a page
     */
    async toggleAutoReply(workspaceId: string, pageId: string, enabled: boolean) {
        const [updatedPage] = await db
            .update(pages)
            .set({
                autoReplyEnabled: enabled,
                updatedAt: new Date(),
            })
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .returning();

        return updatedPage;
    }

    /**
     * Sync pages from Facebook (and linked Instagram accounts)
     * @param workspaceId - The workspace ID to sync pages for
     * @param userId - The user ID (billing owner)
     * @param userAccessToken - Facebook user access token
     * @param logger - Optional logger for tracking sync progress
     */
    async syncFromFacebook(workspaceId: string, userId: string, userAccessToken: string, logger: Logger = noopLogger) {
        logger.info(`[Pages] Starting sync for workspace ${workspaceId}`);

        const fbPages = await facebookService.getUserPages(userAccessToken);
        const syncedPages = [];

        if (!fbPages.data || fbPages.data.length === 0) {
            logger.info('[Pages] No pages returned from Facebook API');
            return { syncedPages: [], skippedCount: 0 };
        }

        logger.info(`[Pages] Processing ${fbPages.data.length} pages from Facebook`);

        // 1. Fetch all existing pages for this workspace upfront (optimizes DB reads)
        const existingPages = await this.getPages(workspaceId);
        const existingPagesMap = new Map(existingPages.map(p => [p.facebookPageId, p]));

        // 2. Process Facebook pages in parallel (optimizes external API calls)
        const processPromises = fbPages.data.map(async (fbPage) => {
            logger.info(`[Pages] Processing page: ${fbPage.name} (${fbPage.id})`);

            // Check linked Instagram account
            let instagramAccountId: string | null = null;
            let instagramUsername: string | null = null;
            let instagramProfilePicUrl: string | null = null;

            try {
                const igAccount = await instagramService.getLinkedInstagramAccount(
                    fbPage.id,
                    fbPage.access_token
                );
                if (igAccount) {
                    instagramAccountId = igAccount.id;
                    instagramUsername = igAccount.username;
                    instagramProfilePicUrl = igAccount.profile_picture_url || null;
                    logger.info(`[Pages] Found linked Instagram: @${instagramUsername}`);
                }
            } catch {
                logger.info(`[Pages] Could not fetch Instagram account (may not be linked)`);
            }

            return {
                fbPage,
                instagramAccountId,
                instagramUsername,
                instagramProfilePicUrl
            };
        });

        const results = await Promise.all(processPromises);

        // 3. Determine how many more pages can be auto-enabled
        const enableCheck = await subscriptionsService.canEnablePage(userId, workspaceId);
        let remainingSlots: number | null = null; // null = unlimited
        if (enableCheck.allowed && enableCheck.remaining !== undefined) {
            remainingSlots = enableCheck.remaining;
        } else if (!enableCheck.allowed) {
            remainingSlots = 0;
        }
        let skippedCount = 0;

        // 4. Perform DB Writes (Sequential to ensure consistency)
        // Best Practice: We write sequentially to avoid DB lock contention on the same user's rows
        // or potential race conditions if multiple syncs happen simultaneously.
        for (const result of results) {
            const { fbPage, instagramAccountId, instagramUsername, instagramProfilePicUrl } = result;
            const existingPage = existingPagesMap.get(fbPage.id);

            if (existingPage) {
                // Update existing page (always update tokens regardless of limit)
                logger.debug(`[Pages] Updating existing page: ${fbPage.name}`);
                const businessProfile = buildBusinessProfile(fbPage);
                const [updated] = await db
                    .update(pages)
                    .set({
                        name: fbPage.name,
                        accessToken: fbPage.access_token,
                        instagramAccountId,
                        instagramUsername,
                        instagramProfilePicUrl,
                        businessProfile,
                        businessProfileUpdatedAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .where(eq(pages.id, existingPage.id))
                    .returning();
                syncedPages.push(updated);

                // Subscribe page to webhook events (idempotent — safe to re-subscribe)
                await facebookService.subscribePageToWebhooks(fbPage.id, fbPage.access_token);
            } else {
                // Create new page - auto-enable only if within plan limit
                const shouldAutoEnable = remainingSlots === null || remainingSlots > 0;
                logger.debug(`[Pages] Creating new page: ${fbPage.name} (autoReply: ${shouldAutoEnable})`);
                const suggestedKnowledgeBase = generateKnowledgeBase(fbPage);
                if (suggestedKnowledgeBase) {
                    logger.info(`[Pages] Generated suggested knowledge base for ${fbPage.name}`, {
                        hasAbout: !!fbPage.about,
                        hasPhone: !!fbPage.phone,
                        hasAddress: !!fbPage.single_line_address,
                        hasHours: !!fbPage.hours,
                        hasWebsite: !!fbPage.website,
                    });
                }
                const businessProfile = buildBusinessProfile(fbPage);
                const [created] = await db
                    .insert(pages)
                    .values({
                        workspaceId,
                        userId,
                        facebookPageId: fbPage.id,
                        name: fbPage.name,
                        accessToken: fbPage.access_token,
                        autoReplyEnabled: shouldAutoEnable,
                        instagramAccountId,
                        instagramUsername,
                        instagramProfilePicUrl,
                        instagramAutoReplyEnabled: false,
                        knowledgeBase: suggestedKnowledgeBase || null,
                        suggestedKnowledgeBase: suggestedKnowledgeBase || null,
                        businessProfile,
                        businessProfileUpdatedAt: new Date(),
                    })
                    .returning();
                syncedPages.push(created);

                // Fire-and-forget: ingest KB for new page so RAG retrieval works immediately
                if (suggestedKnowledgeBase && created?.kbVersion) {
                    const ingestion = getIngestionService();
                    if (ingestion) {
                        ingestion.ingestKnowledgeBase(created.id, suggestedKnowledgeBase, created.kbVersion)
                            .catch(err => captureError(err, 'KB ingestion failed during syncPages', { tags: { service: 'kb-ingestion', action: 'syncPages' }, extra: { pageId: created.id } }));
                    }
                }

                if (shouldAutoEnable && remainingSlots !== null) {
                    remainingSlots--;
                }
                if (!shouldAutoEnable) {
                    skippedCount++;
                }

                // Subscribe new page to webhook events (even if disabled, so webhooks work when enabled later)
                await facebookService.subscribePageToWebhooks(fbPage.id, fbPage.access_token);
            }
        }

        logger.info(`[Pages] Sync complete. ${syncedPages.length} pages synced, ${skippedCount} created with auto-reply disabled (plan limit).`);
        return { syncedPages, skippedCount };
    }

    /**
     * Toggle Instagram auto-reply for a page
     */
    async toggleInstagramAutoReply(workspaceId: string, pageId: string, enabled: boolean) {
        const [updatedPage] = await db
            .update(pages)
            .set({
                instagramAutoReplyEnabled: enabled,
                updatedAt: new Date(),
            })
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
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

