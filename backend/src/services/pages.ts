import { db } from '../db';
import { pages, posts, comments, instagramComments, instagramMedia, messages } from '../db/schema';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { CreatePageDTO, UpdatePageDTO, Logger, noopLogger, FacebookPage, FacebookPageHours } from '../types';
import type { BusinessProfile } from '@jawab24/shared';
import { facebookService } from './facebook';
import { instagramService } from './instagram';
import { subscriptionsService } from './subscriptions';
import { captureError } from '../utils/sentryHelpers';
import { config } from '../config';
import { BusinessProfileSchema } from '../utils/validation';
import { redis } from '../lib/redis';
import { maybeEncryptToken, maybeDecryptToken } from './facebookCrypto';
import { KbIngestionService } from './kb/ingestion';
import { OpenAIEmbeddingProvider } from './kb/embedding';
import { PgVectorStore } from './kb/pgvector-store';

/** How long workspace stats stay cached in Redis (seconds). */
const STATS_CACHE_TTL = 300;
/** Minimum interval between cache invalidations per workspace (seconds). */
const STATS_INVALIDATION_THROTTLE = 30;


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

    // Validate and strip unexpected fields from Facebook data
    const validated = BusinessProfileSchema.safeParse(profile);
    if (!validated.success) {
        captureError(
            new Error('Invalid businessProfile from Facebook sync'),
            'BusinessProfile validation failed during Facebook sync',
            { extra: { fbPageId: fbPage.id, errors: validated.error.errors.map(e => `${e.path.join('.')}: ${e.message}`) } },
        );
        return profile; // Return unvalidated rather than losing data
    }

    return validated.data;
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
                accessToken: maybeEncryptToken(data.accessToken),
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
            .orderBy(desc(pages.createdAt))
            .limit(100);

        const emptyStats = { commentsCount: 0, repliesCount: 0, replyRate: 0, lastActivity: null as number | null };
        if (workspacePages.length === 0) return workspacePages.map(p => ({ ...p, accessToken: maybeDecryptToken(p.accessToken), ...emptyStats }));

        // Stats are best-effort — if the query fails, pages still load with zeroed stats
        // Three parallel queries (FB comments + IG comments + DMs) grouped by page_id
        // Cache stats in Redis to avoid repeated GROUP BY aggregations on every dashboard load
        const cacheKey = `stats:workspace:${workspaceId}`;
        const statsMap = new Map<string, { commentsCount: number; repliesCount: number; lastActivity: number | null }>();
        try {
            const cached = await redis.get(cacheKey).catch(() => null);
            if (cached) {
                const parsed = JSON.parse(cached) as Record<string, { commentsCount: number; repliesCount: number; lastActivity: number | null }>;
                for (const [pageId, stats] of Object.entries(parsed)) {
                    statsMap.set(pageId, stats);
                }
            } else {
                const [fbRows, igRows, msgRows] = await Promise.all([
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

                    // DM/Messenger conversations (messages table has direct pageId FK)
                    db.select({
                        pageId: pages.id,
                        commentsCount: count(),
                        repliesCount: sql<number>`count(*) FILTER (WHERE ${messages.replied} = true)`,
                        lastActivity: sql<number | null>`EXTRACT(EPOCH FROM MAX(${messages.repliedAt}))`,
                    })
                        .from(messages)
                        .innerJoin(pages, eq(messages.pageId, pages.id))
                        .where(and(eq(pages.workspaceId, workspaceId), eq(messages.direction, 'incoming')))
                        .groupBy(pages.id),
                ]);

                const mergeRows = (rows: typeof fbRows) => {
                    for (const row of rows) {
                        const existing = statsMap.get(row.pageId) ?? { commentsCount: 0, repliesCount: 0, lastActivity: null };
                        const rowActivity = row.lastActivity ? Math.round(Number(row.lastActivity) * 1000) : null;
                        statsMap.set(row.pageId, {
                            commentsCount: existing.commentsCount + Number(row.commentsCount),
                            repliesCount: existing.repliesCount + Number(row.repliesCount),
                            lastActivity: rowActivity
                                ? (existing.lastActivity ? Math.max(existing.lastActivity, rowActivity) : rowActivity)
                                : existing.lastActivity,
                        });
                    }
                };

                mergeRows(fbRows);
                mergeRows(igRows);
                mergeRows(msgRows);

                // Write to Redis cache (fire-and-forget, 60s TTL)
                const cacheObj: Record<string, { commentsCount: number; repliesCount: number; lastActivity: number | null }> = {};
                for (const [pageId, stats] of statsMap) cacheObj[pageId] = stats;
                redis.set(cacheKey, JSON.stringify(cacheObj), 'EX', STATS_CACHE_TTL).catch(() => {});
            }
        } catch (err) {
            captureError(err, 'Pages stats query failed', { level: 'warning', tags: { service: 'pages' } });
        }

        return workspacePages.map(page => {
            const stats = statsMap.get(page.id) || { commentsCount: 0, repliesCount: 0, lastActivity: null };
            return {
                ...page,
                accessToken: maybeDecryptToken(page.accessToken),
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

        const page = result[0] || null;
        if (page) page.accessToken = maybeDecryptToken(page.accessToken);
        return page;
    }

    /**
     * Get page by Facebook Page ID
     */
    async getPageByFacebookId(facebookPageId: string) {
        const result = await db
            .select()
            .from(pages)
            .where(eq(pages.facebookPageId, facebookPageId));

        const page = result[0] || null;
        if (page) page.accessToken = maybeDecryptToken(page.accessToken);
        return page;
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

        // Fire-and-forget: trigger full page ingestion (KB text + product chunks) when KB changes
        const kbText = data.knowledgeBase;
        const kbVersion = updatedPage?.kbVersion;
        if (kbText !== undefined && kbText.trim() && kbVersion) {
            const ingestion = getIngestionService();
            if (ingestion) {
                this.fetchProductsForPage(updatedPage.ecommerceStoreId)
                    .then(productData =>
                        ingestion.ingestFullPage(pageId, kbText, productData, kbVersion)
                    )
                    .catch(err => captureError(err, 'Full page ingestion failed during updatePage', { tags: { service: 'kb-ingestion', action: 'updatePage' }, extra: { pageId } }));
            }
        }

        return updatedPage;
    }

    /**
     * Fetch active products for a page's linked e-commerce store (if any).
     * Returns empty array if no store is linked or on error.
     */
    private async fetchProductsForPage(ecommerceStoreId: string | null | undefined): Promise<import('./kb/chunker').ProductData[]> {
        if (!ecommerceStoreId) return [];
        try {
            const { ecommerceProducts } = await import('../db/schema');
            const products = await db.select().from(ecommerceProducts)
                .where(and(
                    eq(ecommerceProducts.ecommerceStoreId, ecommerceStoreId),
                    eq(ecommerceProducts.status, 'active'),
                ));
            return products.map(p => ({
                platformProductId: p.platformProductId,
                title: p.title,
                description: p.description,
                productType: p.productType,
                vendor: p.vendor,
                status: p.status || 'active',
                priceRange: p.priceRange,
                currency: p.currency,
                totalInventory: p.totalInventory ?? 0,
                hasVariants: p.hasVariants ?? false,
                variantSummary: p.variantSummary,
                tags: p.tags,
            }));
        } catch {
            return [];
        }
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
                        accessToken: maybeEncryptToken(fbPage.access_token),
                        tokenLastVerifiedAt: new Date(),
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
                // Check if this page exists in another workspace (transferred admin access)
                const globalResults = await db
                    .select()
                    .from(pages)
                    .where(eq(pages.facebookPageId, fbPage.id));
                const globalExisting = globalResults[0];

                const shouldAutoEnable = remainingSlots === null || remainingSlots > 0;
                const businessProfile = buildBusinessProfile(fbPage);

                if (globalExisting && isPageDisconnected(globalExisting)) {
                    // Page exists but previous owner disconnected — safe to claim
                    logger.info(`[Pages] Claiming disconnected page "${fbPage.name}" (${fbPage.id}) from workspace ${globalExisting.workspaceId} to ${workspaceId}`);
                    const [claimed] = await db
                        .update(pages)
                        .set({
                            workspaceId,
                            userId,
                            name: fbPage.name,
                            accessToken: maybeEncryptToken(fbPage.access_token),
                            tokenLastVerifiedAt: new Date(),
                            autoReplyEnabled: shouldAutoEnable,
                            instagramAccountId,
                            instagramUsername,
                            instagramProfilePicUrl,
                            businessProfile,
                            businessProfileUpdatedAt: new Date(),
                            updatedAt: new Date(),
                        })
                        .where(eq(pages.id, globalExisting.id))
                        .returning();
                    syncedPages.push(claimed);

                    await facebookService.subscribePageToWebhooks(fbPage.id, fbPage.access_token);
                } else if (globalExisting) {
                    // Page is active under another user — skip to avoid stealing it
                    logger.info(`[Pages] Page "${fbPage.name}" (${fbPage.id}) is already connected in workspace ${globalExisting.workspaceId} — skipping`);
                    skippedCount++;
                    continue;
                } else {
                    // Brand new page — insert
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
                    const [created] = await db
                        .insert(pages)
                        .values({
                            workspaceId,
                            userId,
                            facebookPageId: fbPage.id,
                            name: fbPage.name,
                            accessToken: maybeEncryptToken(fbPage.access_token),
                            tokenLastVerifiedAt: new Date(),
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

                    // Subscribe new page to webhook events (even if disabled, so webhooks work when enabled later)
                    await facebookService.subscribePageToWebhooks(fbPage.id, fbPage.access_token);
                }

                if (shouldAutoEnable && remainingSlots !== null) {
                    remainingSlots--;
                }
                if (!shouldAutoEnable) {
                    skippedCount++;
                }
            }
        }

        // 5. Disable pages that the user revoked access to in Facebook
        // If a page exists in DB but was NOT returned by Facebook's /me/accounts,
        // the user deselected it in Facebook's permission dialog — disable it.
        const returnedFbPageIds = new Set(fbPages.data.map(p => p.id));
        const revokedPages = existingPages.filter(p => p.facebookPageId && !returnedFbPageIds.has(p.facebookPageId));

        for (const revokedPage of revokedPages) {
            logger.info(`[Pages] Page "${revokedPage.name}" (${revokedPage.facebookPageId}) was not returned by Facebook — disabling auto-reply`);
            await db
                .update(pages)
                .set({
                    autoReplyEnabled: false,
                    instagramAutoReplyEnabled: false,
                    accessToken: '',
                    tokenLastVerifiedAt: null,
                    updatedAt: new Date(),
                })
                .where(eq(pages.id, revokedPage.id));
        }

        if (revokedPages.length > 0) {
            logger.info(`[Pages] Disabled ${revokedPages.length} page(s) that user revoked access to in Facebook`);
        }

        logger.info(`[Pages] Sync complete. ${syncedPages.length} pages synced, ${skippedCount} created with auto-reply disabled (plan limit), ${revokedPages.length} disabled (access revoked).`);
        return { syncedPages, skippedCount, revokedCount: revokedPages.length };
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

        const page = result[0] || null;
        if (page) page.accessToken = maybeDecryptToken(page.accessToken);
        return page;
    }

    /**
     * Get page by WhatsApp Phone Number ID
     */
    async getPageByWhatsAppPhoneNumberId(phoneNumberId: string) {
        const result = await db
            .select()
            .from(pages)
            .where(eq(pages.whatsappPhoneNumberId, phoneNumberId));

        const page = result[0] || null;
        if (page) page.accessToken = maybeDecryptToken(page.accessToken);
        return page;
    }
}

export const pagesService = new PagesService();

/** Invalidate workspace stats cache so the next dashboard load fetches fresh data.
 *  Throttled: skips if the cache was already invalidated within the last 30 seconds
 *  to avoid defeating the cache under high message volume. */
export function invalidateWorkspaceStatsCache(workspaceId: string): void {
    const throttleKey = `stats:throttle:${workspaceId}`;
    // SET NX EX: only sets if key doesn't exist, auto-expires after the throttle window.
    // If the key already exists (recently invalidated), the DEL is skipped.
    redis.set(throttleKey, '1', 'EX', STATS_INVALIDATION_THROTTLE, 'NX').then((result) => {
        if (result === 'OK') {
            redis.del(`stats:workspace:${workspaceId}`).catch(() => {});
        }
    }).catch(() => {});
}

/** Check if a page's Facebook access has been revoked (empty accessToken sentinel) */
export function isPageDisconnected(page: { accessToken: string } | null | undefined): boolean {
    return !!page && page.accessToken === '';
}

