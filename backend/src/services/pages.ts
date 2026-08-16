import { db } from '../db';
import { pages, posts, comments, instagramComments, instagramMedia, messages, workspaceMembers, workspaces as workspacesTable, catalogItems, ecommerceStores, postSuggestions } from '../db/schema';
import { eq, and, or, ne, desc, sql, count, isNotNull, isNull, inArray } from 'drizzle-orm';
import { CreatePageDTO, UpdatePageDTO, UpdateLeadConfigDTO, Logger, noopLogger, FacebookPage, FacebookPageHours } from '../types';
import { unwrapBusinessProfile, applyFbSyncToMerchant, applyMerchantEdit, applyKbExtractToMerchant, TRACKED_FIELDS, SHORT_DAY_KEYS, DAY_LABELS_AR, type BusinessProfile, type BusinessProfileContainer, type StoredBusinessProfile } from '@jawab24/shared';
import { operationalFactsExtractor } from './kb/operationalFactsExtractor';
import { storeAnswersPolicies } from './ecommerce';
import { facebookService } from './facebook';
import { instagramService } from './instagram';
import { pageLinkedInstagramCredential } from './instagramCredential';
import { imageStorage } from './imageStorage';
import { imageKeysOf } from '../lib/postSuggestionVariants';
import { subscriptionsService } from './subscriptions';
import { channelTrialService } from './channelTrial';
import { logAutoReplyToggle, auditLog } from './auditLog';
import { captureError } from '../utils/sentryHelpers';
import { config } from '../config';
import { BusinessProfileSchema } from '../utils/validation';
import { redis } from '../lib/redis';
import { STATS_CACHE_TTL, pagesStatsCacheKey } from './statsCache';
// Re-exported for the reply pipeline (commentProcessor/messageProcessor/nonTextHandler),
// which import it from here. Real implementation lives in statsCache.ts alongside the
// other stats-cache invalidation helpers.
export { invalidateWorkspaceStatsCache } from './statsCache';
import { maybeEncryptToken, safeDecryptToken } from './facebookCrypto';
import { isUniqueViolation } from '../utils/dbErrors';
import { clearReconnectAlertClaims } from './pageTokenRecovery';
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
export function formatBusinessHours(hours: FacebookPageHours | undefined): string | null {
    if (!hours || Object.keys(hours).length === 0) return null;

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

    // Format into readable string, Saturday-first (CLDR week order for our
    // markets — see SHORT_DAY_KEYS in @jawab24/shared), not FB insertion order.
    const lines: string[] = [];
    for (const day of SHORT_DAY_KEYS) {
        const slots = dayHours[day];
        if (!slots) continue;
        const dayName = DAY_LABELS_AR[day] || day;
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
 * Build the FB-sourced half of a BusinessProfile from a FacebookPage.
 *
 * Stage 2.6: this only ever produces the `suggestions` half of the
 * container. The merchant-confirmed half (`merchant`) is editor-write-only
 * and is never touched by FB sync. Use {@link buildBusinessProfileContainer}
 * to produce the JSONB shape that gets written to `pages.business_profile`,
 * preserving any existing merchant edits.
 *
 * All fields are optional — a partial suggestion is still useful in the
 * editor's "Import from Facebook" affordance.
 */
export function buildBusinessProfile(fbPage: FacebookPage): BusinessProfile {
    const profile: BusinessProfile = {};

    if (fbPage.name) profile.name = fbPage.name;
    if (fbPage.category) profile.category = fbPage.category;
    if (fbPage.about) profile.about = fbPage.about;
    if (fbPage.phone) profile.phones = [fbPage.phone];
    if (fbPage.website) profile.website = fbPage.website;
    if (fbPage.single_line_address) profile.address = fbPage.single_line_address;

    const hours = parseBusinessHours(fbPage.hours);
    if (hours) profile.hours = hours;

    const textForDetection = [fbPage.name, fbPage.about].filter(Boolean).join(' ');
    if (textForDetection) {
        profile.language_hint = detectLanguageHint(textForDetection);
    }

    const validated = BusinessProfileSchema.safeParse(profile);
    if (!validated.success) {
        captureError(
            new Error('Invalid businessProfile from Facebook sync'),
            'BusinessProfile validation failed during Facebook sync',
            { extra: { fbPageId: fbPage.id, errors: validated.error.errors.map(e => `${e.path.join('.')}: ${e.message}`) } },
        );
        return profile;
    }

    return validated.data;
}

/**
 * Produce the full Stage 2.6.1 container value for `pages.business_profile`.
 *
 * Refreshes the `suggestions` half (raw FB snapshot) on every sync, and
 * auto-promotes FB-suggested fields into the `merchant` half — the half
 * the AI prompt actually reads — with per-field provenance tracking.
 * This is Option B: the gate stays one-sided in spirit (editor edits are
 * still authoritative), but the prompt is populated from day one instead
 * of waiting for the merchant to manually click "Import from Facebook".
 *
 * Behavior:
 *   - Editor-owned fields (provenance.source === 'editor', set OR cleared)
 *     are preserved untouched. Future syncs cannot regress merchant edits
 *     or resurrect a field the merchant explicitly cleared.
 *   - Never-seen and fb_sync-owned fields get populated/refreshed from FB
 *     with provenance.source = 'fb_sync', confirmedAt: null.
 *   - Defensive: a pre-migration row with `merchant` populated but no
 *     provenance map is treated as editor-owned (only the editor could
 *     have written those values before Option B, since the gate blocked
 *     FB suggestions from reaching merchant).
 *
 * Handles three shapes for `existing`:
 *   - null/undefined        → fresh promotion, every field fb_sync/null
 *   - legacy flat shape     → unwrap demotes to suggestions; merchant is
 *                             treated as never-seen, FB promotes into it
 *   - already-container     → per-field merge per the rules above
 */
export function buildBusinessProfileContainer(
    fbPage: FacebookPage,
    existing?: StoredBusinessProfile,
): BusinessProfileContainer {
    const suggestions = buildBusinessProfile(fbPage);
    const existingContainer = unwrapBusinessProfile(existing);
    const { merchant, merchantProvenance } = applyFbSyncToMerchant(
        existingContainer.merchant,
        existingContainer.merchantProvenance,
        suggestions,
    );
    return { merchant, suggestions, merchantProvenance };
}

/**
 * Conflict info surfaced when a page-sync attempt finds pages already attached to
 * another workspace AND the current user is a member of that workspace. The client
 * uses this to render an actionable "Switch to ‹workspaceName›" affordance instead
 * of the misleading "ask the owner to invite you" warning.
 */
export interface AlreadyMemberOfEntry {
    workspaceId: string;
    workspaceName: string;
    role: string; // owner | admin | member
    pageName: string;
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
     * Connect an Instagram professional account DIRECTLY (Instagram Login, no
     * Facebook Page). The row is an Instagram-only channel: facebookPageId is
     * null and accessToken is '' (there is no Facebook credential to hold);
     * instagram_access_token — encrypted — is the working credential and the
     * IG-direct discriminator for the send path.
     *
     * Cross-tenant claim is refused, mirroring the Facebook page-taken rule:
     * whoever completes Instagram's OAuth *is* the account holder, but a
     * workspace switch must be an explicit support action, never a silent
     * side effect of reconnecting.
     */
    async connectInstagramDirect(
        workspaceId: string,
        userId: string,
        profile: { userId: string; username: string; name: string | null; profilePictureUrl: string | null },
        token: { accessToken: string; expiresAt: Date },
    ): Promise<{ taken: boolean; alreadyLinked?: boolean; page?: typeof pages.$inferSelect }> {
        const [existing] = await db
            .select()
            .from(pages)
            .where(eq(pages.instagramAccountId, profile.userId))
            .limit(1);

        if (existing && existing.workspaceId !== workspaceId) {
            return { taken: true };
        }

        // This Instagram account already arrives through a connected Facebook
        // Page. Writing the Instagram User token onto that row would produce a
        // hybrid the send path deliberately refuses to use
        // (`resolveInstagramCredential`) — a column written and never read — and
        // the merchant's real answer is "it is already connected", not a second
        // connection. Say so instead of mutating a working page.
        if (existing?.facebookPageId) {
            return { taken: false, alreadyLinked: true, page: existing };
        }

        if (existing) {
            // Reconnect: refresh credential + profile fields on the same row.
            const [updated] = await db
                .update(pages)
                .set({
                    instagramAccessToken: maybeEncryptToken(token.accessToken),
                    instagramTokenExpiresAt: token.expiresAt,
                    instagramUsername: profile.username,
                    instagramProfilePicUrl: profile.profilePictureUrl,
                    updatedAt: new Date(),
                })
                .where(eq(pages.id, existing.id))
                .returning();
            return { taken: false, page: updated };
        }

        try {
            const [created] = await db
                .insert(pages)
                .values({
                    workspaceId,
                    userId,
                    facebookPageId: null,
                    name: profile.name || `@${profile.username}`,
                    accessToken: '',
                    // The Facebook channel toggle is meaningless without a page; off
                    // keeps the card's state honest. Instagram replies stay opt-in
                    // like every linked-IG page (D-026 comments-opt-in-forever).
                    autoReplyEnabled: false,
                    instagramAccountId: profile.userId,
                    instagramUsername: profile.username,
                    instagramProfilePicUrl: profile.profilePictureUrl,
                    instagramAutoReplyEnabled: false,
                    instagramAccessToken: maybeEncryptToken(token.accessToken),
                    instagramTokenExpiresAt: token.expiresAt,
                })
                .returning();
            return { taken: false, page: created };
        } catch (error) {
            // The select-then-insert race: two OAuth completions for the same IG
            // account can both pass the `existing` read above. The unique index on
            // instagram_account_id makes the second INSERT fail here instead of
            // silently creating a twin row that would split webhook routing — and
            // the loser of the race gets the same honest answer as a sequential
            // second connect (PR #772 review M2).
            if (isUniqueViolation(error)) return { taken: true };
            throw error;
        }
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

        type ReplyBreakdown = { ai: number; template: number; postReply: number };
        type PageStats = {
            commentsCount: number;
            repliesCount: number;
            breakdown: ReplyBreakdown;
            lastActivity: number | null;
        };
        const emptyBreakdown: ReplyBreakdown = { ai: 0, template: 0, postReply: 0 };
        const emptyStats: PageStats & { replyRate: number } = {
            commentsCount: 0, repliesCount: 0, breakdown: emptyBreakdown, replyRate: 0, lastActivity: null,
        };
        if (workspacePages.length === 0) return workspacePages.map(p => ({ ...p, accessToken: safeDecryptToken(p.accessToken, { entity: 'page', id: p.id }), whatsappAccessToken: safeDecryptToken(p.whatsappAccessToken, { entity: 'page', id: p.id }) || null, ...emptyStats }));

        // Stats are best-effort — if the query fails, pages still load with zeroed stats
        // Three parallel queries (FB comments + IG comments + DMs) grouped by page_id
        // Cache stats in Redis to avoid repeated GROUP BY aggregations on every dashboard load
        //
        // `repliesCount` and `breakdown` cover auto-replies only
        // (ai + template + post_reply) — the metric measures platform
        // automation, not merchant-driven manual handling.
        const cacheKey = pagesStatsCacheKey(workspaceId);
        const statsMap = new Map<string, PageStats>();
        const countByMethod = (table: typeof comments | typeof instagramComments | typeof messages, method: string) =>
            sql<number>`count(*) FILTER (WHERE ${table.replied} = true AND ${table.replyMethod} = ${method})`;
        try {
            const cached = await redis.get(cacheKey).catch(() => null);
            if (cached) {
                const parsed = JSON.parse(cached) as Record<string, PageStats>;
                for (const [pageId, stats] of Object.entries(parsed)) {
                    statsMap.set(pageId, stats);
                }
            } else {
                const [fbRows, igRows, msgRows] = await Promise.all([
                    db.select({
                        pageId: pages.id,
                        commentsCount: count(),
                        aiCount: countByMethod(comments, 'ai'),
                        templateCount: countByMethod(comments, 'template'),
                        postReplyCount: countByMethod(comments, 'post_reply'),
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
                        aiCount: countByMethod(instagramComments, 'ai'),
                        templateCount: countByMethod(instagramComments, 'template'),
                        postReplyCount: countByMethod(instagramComments, 'post_reply'),
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
                        aiCount: countByMethod(messages, 'ai'),
                        templateCount: countByMethod(messages, 'template'),
                        postReplyCount: countByMethod(messages, 'post_reply'),
                        lastActivity: sql<number | null>`EXTRACT(EPOCH FROM MAX(${messages.repliedAt}))`,
                    })
                        .from(messages)
                        .innerJoin(pages, eq(messages.pageId, pages.id))
                        .where(and(eq(pages.workspaceId, workspaceId), eq(messages.direction, 'incoming')))
                        .groupBy(pages.id),
                ]);

                const mergeRows = (rows: typeof fbRows) => {
                    for (const row of rows) {
                        const existing = statsMap.get(row.pageId) ?? {
                            commentsCount: 0, repliesCount: 0, breakdown: { ...emptyBreakdown }, lastActivity: null,
                        };
                        const ai = Number(row.aiCount);
                        const template = Number(row.templateCount);
                        const postReply = Number(row.postReplyCount);
                        const rowActivity = row.lastActivity ? Math.round(Number(row.lastActivity) * 1000) : null;
                        statsMap.set(row.pageId, {
                            commentsCount: existing.commentsCount + Number(row.commentsCount),
                            repliesCount: existing.repliesCount + ai + template + postReply,
                            breakdown: {
                                ai: existing.breakdown.ai + ai,
                                template: existing.breakdown.template + template,
                                postReply: existing.breakdown.postReply + postReply,
                            },
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
                const cacheObj: Record<string, PageStats> = {};
                for (const [pageId, stats] of statsMap) cacheObj[pageId] = stats;
                redis.set(cacheKey, JSON.stringify(cacheObj), 'EX', STATS_CACHE_TTL).catch(() => {});
            }
        } catch (err) {
            captureError(err, 'Pages stats query failed', { level: 'warning', tags: { service: 'pages' } });
        }

        // Three per-page enrichments, all fresh (kept OUT of the 60s stats cache),
        // all best-effort (a failure zeroes its own result and never sinks the
        // page list), and independent — so they run CONCURRENTLY: getPages is the
        // dashboard's hot path, and serial awaits here were pure added latency.
        const triggerPageIds = new Set<string>();
        const catalogCountByPage = new Map<string, number>();
        const storesAnsweringPolicies = new Set<string>();
        await Promise.all([
            // Which pages have at least one Post Reply configured (either mode →
            // trigger_reply set). Fresh so the dashboard "try Post Reply" nudge
            // disappears immediately once a merchant sets their first trigger.
            // Cheap (two indexed existence scans).
            (async () => {
                try {
                    const [fbTrig, igTrig] = await Promise.all([
                        db.selectDistinct({ pageId: posts.pageId })
                            .from(posts)
                            .innerJoin(pages, eq(posts.pageId, pages.id))
                            .where(and(eq(pages.workspaceId, workspaceId), isNotNull(posts.triggerReply))),
                        db.selectDistinct({ pageId: instagramMedia.pageId })
                            .from(instagramMedia)
                            .innerJoin(pages, eq(instagramMedia.pageId, pages.id))
                            .where(and(eq(pages.workspaceId, workspaceId), isNotNull(instagramMedia.triggerReply))),
                    ]);
                    for (const r of fbTrig) if (r.pageId) triggerPageIds.add(r.pageId);
                    for (const r of igTrig) if (r.pageId) triggerPageIds.add(r.pageId);
                } catch (err) {
                    captureError(err, 'Pages Post Reply trigger query failed', { level: 'warning', tags: { service: 'pages' } });
                }
            })(),

            // Native-catalog item counts per page. A page with items counts as
            // having an answer source (needsBusinessInfo / setup checklist) even
            // with an empty free-text KB. Fresh so the KB nudge clears the moment
            // a merchant adds their first item.
            (async () => {
                try {
                    const rows = await db.select({ pageId: catalogItems.pageId, value: count() })
                        .from(catalogItems)
                        .innerJoin(pages, eq(catalogItems.pageId, pages.id))
                        .where(eq(pages.workspaceId, workspaceId))
                        .groupBy(catalogItems.pageId);
                    for (const r of rows) catalogCountByPage.set(r.pageId, Number(r.value));
                } catch (err) {
                    captureError(err, 'Pages catalog count query failed', { level: 'warning', tags: { service: 'pages' } });
                }
            })(),

            // Which linked stores ACTUALLY answer policy questions in replies —
            // decided by `storeAnswersPolicies` (ecommerce.ts), the same predicate
            // `getStoreContextForAI` derives the prompt from, so what /business
            // claims and what the model receives can never disagree. The flag
            // exists because `pages.ecommerce_store_id` alone is NOT proof:
            // `deactivateStore` (platform-side uninstall) keeps the link for
            // reconnect, and a live store can sync with no policy text.
            //
            // Fails in the SAFE direction: an error leaves the set empty, so the
            // row shows as a gap to fill rather than claiming an answer that
            // isn't there.
            (async () => {
                const linkedStoreIds = [...new Set(
                    workspacePages.map(p => p.ecommerceStoreId).filter((id): id is string => !!id),
                )];
                if (linkedStoreIds.length === 0) return;
                try {
                    const rows = await db.select({
                        id: ecommerceStores.id,
                        isActive: ecommerceStores.isActive,
                        policiesSummary: ecommerceStores.policiesSummary,
                    })
                        .from(ecommerceStores)
                        .where(inArray(ecommerceStores.id, linkedStoreIds));
                    for (const r of rows) if (storeAnswersPolicies(r)) storesAnsweringPolicies.add(r.id);
                } catch (err) {
                    captureError(err, 'Pages store-policy query failed', { level: 'warning', tags: { service: 'pages' } });
                }
            })(),
        ]);

        return workspacePages.map(page => {
            const stats = statsMap.get(page.id) ?? {
                commentsCount: 0, repliesCount: 0, breakdown: { ...emptyBreakdown }, lastActivity: null,
            };
            return {
                ...page,
                accessToken: safeDecryptToken(page.accessToken, { entity: 'page', id: page.id }),
                whatsappAccessToken: safeDecryptToken(page.whatsappAccessToken, { entity: 'page', id: page.id }) || null,
                ...stats,
                replyRate: stats.commentsCount > 0
                    ? Math.round((stats.repliesCount / stats.commentsCount) * 100)
                    : 0,
                hasPostReplyTrigger: triggerPageIds.has(page.id),
                catalogItemsCount: catalogCountByPage.get(page.id) ?? 0,
                storeAnswersPolicies: !!page.ecommerceStoreId && storesAnsweringPolicies.has(page.ecommerceStoreId),
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
        if (page) {
            page.accessToken = safeDecryptToken(page.accessToken, { entity: 'page', id: page.id });
            page.whatsappAccessToken = safeDecryptToken(page.whatsappAccessToken, { entity: 'page', id: page.id }) || null;
        }
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
        if (page) page.accessToken = safeDecryptToken(page.accessToken, { entity: 'page', id: page.id });
        return page;
    }

    /**
     * Invalidate every cache layer that reads merchant context the AI injects
     * into prompts directly (i.e. NOT tool-fetched data — that always re-queries
     * the live row and doesn't need invalidation).
     *
     * Call this from ANY writer that mutates a field which ends up in the AI's
     * system prompt for a future reply. Concretely, today that is:
     *
     *   - business_profile (address / phones / hours / about / policies)   [Stage 2.6]
     *   - settings.brandVoiceNotes / brandVoiceNotesMulti                  [future]
     *   - settings.replyStyle                                              [future]
     *   - settings.awayMessage / greetingMessage                           [future]
     *   - pages.knowledge_base (raw KB text) — already handled by updatePage
     *
     * If you add a new field that gets prompt-injected (not tool-fetched), wire
     * its writer through this function or your edits won't reach customers
     * until the next semantic-cache eviction (~24h). catalog_items writes
     * (services/catalog.ts) follow exactly this rule — items are prompt-injected
     * via the <product_catalog> block, so every CRUD call lands here.
     *
     * Mechanism: the exact-cache key (ai.ts:buildCacheKey) and the semantic
     * cache (kb/semantic-cache.ts) both include kbActiveVersion as a scope
     * input. Bumping kbActiveVersion makes the next cache lookup produce a
     * different key / filter out every existing semantic row, so the AI
     * regenerates with the updated context. Old entries become orphaned
     * and expire on their existing TTLs — no SCAN/DEL needed.
     *
     * Returns the post-bump kbActiveVersion, or null if the page doesn't
     * exist. Callers usually don't need the return value.
     *
     * `executor` lets a caller run the bump inside its own transaction so the
     * row write and the cache invalidation land (or fail) together — e.g. the
     * catalog service, where a committed delete without the bump would keep
     * replies quoting a deleted item until cache TTL.
     */
    async invalidatePageCaches(pageId: string, executor: Pick<typeof db, 'update'> = db): Promise<{ kbActiveVersion: number } | null> {
        const [updated] = await executor
            .update(pages)
            .set({
                kbVersion: sql`COALESCE(${pages.kbVersion}, 0) + 1`,
                kbActiveVersion: sql`COALESCE(${pages.kbActiveVersion}, 0) + 1`,
                kbUpdatedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(pages.id, pageId))
            .returning({ kbActiveVersion: pages.kbActiveVersion });

        if (!updated) return null;
        return { kbActiveVersion: updated.kbActiveVersion ?? 0 };
    }

    /**
     * Update a page.
     * When knowledgeBase changes, bumps kbVersion and sets kbUpdatedAt.
     * kbActiveVersion is NOT touched for KB-text changes — it's set after
     * ingestion completes.
     *
     * When businessProfile changes, bumps BOTH kbVersion AND kbActiveVersion
     * inline (same effect as calling invalidatePageCaches separately). The
     * second bump is required because business_profile is prompt-injected
     * directly — there's no ingestion step to flip kbActiveVersion later.
     * Without this bump, cached replies would quote the old address/phone/
     * hours for up to 30 days (exact-cache TTL).
     */
    async updatePage(
        workspaceId: string,
        pageId: string,
        data: UpdatePageDTO,
        opts?: { skipGapResolution?: boolean },
    ) {
        // EXPLICIT column allowlist — never spread the request body into .set().
        // PUT /pages/:id registers no body schema (routes/pages.ts), so a spread
        // let any admin-role caller write any column on a page row they own:
        // workspace_id, user_id, access_token, whatsapp_* credentials, the kb_*
        // version counters. Same shape as updateLeadConfig below.
        // `businessProfileConfirmFields` is not a column (consumed by
        // applyMerchantEdit), and `businessProfile` is assigned in the block
        // below only after validation + provenance merge — neither belongs here.
        const setData: Record<string, unknown> = { updatedAt: new Date() };
        if ('name' in data) setData.name = data.name;
        if ('accessToken' in data) setData.accessToken = data.accessToken;
        if ('autoReplyEnabled' in data) setData.autoReplyEnabled = data.autoReplyEnabled;
        if ('knowledgeBase' in data) setData.knowledgeBase = data.knowledgeBase;

        // Bump KB version when knowledge base content changes
        if (data.knowledgeBase !== undefined) {
            setData.kbVersion = sql`COALESCE(${pages.kbVersion}, 0) + 1`;
            setData.kbUpdatedAt = new Date();
        }

        // business_profile is prompt-injected, so cache invalidation must be
        // active (bumping kbActiveVersion). See invalidatePageCaches docstring.
        //
        // Stage 2.6.1: the API contract is "PATCH body = merchant content"
        // (flat BusinessProfile shape, full-replace semantics). Server-side
        // we wrap it into the {merchant, suggestions, merchantProvenance}
        // container, preserving the existing suggestions half from FB sync
        // and updating the per-field provenance to reflect this editor save
        // (every present field → editor + now; every previously-known field
        // absent from the patch → "cleared" tombstone with editor + now).
        if (data.businessProfile !== undefined) {
            const [existingRow] = await db
                .select({ businessProfile: pages.businessProfile })
                .from(pages)
                .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
                .limit(1);
            const existingContainer = unwrapBusinessProfile(existingRow?.businessProfile as StoredBusinessProfile);
            const patch = data.businessProfile as BusinessProfile;
            // Only tracked-field names are meaningful confirm targets; anything
            // else in the client list is dropped (defense against typos and
            // stale clients, not a validation error).
            const confirmFields = (Array.isArray(data.businessProfileConfirmFields) ? data.businessProfileConfirmFields : [])
                .filter((f): f is keyof BusinessProfile =>
                    (TRACKED_FIELDS as readonly string[]).includes(f));
            const { merchant, merchantProvenance } = applyMerchantEdit(
                patch,
                existingContainer.merchantProvenance,
                new Date(),
                existingContainer.merchant,
                confirmFields,
            );
            const container: BusinessProfileContainer = {
                merchant,
                ...(existingContainer.suggestions ? { suggestions: existingContainer.suggestions } : {}),
                merchantProvenance,
            };
            setData.businessProfile = container;
            setData.businessProfileUpdatedAt = new Date();
            setData.kbVersion = sql`COALESCE(${pages.kbVersion}, 0) + 1`;
            setData.kbActiveVersion = sql`COALESCE(${pages.kbActiveVersion}, 0) + 1`;
            setData.kbUpdatedAt = new Date();
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
                        ingestion.ingestFullPage(pageId, kbText, productData, kbVersion, {
                            resolveGaps: !opts?.skipGapResolution,
                        })
                    )
                    .catch(err => captureError(err, 'Full page ingestion failed during updatePage', { tags: { service: 'kb-ingestion', action: 'updatePage' }, extra: { pageId } }));
            }
            // Independent of RAG ingestion: refresh the structured operational facts
            // (hours/phone/address) that feed the authoritative BUSINESS_INFO block,
            // so they stay in sync with the KB the merchant just typed instead of
            // going stale. Flag-gated (off|shadow|on), fire-and-forget, off the reply path.
            void this.maybeExtractOperationalFacts(pageId, updatedPage.userId, kbText);
        }

        return updatedPage;
    }

    /**
     * On-save refresh of structured operational facts (hours / phone / address)
     * from the merchant's free-text KB into `business_profile.merchant` as
     * `kb_extract`, so the authoritative BUSINESS_INFO block carries the
     * merchant's OWN values instead of going stale or leaning on mis-chunked
     * free text. This is the live wiring of `operationalFactsExtractor` +
     * `applyKbExtractToMerchant` (previously only the one-time backfill called
     * them).
     *
     * Flag-gated by `config.opFactsExtract`:
     *   - 'off'    → no-op (default).
     *   - 'shadow' → extract + log the would-be change, write nothing (used to
     *                vet extractor stability before enabling writes).
     *   - 'on'     → persist the merged container (business_profile only). It
     *                does NOT bump kbActiveVersion — the KB ingestion that
     *                co-fires for this same save activates kbActiveVersion last
     *                (after chunks land), which invalidates the caches and
     *                covers this change. Bumping it here would risk landing one
     *                past the chunk version and orphaning the new chunks.
     *
     * Fire-and-forget, off the reply path; runs at most once per KB edit. Never
     * throws. `applyKbExtractToMerchant` is fill-only-empty + refresh-own, so it
     * can never clobber a merchant editor edit or an fb_sync value.
     */
    private async maybeExtractOperationalFacts(
        pageId: string,
        userId: string | null,
        kbText: string,
    ): Promise<void> {
        const mode = config.opFactsExtract;
        if (mode === 'off' || !userId) return;

        try {
            const extracted = await operationalFactsExtractor.extract(kbText, { userId, pageId });
            if (!extracted.hours && !extracted.address && !extracted.phones) return;

            // Re-read the current container (the KB save already committed).
            const [row] = await db
                .select({ businessProfile: pages.businessProfile })
                .from(pages)
                .where(eq(pages.id, pageId))
                .limit(1);
            const existing = unwrapBusinessProfile(row?.businessProfile as StoredBusinessProfile);
            const { merchant, merchantProvenance } = applyKbExtractToMerchant(
                existing.merchant,
                existing.merchantProvenance,
                extracted as BusinessProfile,
            );

            // applyKbExtractToMerchant is fill-only-empty + refresh-own, so a
            // no-op is common (editor/fb_sync already own the fields, or the
            // re-extraction matches the stored kb_extract values).
            const changed = JSON.stringify(merchant) !== JSON.stringify(existing.merchant ?? {});
            if (!changed) return;

            if (mode === 'shadow') {
                this.logger.info('opfacts(shadow): would refresh merchant operational facts', {
                    pageId, extracted, before: existing.merchant, after: merchant,
                });
                return;
            }

            const container: BusinessProfileContainer = {
                merchant,
                ...(existing.suggestions ? { suggestions: existing.suggestions } : {}),
                merchantProvenance,
            };
            // Write business_profile ONLY — do NOT bump kbActiveVersion here.
            // Retrieval filters chunks by exact `kb_version = kbActiveVersion`
            // (retrieval.ts), and the KB ingestion that co-fires for this same
            // save (both are gated on the OpenAI key, so ingestion always runs
            // when extraction does) atomically activates kbActiveVersion =
            // kbVersion after storing the new chunks. That bump invalidates the
            // reply/semantic caches (which also scope on kbActiveVersion) and
            // covers this business_profile change. If extraction ALSO bumped
            // kbActiveVersion it could land one past the chunk version and
            // orphan the freshly-ingested chunks → retrieval returns nothing.
            await db
                .update(pages)
                .set({
                    businessProfile: container,
                    businessProfileUpdatedAt: new Date(),
                })
                .where(eq(pages.id, pageId));
            this.logger.info('opfacts: refreshed merchant operational facts from KB', {
                pageId, fields: Object.keys(extracted),
            });
        } catch (err) {
            captureError(err, 'On-save operational-facts extraction failed', {
                tags: { service: 'operational-facts-extraction', action: 'updatePage' },
                extra: { pageId },
            });
        }
    }

    /**
     * Save a page's lead-config overrides (leadStages / leadFields). Minimal
     * sibling of updatePage with NO side-effects — lead config never feeds the
     * reply pipeline, so there's no kbVersion bump and no KB ingestion. Only the
     * keys present in the DTO are written, so a partial PATCH (e.g. just
     * leadStages) leaves the other slice untouched. A null value reverts that
     * slice to the workspace default.
     */
    async updateLeadConfig(workspaceId: string, pageId: string, data: UpdateLeadConfigDTO) {
        const setData: Record<string, unknown> = { updatedAt: new Date() };
        if ('leadStages' in data) setData.leadStages = data.leadStages ?? null;
        if ('leadFields' in data) setData.leadFields = data.leadFields ?? null;

        const [updatedPage] = await db
            .update(pages)
            .set(setData)
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .returning();

        return updatedPage ?? null;
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
     * Re-ingest a page's CURRENT KB text (+ products) into fresh chunks and activate that version.
     * The single reliable re-ingest path: `ingestFullPage` transactionally REPLACES the version's
     * chunks (see pgvector-store upsertChunks) and only flips kbActiveVersion on success, so this is
     * idempotent and safe to call anytime. Used by the drift reconciler to self-heal pages whose
     * fire-and-forget ingest (updatePage/addFact/sync/ecommerce) failed and left kbActiveVersion
     * behind kbVersion. Bounded retry on transient embedding/DB errors. Returns false on failure.
     */
    async reingestPage(
        pageId: string,
        opts: { ingestion?: KbIngestionService; attempts?: number } = {},
    ): Promise<boolean> {
        const ingestion = opts.ingestion ?? getIngestionService();
        if (!ingestion) return false;

        const [page] = await db
            .select({ knowledgeBase: pages.knowledgeBase, ecommerceStoreId: pages.ecommerceStoreId, kbVersion: pages.kbVersion })
            .from(pages)
            .where(eq(pages.id, pageId))
            .limit(1);
        if (!page?.kbVersion) return false;

        const products = await this.fetchProductsForPage(page.ecommerceStoreId);
        const maxAttempts = Math.max(1, opts.attempts ?? 2);
        let lastErr: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await ingestion.ingestFullPage(pageId, page.knowledgeBase ?? undefined, products, page.kbVersion);
                return true;
            } catch (err) {
                lastErr = err;
                if (attempt < maxAttempts) await new Promise(res => setTimeout(res, 500 * attempt));
            }
        }
        captureError(lastErr, 'reingestPage failed after retries', {
            tags: { service: 'kb-ingestion', action: 'reingestPage' }, extra: { pageId },
        });
        return false;
    }

    /**
     * Delete a page
     */
    async deletePage(workspaceId: string, pageId: string) {
        // Collect stored-image keys (Post Reply triggers + generated post cards)
        // BEFORE the cascade delete drops the rows, so the objects don't orphan.
        // Ownership is enforced by the delete's WHERE.
        const [ownedPage] = await db
            .select({ id: pages.id })
            .from(pages)
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)));
        if (!ownedPage) return;

        // A post suggestion owns one file PER TAKE, so it contributes a list
        // rather than a column — imageKeysOf is the single place that knows a
        // row's full storage footprint (mirrored column + every take).
        const suggestionRows = await db
            .select({ imageKey: postSuggestions.imageKey, variants: postSuggestions.variants })
            .from(postSuggestions).where(eq(postSuggestions.pageId, pageId));
        const imageKeys = [
            ...[
                ...(await db.select({ key: posts.triggerImageKey }).from(posts).where(eq(posts.pageId, pageId))),
                ...(await db.select({ key: instagramMedia.triggerImageKey }).from(instagramMedia).where(eq(instagramMedia.pageId, pageId))),
            ].map(r => r.key).filter((k): k is string => !!k),
            ...suggestionRows.flatMap(imageKeysOf),
        ];

        await db
            .delete(pages)
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)));

        // Best-effort object cleanup after the DB commit (imageStorage.remove logs and
        // swallows). A missed delete leaves a harmless orphan swept by the audit script.
        for (const key of imageKeys) {
            await imageStorage.remove(key);
        }
    }

    /**
     * Toggle auto-reply for a page.
     *
     * When the customer re-enables auto-reply, also clear any defensive auto-pause
     * state (consecutive_send_failures, auto_pause_reason, auto_paused_at) so the
     * page gets a fresh start. The customer is implicitly acknowledging "I checked
     * the Facebook side, try again." If the underlying issue persists, the failure
     * counter simply climbs back to the threshold.
     */
    async toggleAutoReply(workspaceId: string, pageId: string, enabled: boolean) {
        const [updatedPage] = await db
            .update(pages)
            .set({
                autoReplyEnabled: enabled,
                // Explicit toggle = merchant intent. 'user' keeps the comment
                // pipeline fully silent for this page (unlike system disables).
                autoReplyDisabledReason: enabled ? null : 'user',
                updatedAt: new Date(),
                // Clear auto-pause state only on the off → on transition.
                // Disabling shouldn't wipe a paused-reason audit trail.
                ...(enabled
                    ? {
                        consecutiveSendFailures: 0,
                        autoPauseReason: null,
                        autoPausedAt: null,
                    }
                    : {}),
            })
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .returning();

        return updatedPage;
    }

    /**
     * Archive (soft-hide) a disconnected Facebook page.
     *
     * Agencies rotate pages, and every rotation leaves a dead card on the channels
     * screen with no merchant-facing remedy (hard delete is admin/GDPR only). This
     * hides the card while keeping the row and ALL its data: reconnecting the page
     * through Facebook clears `archivedAt` in `syncFromFacebook` and the page comes
     * back exactly as it was.
     *
     * Only a page Facebook has already disconnected can be archived — archiving is
     * NOT a disconnect. A page whose Facebook token died but whose WhatsApp channel
     * is still live shows the same reconnect banner, yet hiding it would bury a
     * working channel, so it is refused too.
     */
    async archivePage(workspaceId: string, pageId: string): Promise<
        | { status: 'not_found' }
        | { status: 'not_disconnected' }
        | { status: 'archived'; page: typeof pages.$inferSelect; already: boolean }
    > {
        const [page] = await db
            .select()
            .from(pages)
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)));

        if (!page) return { status: 'not_found' };

        // Mirrors serializePage's connection rules: a Facebook page with a blanked
        // token, and no live WhatsApp channel behind it.
        const whatsappConnected = !!page.whatsappAccessToken && page.whatsappAccessToken !== '';
        if (!page.facebookPageId || !isPageDisconnected(page) || whatsappConnected) {
            return { status: 'not_disconnected' };
        }

        // Idempotent: a double-submit (or a stale tab) must not rewrite the timestamp
        // or emit a second audit event.
        if (page.archivedAt) return { status: 'archived', page, already: true };

        const [updated] = await db
            .update(pages)
            .set({ archivedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .returning();

        return { status: 'archived', page: updated, already: false };
    }

    /**
     * Sync pages from Facebook (and linked Instagram accounts)
     * @param workspaceId - The workspace ID to sync pages for
     * @param userId - The user ID (billing owner)
     * @param userAccessToken - Facebook user access token
     * @param logger - Optional logger for tracking sync progress
     */
    async syncFromFacebook(workspaceId: string, userId: string, userAccessToken: string, billingUserId?: string, logger: Logger = noopLogger) {
        logger.info(`[Pages] Starting sync for workspace ${workspaceId}`);

        // Propagate the request-scoped logger to facebookService so its internal
        // [Facebook] log lines (including the granular_scopes fallback path) surface
        // in production logs for support diagnosis.
        facebookService.setLogger(logger);

        const fbPages = await facebookService.getUserPages(userAccessToken);
        const syncedPages = [];

        if (!fbPages.data || fbPages.data.length === 0) {
            logger.info('[Pages] No pages returned from Facebook API');
            return { syncedPages: [], skippedCount: 0, skippedPages: [] as { pageName: string }[], pageLimit: null as number | null, takenCount: 0, trialBlockedCount: 0, trialBlockedPages: [] as { pageName: string }[], alreadyMemberOf: [] as AlreadyMemberOfEntry[] };
        }

        logger.info(`[Pages] Processing ${fbPages.data.length} pages from Facebook`);

        // 1. Fetch all existing pages for this workspace upfront (optimizes DB reads)
        const existingPages = await this.getPages(workspaceId);
        const existingPagesMap = new Map(existingPages.filter(p => p.facebookPageId !== null && p.facebookPageId !== undefined).map(p => [p.facebookPageId as string, p]));

        // 2. Disable pages that the user revoked access to in Facebook.
        // If a page exists in DB but was NOT returned by Facebook's /me/accounts,
        // the user deselected it in Facebook's permission dialog — disable it.
        // This MUST run before the plan-slot check below: a deselected page's slot
        // has to be free for pages granted in the SAME sync, or the one-shot swap
        // ("drop N pages, keep A, add B" in one edit of the Meta grant) refuses B
        // on the first attempt and only succeeds on an identical retry.
        const returnedFbPageIds = new Set(fbPages.data.map(p => p.id));
        const revokedPages = existingPages.filter(p => p.facebookPageId && !returnedFbPageIds.has(p.facebookPageId));

        for (const revokedPage of revokedPages) {
            logger.info(`[Pages] Page "${revokedPage.name}" (${revokedPage.facebookPageId}) was not returned by Facebook — disabling auto-reply`);
            await db
                .update(pages)
                .set({
                    autoReplyEnabled: false,
                    // Clear any prior reason — the blanked access token is the
                    // authoritative disconnect signal here, and a stale system
                    // reason ('trial_block'/'auto_pause') would misdescribe the
                    // page in the admin UI and the comment-ingestion gate.
                    autoReplyDisabledReason: null,
                    instagramAutoReplyEnabled: false,
                    accessToken: '',
                    tokenLastVerifiedAt: null,
                    updatedAt: new Date(),
                })
                .where(eq(pages.id, revokedPage.id));
            // Audit the off-transition when the page was actually replying before
            // (deselected in the FB permission dialog). Skip already-off pages so a
            // routine re-sync doesn't emit phantom events.
            if (revokedPage.autoReplyEnabled) {
                logAutoReplyToggle({
                    pageId: revokedPage.id,
                    workspaceId,
                    userId,
                    enabled: false,
                    previous: true,
                    reason: 'fb_sync',
                });
            }
        }

        if (revokedPages.length > 0) {
            logger.info(`[Pages] Disabled ${revokedPages.length} page(s) that user revoked access to in Facebook`);
        }

        // 3. Process Facebook pages in parallel (optimizes external API calls)
        const processPromises = fbPages.data.map(async (fbPage) => {
            logger.info(`[Pages] Processing page: ${fbPage.name} (${fbPage.id})`);

            // Check linked Instagram account
            let instagramAccountId: string | null = null;
            let instagramUsername: string | null = null;
            let instagramProfilePicUrl: string | null = null;

            try {
                const igAccount = await instagramService.getLinkedInstagramAccount(
                    fbPage.id,
                    pageLinkedInstagramCredential(fbPage.access_token)
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

        // 4. Determine how many more pages can be auto-enabled
        // The trial / channel claim belongs to the BILLING account (workspace owner
        // with the subscription), not necessarily the team member running the sync.
        // Runs after step 2 so slots freed by just-revoked pages count as free.
        const billing = billingUserId ?? userId;
        const enableCheck = await subscriptionsService.canEnablePage(billing, workspaceId);
        let remainingSlots: number | null = null; // null = unlimited
        if (enableCheck.allowed && enableCheck.remaining !== undefined) {
            remainingSlots = enableCheck.remaining;
        } else if (!enableCheck.allowed) {
            remainingSlots = 0;
        }
        // Distinguish WHY connection may be refused so the client shows the right
        // copy. 'subscription_inactive' (e.g. a returning identity on a canceled,
        // trial-already-used subscription) is NOT a page-count problem — telling
        // such a user to "upgrade your plan for more pages" is misleading; they need
        // to subscribe. A genuine over-limit on an ACTIVE plan stays 'page_limit'.
        const skipReason: 'subscription_inactive' | 'page_limit' =
            (!enableCheck.allowed && enableCheck.code === 'subscription_inactive')
                ? 'subscription_inactive'
                : 'page_limit';
        let skippedCount = 0;
        // Pages NOT connected because the plan's page limit was reached —
        // names surfaced to the client so the merchant knows exactly what
        // was refused and why (instead of a silently disabled shadow page).
        const skippedPages: { pageName: string }[] = [];
        let takenCount = 0;
        // Pages connected but kept OFF because the channel already used its free
        // trial under another account and this account isn't paying (abuse guard).
        let trialBlockedCount = 0;
        const trialBlockedPages: { pageName: string }[] = [];
        // Pages we couldn't attach because they already belong to another workspace
        // AND the current user is a member of that workspace. Surfaced to the client
        // so the UI can offer "Switch to ‹X›" instead of the generic "ask the owner".
        const alreadyMemberOf: AlreadyMemberOfEntry[] = [];

        // 5. Perform DB Writes (Sequential to ensure consistency)
        // Best Practice: We write sequentially to avoid DB lock contention on the same user's rows
        // or potential race conditions if multiple syncs happen simultaneously.
        for (const result of results) {
            let { instagramAccountId, instagramUsername, instagramProfilePicUrl } = result;
            const { fbPage } = result;
            const existingPage = existingPagesMap.get(fbPage.id);

            // The linked IG account may already live on ANOTHER row — an
            // Instagram-direct card (connectInstagramDirect refuses the reverse
            // direction for the same reason), or a stale link on a different page.
            // instagram_account_id is UNIQUE, so writing it here would abort the
            // whole sync; and even before the index, the duplicate split webhook
            // routing arbitrarily. The claimed row stays authoritative: this FB
            // page syncs without the IG link, loudly, and support merges the two
            // rows deliberately when the merchant asks — never as a silent side
            // effect of a page sync.
            if (instagramAccountId) {
                const [claimedElsewhere] = await db
                    .select({ id: pages.id, facebookPageId: pages.facebookPageId })
                    .from(pages)
                    .where(and(
                        eq(pages.instagramAccountId, instagramAccountId),
                        or(isNull(pages.facebookPageId), ne(pages.facebookPageId, fbPage.id)),
                    ))
                    .limit(1);
                if (claimedElsewhere) {
                    logger.warn(`[Pages] IG account ${instagramAccountId} already owned by page ${claimedElsewhere.id} — syncing ${fbPage.id} without the IG link`);
                    captureError(
                        new Error('Instagram account already claimed by another page row'),
                        'FB sync skipped Instagram link — account owned by another row',
                        {
                            tags: { service: 'pages-sync' },
                            extra: { fbPageId: fbPage.id, instagramAccountId, claimedByPageId: claimedElsewhere.id, claimedRowIsDirect: !claimedElsewhere.facebookPageId },
                        },
                    );
                    instagramAccountId = null;
                    instagramUsername = null;
                    instagramProfilePicUrl = null;
                }
            }

            if (existingPage) {
                // Industry standard (ManyChat / Chatfuel model): the access token belongs to
                // whoever originally connected the page. Only that user's sync may refresh it.
                // Team members who share Facebook page admin access must not overwrite the
                // stored token — if they did, the page would break when they lose access.
                const isOriginalConnector = existingPage.userId === userId;
                logger.debug(`[Pages] Updating existing page: ${fbPage.name} (tokenUpdate: ${isOriginalConnector})`);
                // Stage 2.6: FB sync writes to the `suggestions` half of the
                // container. The `merchant` half is editor-write-only and is
                // preserved verbatim from the existing row.
                const businessProfile = buildBusinessProfileContainer(fbPage, existingPage.businessProfile as StoredBusinessProfile);
                // NOTE: this set clause is an explicit allow-list. Do NOT add
                // lead_stages / lead_fields here — they are per-page lead config
                // and MUST survive a Facebook disconnect→reconnect (the row is the
                // same; sync only refreshes FB-sourced fields). Adding them would
                // silently wipe a merchant's customization on every re-sync.
                const [updated] = await db
                    .update(pages)
                    .set({
                        name: fbPage.name,
                        // Only refresh the token if this is the user who connected the page.
                        // Re-auth restores connectivity → clear disconnectReason for clean
                        // support state (otherwise stale "token_revoked" lingers forever).
                        ...(isOriginalConnector && {
                            accessToken: maybeEncryptToken(fbPage.access_token),
                            tokenLastVerifiedAt: new Date(),
                            disconnectReason: null,
                        }),
                        instagramAccountId,
                        instagramUsername,
                        instagramProfilePicUrl,
                        businessProfile,
                        businessProfileUpdatedAt: new Date(),
                        // Un-archive: the page is back in the merchant's Meta grant, so
                        // they want it again. Applied unconditionally (NOT inside the
                        // isOriginalConnector spread) — a team member's sync proves the
                        // same intent even though it may not refresh the token.
                        archivedAt: null,
                        updatedAt: new Date(),
                    })
                    .where(eq(pages.id, existingPage.id))
                    .returning();
                syncedPages.push(updated);
                // The token was just restored — the reconnect-alert dedup claims
                // must not outlive the incident they collapsed, or a re-revocation
                // inside 24h alerts on no channel at all.
                if (isOriginalConnector) {
                    clearReconnectAlertClaims(existingPage.id, updated?.userId ?? userId);
                }
                if (existingPage.archivedAt) {
                    void auditLog({
                        userId,
                        workspaceId,
                        pageId: existingPage.id,
                        action: 'page.unarchived',
                        entityType: 'page',
                        entityId: existingPage.id,
                        metadata: { reason: 'fb_sync' },
                    });
                }

                // Subscribe page to webhook events (idempotent — safe to re-subscribe)
                await facebookService.subscribePageToWebhooks(fbPage.id, fbPage.access_token);
            } else {
                // Check if this page exists in another workspace (transferred admin access)
                const globalResults = await db
                    .select()
                    .from(pages)
                    .where(eq(pages.facebookPageId, fbPage.id));
                const globalExisting = globalResults[0];

                // Anti free-trial-abuse: a channel gets one free trial across the
                // platform, bound to the first account that enabled it. Check the
                // page's full channel identity (FB page + linked IG + any prior
                // WhatsApp) so reconnecting under a fresh account — or swapping the
                // FB page but keeping the same IG — can't farm another free trial.
                const pageChannels = channelTrialService.channelsForPage({
                    facebookPageId: fbPage.id,
                    instagramAccountId,
                    whatsappPhoneNumberId: globalExisting?.whatsappPhoneNumberId ?? null,
                });
                const { blocked: trialBlocked } = await channelTrialService.evaluate(billing, pageChannels);
                const slotAvailable = remainingSlots === null || remainingSlots > 0;
                // Plan page-limit reached: refuse the connection outright instead
                // of persisting a disabled shadow page (pre-06/2026 behavior).
                // Shadow pages kept receiving webhooks whose traffic was dropped
                // with no inbox trace — merchants read that as "product broken".
                // The merchant picks which page(s) to connect in Facebook's grant
                // dialog, or upgrades for more slots. Pages actively owned by
                // another workspace fall through to the taken/alreadyMemberOf
                // handling below instead.
                const ownedByActiveWorkspace = !!globalExisting && !isPageDisconnected(globalExisting);
                if (!slotAvailable && !ownedByActiveWorkspace) {
                    logger.info(`[Pages] Plan page limit reached — not connecting "${fbPage.name}" (${fbPage.id})`);
                    skippedCount++;
                    skippedPages.push({ pageName: fbPage.name });
                    continue;
                }
                const shouldAutoEnable = !trialBlocked;
                // Record WHY the system kept auto-reply off. Trial-blocked pages
                // ARE persisted (connected-but-off) so the UI can prompt the
                // merchant to subscribe; the comment pipeline ingests (but never
                // answers) their comments, and the admin UI surfaces the reason.
                const autoReplyDisabledReason = shouldAutoEnable ? null : 'trial_block';
                // Pass globalExisting's profile so a reclaim/disconnect-recover
                // preserves the merchant half if any (otherwise undefined → fresh).
                const businessProfile = buildBusinessProfileContainer(fbPage, globalExisting?.businessProfile as StoredBusinessProfile);

                if (globalExisting && isPageDisconnected(globalExisting)) {
                    // Page exists but previous owner disconnected — safe to claim
                    logger.info(`[Pages] Claiming disconnected page "${fbPage.name}" (${fbPage.id}) from workspace ${globalExisting.workspaceId} to ${workspaceId}`);
                    // ATOMIC: the page row and the denormalized workspace_id on its
                    // inbox rows must move together or not at all. If the re-scope
                    // could fail after the page row committed, the next sync would
                    // take the `existingPage` branch (the page now lives here) and
                    // never re-scope again — permanent silent drift, which is the
                    // exact bug this whole change exists to kill. Prod carried 145
                    // such stranded messages from before the re-scope existed.
                    const claimed = await db.transaction(async (tx) => {
                        const [row] = await tx
                            .update(pages)
                            .set({
                                workspaceId,
                                userId,
                                name: fbPage.name,
                                accessToken: maybeEncryptToken(fbPage.access_token),
                                tokenLastVerifiedAt: new Date(),
                                disconnectReason: null,
                                autoReplyEnabled: shouldAutoEnable,
                                autoReplyDisabledReason,
                                instagramAccountId,
                                instagramUsername,
                                instagramProfilePicUrl,
                                businessProfile,
                                businessProfileUpdatedAt: new Date(),
                                // Reclaim moves the page from ANOTHER workspace into this one
                                // — clear the previous owner's per-page lead config so it can't
                                // leak across workspaces. The page inherits THIS workspace's
                                // default until re-customized. (A same-workspace reconnect goes
                                // through the existingPage branch above, which KEEPS the override.)
                                leadStages: null,
                                leadFields: null,
                                // A claimed page is live again in its new workspace — an
                                // archive flag set by the PREVIOUS owner must not keep it
                                // hidden here.
                                archivedAt: null,
                                updatedAt: new Date(),
                            })
                            .where(eq(pages.id, globalExisting.id))
                            .returning();

                        if (globalExisting.workspaceId !== workspaceId) {
                            await rescopePageWorkspace(globalExisting.id, workspaceId, logger, tx);
                        }
                        return row;
                    });
                    syncedPages.push(claimed);
                    // Fresh token written in the transaction above — release the
                    // reconnect-alert dedup claims (see the sync branch above).
                    if (claimed) clearReconnectAlertClaims(claimed.id, userId);
                    if (globalExisting.archivedAt) {
                        void auditLog({
                            userId,
                            workspaceId,
                            pageId: claimed.id,
                            action: 'page.unarchived',
                            entityType: 'page',
                            entityId: claimed.id,
                            metadata: { reason: 'fb_sync', fromWorkspaceId: globalExisting.workspaceId },
                        });
                    }
                    // Reclaiming a disconnected page (re)establishes its auto-reply
                    // state via Facebook — audit it as an fb_sync transition.
                    logAutoReplyToggle({
                        pageId: claimed.id,
                        workspaceId,
                        userId,
                        enabled: shouldAutoEnable,
                        reason: shouldAutoEnable ? 'fb_sync' : 'trial_block',
                    });

                    await facebookService.subscribePageToWebhooks(fbPage.id, fbPage.access_token);
                } else if (globalExisting) {
                    // Page is active under another workspace — skip to avoid stealing it.
                    logger.info(`[Pages] Page "${fbPage.name}" (${fbPage.id}) is already connected in workspace ${globalExisting.workspaceId} — skipping`);
                    if (globalExisting.workspaceId) {
                        const holdingWorkspaceId = globalExisting.workspaceId;
                        const [memberOfHolding] = await db
                            .select({
                                role: workspaceMembers.role,
                                workspaceName: workspacesTable.name,
                            })
                            .from(workspaceMembers)
                            .innerJoin(workspacesTable, eq(workspaceMembers.workspaceId, workspacesTable.id))
                            .where(
                                and(
                                    eq(workspaceMembers.workspaceId, holdingWorkspaceId),
                                    eq(workspaceMembers.userId, userId),
                                )
                            )
                            .limit(1);
                        if (memberOfHolding) {
                            // Syncing user is already a member of the holding workspace —
                            // surface a one-tap "switch workspace" CTA on the client.
                            takenCount++;
                            alreadyMemberOf.push({
                                workspaceId: holdingWorkspaceId,
                                workspaceName: memberOfHolding.workspaceName,
                                role: memberOfHolding.role,
                                pageName: fbPage.name,
                            });
                        }
                        // Else: silent skip — user can't act on this page from their own
                        // account, so don't surface noise (e.g. ex-team-member case).
                    }
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
                            autoReplyDisabledReason,
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
                    // Record the auto-reply state a page is born with at connect
                    // (previous = null), so its full on/off history starts here.
                    logAutoReplyToggle({
                        pageId: created.id,
                        workspaceId,
                        userId,
                        enabled: shouldAutoEnable,
                        reason: shouldAutoEnable ? 'fb_sync' : 'trial_block',
                    });

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

                if (shouldAutoEnable) {
                    // Claim the channels for the billing account so this trial can't
                    // be re-used by a different account later (first writer wins).
                    await channelTrialService.record(pageChannels, billing, workspaceId);
                    if (remainingSlots !== null) {
                        remainingSlots--;
                    }
                } else {
                    // Connected, but auto-reply stays OFF — channel already used its
                    // free trial. Surfaced so the UI can prompt the user to subscribe.
                    trialBlockedCount++;
                    trialBlockedPages.push({ pageName: fbPage.name });
                }
            }
        }

        logger.info(`[Pages] Sync complete. ${syncedPages.length} pages synced, ${skippedCount} not connected (plan limit), ${trialBlockedCount} blocked (free trial already used on channel), ${revokedPages.length} disabled (access revoked).`);
        return { syncedPages, skippedCount, skippedPages, skipReason, pageLimit: enableCheck.limit ?? null, takenCount, trialBlockedCount, trialBlockedPages, revokedCount: revokedPages.length, alreadyMemberOf };
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
        if (page) page.accessToken = safeDecryptToken(page.accessToken, { entity: 'page', id: page.id });
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
        if (page) {
            page.accessToken = safeDecryptToken(page.accessToken, { entity: 'page', id: page.id });
            page.whatsappAccessToken = safeDecryptToken(page.whatsappAccessToken, { entity: 'page', id: page.id }) || null;
        }
        return page;
    }

    /**
     * Create a WhatsApp-only page row (no Facebook page behind it).
     * Backs both WhatsApp-only merchants (Shopify/Salla/Zid sellers with no FB
     * page) and additional numbers for existing merchants — each number gets
     * its own card with its own Business Info. accessToken stays '' (there is
     * no Facebook credential); the WABA token is the card's primary credential.
     */
    async createWhatsAppOnlyPage(
        workspaceId: string,
        userId: string,
        data: {
            phoneNumberId: string;
            businessAccountId: string;
            displayPhoneNumber: string;
            accessToken: string;
            /** Null when Meta reports no expiry; see whatsappTokenExpiresAt in schema. */
            tokenExpiresAt?: Date | null;
            verifiedName?: string;
            /** True when onboarded via Coexistence — the number stays on the merchant's phone. */
            coexistence?: boolean;
        },
    ) {
        const [newPage] = await db
            .insert(pages)
            .values({
                workspaceId,
                userId,
                facebookPageId: null,
                name: data.verifiedName || data.displayPhoneNumber,
                accessToken: '',
                autoReplyEnabled: false,
                whatsappPhoneNumberId: data.phoneNumberId,
                whatsappBusinessAccountId: data.businessAccountId,
                whatsappDisplayPhoneNumber: data.displayPhoneNumber,
                whatsappAccessToken: maybeEncryptToken(data.accessToken),
                whatsappAutoReplyEnabled: false,
                whatsappTokenExpiresAt: data.tokenExpiresAt ?? null,
                whatsappCoexistence: data.coexistence ?? false,
                whatsappTokenLastVerifiedAt: new Date(),
            })
            .returning();

        return newPage;
    }

    /**
     * Store the WhatsApp Business fields from Embedded Signup on a page.
     * The business token is encrypted at rest (same scheme as the FB page token).
     */
    async connectWhatsApp(
        workspaceId: string,
        pageId: string,
        data: {
            phoneNumberId: string;
            businessAccountId: string;
            displayPhoneNumber: string;
            accessToken: string;
            /** Null when Meta reports no expiry; see whatsappTokenExpiresAt in schema. */
            tokenExpiresAt?: Date | null;
            /** True when onboarded via Coexistence — the number stays on the merchant's phone. */
            coexistence?: boolean;
        },
    ) {
        const [updatedPage] = await db
            .update(pages)
            .set({
                whatsappPhoneNumberId: data.phoneNumberId,
                whatsappBusinessAccountId: data.businessAccountId,
                whatsappDisplayPhoneNumber: data.displayPhoneNumber,
                whatsappAccessToken: maybeEncryptToken(data.accessToken),
                whatsappTokenExpiresAt: data.tokenExpiresAt ?? null,
                whatsappCoexistence: data.coexistence ?? false,
                whatsappTokenLastVerifiedAt: new Date(),
                // A reconnect clears any prior expiry/uninstall verdict — otherwise a
                // stale reason would keep the "reconnect WhatsApp" banner up on a
                // freshly-working number.
                whatsappDisconnectReason: null,
                updatedAt: new Date(),
            })
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .returning();

        return updatedPage;
    }

    /** Clear all WhatsApp fields (disconnect). The page row itself is kept. */
    async disconnectWhatsApp(workspaceId: string, pageId: string) {
        const [updatedPage] = await db
            .update(pages)
            .set({
                whatsappPhoneNumberId: null,
                whatsappBusinessAccountId: null,
                whatsappDisplayPhoneNumber: null,
                whatsappAccessToken: null,
                whatsappAutoReplyEnabled: false,
                whatsappTokenExpiresAt: null,
                whatsappTokenLastVerifiedAt: null,
                // Merchant-initiated disconnect is not a fault — leave no reason behind
                // for support to misread as an expiry.
                whatsappDisconnectReason: null,
                // The onboarding path belonged to the number that just left, not to
                // the card. Leaving it set strands a flag that means "this number is
                // still live on the merchant's phone" on a card with no number at all
                // — and it is the flag that decides whether a future connect skips
                // Cloud-API registration. NULL = no WhatsApp, nothing to preserve.
                whatsappCoexistence: null,
                updatedAt: new Date(),
            })
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .returning();

        return updatedPage;
    }

    /**
     * Toggle WhatsApp auto-reply for a page
     */
    async toggleWhatsAppAutoReply(workspaceId: string, pageId: string, enabled: boolean) {
        const [updatedPage] = await db
            .update(pages)
            .set({
                whatsappAutoReplyEnabled: enabled,
                updatedAt: new Date(),
            })
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .returning();

        return updatedPage;
    }
}

export const pagesService = new PagesService();

/**
 * Is this row's PRIMARY channel credential dead?
 *
 * THE THIRD TWIN of the connection rule — the other two are
 * `serializePage.isConnected` (controllers/pages.ts) and the admin SQL
 * `disconnected` CASE (services/admin/users.ts). All three MUST answer
 * identically for the same row; this one existed unlisted and unextended, which
 * is how Instagram-direct shipped with every webhook dropped at the front door
 * (PR #772 review C1). Change one, change all three.
 *
 * The rule: a Facebook-backed row is disconnected when its Facebook token was
 * blanked (the '' revocation sentinel written by pages sync / tokenRefresh). A
 * PAGELESS row (facebookPageId null — WhatsApp-only or Instagram-direct) is
 * disconnected only when it holds NO channel credential at all: the Facebook
 * token is '' on those rows by construction, so reading it there calls every
 * such page dead.
 *
 * `facebookPageId` is deliberately REQUIRED in the parameter type: it is the
 * discriminator, and an object that compiles without it would silently take the
 * pageless branch for a Facebook row — the same class of bug this function had.
 */
export function isPageDisconnected(page: {
    accessToken: string;
    facebookPageId: string | null;
    whatsappAccessToken?: string | null;
    instagramAccessToken?: string | null;
} | null | undefined): boolean {
    if (!page) return false;
    if (page.facebookPageId) return page.accessToken === '';
    return !page.whatsappAccessToken && !page.instagramAccessToken;
}

/**
 * Either the pooled `db` handle or a transaction handle from `db.transaction`.
 * Lets a caller run a helper inside its own transaction (see the reclaim path).
 */
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Re-scope every DENORMALIZED copy of `pages.workspace_id` after a page changes
 * workspace. MUST be called by any code path that moves a page between
 * workspaces — otherwise the page lands in the new workspace while its inbox
 * stays behind in the old one, visible to the previous owner and invisible to
 * the new one.
 *
 * Three tables carry the copy (added for the workspace-scoped inbox indexes,
 * see schema.ts): `comments` (reached via posts.page_id), `instagram_comments`
 * (via instagram_media.page_id), and `messages` (holds page_id directly).
 *
 * Deliberately NOT re-scoped: ai_usage_log / logs / usage. Those record who
 * incurred a cost or performed an action at the time, and must stay attributed
 * to the previous owner.
 *
 * Returns per-table row counts so callers can log the repair. Safe to re-run:
 * rows already in `workspaceId` are matched but written identically.
 */
export async function rescopePageWorkspace(
    pageId: string,
    workspaceId: string,
    logger: Logger = noopLogger,
    executor: DbExecutor = db
): Promise<{ comments: number; instagramComments: number; messages: number }> {
    // Every statement below runs SEQUENTIALLY, never Promise.all: `executor` may
    // be a transaction, and a single connection cannot run concurrent statements.

    // comments/instagram_comments have no page_id — resolve their parents first.
    // Two-step (rather than a subquery) mirrors the existing pattern in auth.ts.
    const postRows = await executor.select({ id: posts.id }).from(posts).where(eq(posts.pageId, pageId));
    const mediaRows = await executor.select({ id: instagramMedia.id }).from(instagramMedia).where(eq(instagramMedia.pageId, pageId));

    const postIds = postRows.map(p => p.id);
    const mediaIds = mediaRows.map(m => m.id);

    // Count-then-update rather than .returning({id}): a reclaimed page can carry
    // a very large message history, and materializing every row id purely to
    // count them would spike memory on the sync request. Each WHERE also excludes
    // rows already in the target workspace, so the count means "rows that had to
    // move" and a repeat run writes nothing.
    const commentsWhere = postIds.length
        ? and(inArray(comments.postId, postIds), ne(comments.workspaceId, workspaceId))
        : null;
    const igCommentsWhere = mediaIds.length
        ? and(inArray(instagramComments.mediaId, mediaIds), ne(instagramComments.workspaceId, workspaceId))
        : null;
    const messagesWhere = and(eq(messages.pageId, pageId), ne(messages.workspaceId, workspaceId));

    const moved = { comments: 0, instagramComments: 0, messages: 0 };

    if (commentsWhere) {
        const [row] = await executor.select({ n: count() }).from(comments).where(commentsWhere);
        moved.comments = Number(row?.n ?? 0);
        if (moved.comments > 0) {
            await executor.update(comments).set({ workspaceId }).where(commentsWhere);
        }
    }

    if (igCommentsWhere) {
        const [row] = await executor.select({ n: count() }).from(instagramComments).where(igCommentsWhere);
        moved.instagramComments = Number(row?.n ?? 0);
        if (moved.instagramComments > 0) {
            await executor.update(instagramComments).set({ workspaceId }).where(igCommentsWhere);
        }
    }

    const [messageRow] = await executor.select({ n: count() }).from(messages).where(messagesWhere);
    moved.messages = Number(messageRow?.n ?? 0);
    if (moved.messages > 0) {
        await executor.update(messages).set({ workspaceId }).where(messagesWhere);
    }

    if (moved.comments || moved.instagramComments || moved.messages) {
        logger.info(
            `[Pages] Re-scoped page ${pageId} inbox to workspace ${workspaceId}: ` +
            `${moved.comments} comment(s), ${moved.instagramComments} IG comment(s), ${moved.messages} message(s)`
        );
    }

    return moved;
}

