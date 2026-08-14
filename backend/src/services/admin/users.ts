import { db } from '../../db';
import {
    users, subscriptions, plans, pages, usage, posts, instagramMedia,
    leads, workspaces, workspaceMembers, settings, adminAuditLogs,
    comments, instagramComments, messages, kbChunks, kbGaps, partners,
    catalogItems, factCollections, factRows,
} from '../../db/schema';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { eq, ilike, desc, and, gte, lte, sql, inArray, or, type SQL } from 'drizzle-orm';
import { NotFoundError, ValidationError, ExternalServiceError } from '../../utils/errors';
import { computeHealthFlags, computeNonDefaultKeys, hasBusinessInfoContent, overlayPipelineSettings, resolvePipelineWorkspaceId, type SupportSettings } from './health';
import type { SubscriptionStatus } from '@jawab24/shared';
import { subscriptionsService, resolveEntitlementEnd } from '../subscriptions';
import { workspaceSettingsService } from '../workspaceSettings';
import { createHash } from 'crypto';
import { emailService } from '../email';
import {
    sniffAttachmentMime, resolveEffectiveReplyMode, countBusinessInfoFacts,
    unwrapBusinessProfile, type EmailAttachment, type StoredBusinessProfile,
} from '@jawab24/shared';
import { accountNoticeEmailTemplate } from '../../utils/emailTemplates';
import { captureError } from '../../utils/sentryHelpers';

/**
 * Admin Users service — read-heavy aggregation for the support/admin console.
 *
 * Pure data access + composition. HTTP concerns (status codes, response
 * envelopes) live in the controller. The list endpoint pushes all filtering
 * and pagination into SQL (no in-memory 5k cap).
 */

export interface ListAllUsersFilters {
    pageNum: number;
    limitNum: number;
    offset: number;
    status?: string;
    planSlug?: string;
    search?: string;
}

export interface AdminUserListRow {
    id: string;
    email: string | null;
    name: string | null;
    phone: string | null;
    /** ISO-3166 alpha-2 derived from the E.164 phone prefix (e.g. SY, LY); null when no/unparseable phone. */
    phoneCountry: string | null;
    facebookId: string | null;
    createdAt: Date | null;
    /** Reseller / country-rep attribution (users.partner_id). */
    partner: { id: string; name: string } | null;
    /** Partner-visible follow-up note (users.partner_note). */
    partnerNote: string | null;
    subscription: {
        id: string;
        status: string | null;
        planId: string | null;
        planName: string | null;
        planSlug: string | null;
        currentPeriodStart: Date | null;
        currentPeriodEnd: Date | null;
        paymentMethod: string | null;
    } | null;
}

export interface ListAllUsersResult {
    data: AdminUserListRow[];
    total: number;
}

/**
 * ISO country from the stored E.164 phone (+963… → SY). Backed by
 * libphonenumber's metadata — no hand-maintained prefix list. Null for
 * missing/unparseable phones (e.g. Facebook-only signups).
 */
function derivePhoneCountry(phone: string | null): string | null {
    if (!phone) return null;
    try {
        return parsePhoneNumberFromString(phone)?.country ?? null;
    } catch {
        return null;
    }
}

class AdminUsersService {
    /**
     * List all users with subscription summary, filtered + paginated in SQL.
     *
     * Filters are pushed into the WHERE clause; pagination uses SQL LIMIT/OFFSET;
     * the total comes from a separate COUNT(*) over the same WHERE. Search
     * matches email OR name OR phone with a case-insensitive substring (ilike
     * `%term%`) — the same semantics the old in-memory filter used. Status
     * filters on subscriptions.status, plan filters on plans.slug.
     */
    async listAll(filters: ListAllUsersFilters): Promise<ListAllUsersResult> {
        const { limitNum, offset, status, planSlug, search } = filters;

        const conditions: SQL[] = [];
        if (search && search.trim().length > 0) {
            const term = `%${search.trim()}%`;
            const searchOr = or(
                ilike(users.email, term),
                ilike(users.name, term),
                ilike(users.phone, term),
            );
            if (searchOr) conditions.push(searchOr);
        }
        if (status) {
            conditions.push(eq(subscriptions.status, status));
        }
        if (planSlug) {
            conditions.push(eq(plans.slug, planSlug));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // Active customers first, then trialing, then everything else by recency.
        // Lower CASE value = higher priority. (Preserved from the original.)
        const statusOrder = sql`CASE ${subscriptions.status}
            WHEN 'active' THEN 0
            WHEN 'trialing' THEN 1
            WHEN 'past_due' THEN 2
            WHEN 'paused' THEN 3
            WHEN 'canceled' THEN 4
            ELSE 5
        END`;

        const [rows, countResult] = await Promise.all([
            db
                .select({
                    id: users.id,
                    email: users.email,
                    name: users.name,
                    phone: users.phone,
                    facebookId: users.facebookId,
                    createdAt: users.createdAt,
                    subscriptionId: subscriptions.id,
                    subscriptionStatus: subscriptions.status,
                    planId: subscriptions.planId,
                    planName: plans.name,
                    planSlug: plans.slug,
                    currentPeriodStart: subscriptions.currentPeriodStart,
                    currentPeriodEnd: subscriptions.currentPeriodEnd,
                    paymentMethod: subscriptions.paymentMethod,
                    partnerId: users.partnerId,
                    partnerName: partners.name,
                    partnerNote: users.partnerNote,
                })
                .from(users)
                .leftJoin(subscriptions, eq(users.id, subscriptions.userId))
                .leftJoin(plans, eq(subscriptions.planId, plans.id))
                .leftJoin(partners, eq(users.partnerId, partners.id))
                .where(whereClause)
                .orderBy(statusOrder, desc(users.createdAt))
                .limit(limitNum)
                .offset(offset),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(users)
                .leftJoin(subscriptions, eq(users.id, subscriptions.userId))
                .leftJoin(plans, eq(subscriptions.planId, plans.id))
                .where(whereClause),
        ]);

        const total = countResult[0]?.count ?? 0;

        const data: AdminUserListRow[] = rows.map(u => ({
            id: u.id,
            email: u.email,
            name: u.name,
            phone: u.phone,
            phoneCountry: derivePhoneCountry(u.phone),
            facebookId: u.facebookId,
            createdAt: u.createdAt,
            partner: u.partnerId && u.partnerName ? { id: u.partnerId, name: u.partnerName } : null,
            partnerNote: u.partnerNote,
            subscription: u.subscriptionId ? {
                id: u.subscriptionId,
                status: u.subscriptionStatus,
                planId: u.planId,
                planName: u.planName,
                planSlug: u.planSlug,
                currentPeriodStart: u.currentPeriodStart,
                currentPeriodEnd: u.currentPeriodEnd,
                paymentMethod: u.paymentMethod,
            } : null,
        }));

        return { data, total };
    }

    /**
     * Search users by case-insensitive email substring, each with their current
     * subscription (1 per user). Capped at 20 matches.
     */
    async searchByEmail(email: string) {
        const foundUsers = await db
            .select({
                id: users.id,
                email: users.email,
                name: users.name,
                facebookId: users.facebookId,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(ilike(users.email, `%${email.trim()}%`))
            .limit(20);

        return Promise.all(
            foundUsers.map(async (user) => {
                const [subscription] = await db
                    .select({
                        id: subscriptions.id,
                        status: subscriptions.status,
                        planId: subscriptions.planId,
                        planName: plans.name,
                        planSlug: plans.slug,
                        currentPeriodStart: subscriptions.currentPeriodStart,
                        currentPeriodEnd: subscriptions.currentPeriodEnd,
                        paymentMethod: subscriptions.paymentMethod,
                    })
                    .from(subscriptions)
                    .leftJoin(plans, eq(subscriptions.planId, plans.id))
                    .where(eq(subscriptions.userId, user.id))
                    .limit(1);

                return { ...user, subscription: subscription || null };
            }),
        );
    }

    /**
     * Single-user detail aggregation: profile, AI-model override, subscription
     * with plan limits, pages with reply state, current-period usage, configured
     * Post Replies count, lead stats, and workspace memberships.
     *
     * Returns `null` when the user does not exist (controller maps to 404).
     */
    async getUserDetail(userId: string) {
        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                name: users.name,
                phone: users.phone,
                facebookId: users.facebookId,
                createdAt: users.createdAt,
                topupBalance: users.topupBalance,
                lastSeenAt: users.lastSeenAt,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (!user) return null;

        // The blocks below are independent lookups keyed on userId — run them
        // concurrently instead of awaiting each in sequence (this endpoint used
        // to pay ~6 serial round-trips before any dependent work).
        const now = new Date();
        const [settingsRows, subscriptionRows, userPages, currentUsageRows, membershipRows] = await Promise.all([
            // Full settings row the support console reads (persona, toggles,
            // messages). Top-level aiModel stays derived from this below.
            db
            .select({
                aiEnabled: settings.aiEnabled,
                aiModel: settings.aiModel,
                commentsAutoReply: settings.commentsAutoReply,
                messagesAutoReply: settings.messagesAutoReply,
                commentReplyMode: settings.commentReplyMode,
                holdLowConfidence: settings.holdLowConfidence,
                businessHoursOnly: settings.businessHoursOnly,
                businessHoursStart: settings.businessHoursStart,
                businessHoursEnd: settings.businessHoursEnd,
                timezone: settings.timezone,
                replyStyle: settings.replyStyle,
                // D-085: the support console lists this read-only. Selecting it
                // here is what makes the row real — the frontend key list alone
                // renders an empty value (the reader half of the change).
                replyMode: settings.replyMode,
                brandVoiceNotes: settings.brandVoiceNotes,
                brandVoiceNotesMulti: settings.brandVoiceNotesMulti,
                greetingMessageEnabled: settings.greetingMessageEnabled,
                greetingMessageMulti: settings.greetingMessageMulti,
                awayMessageMulti: settings.awayMessageMulti,
                limitFallbackEnabled: settings.limitFallbackEnabled,
                replyDelay: settings.replyDelay,
                defaultReplyLanguage: settings.defaultReplyLanguage,
                supportedLanguages: settings.supportedLanguages,
                autoDetectLanguage: settings.autoDetectLanguage,
                newLeadAlertsEnabled: settings.newLeadAlertsEnabled,
                notificationsEnabled: settings.notificationsEnabled,
                onboardingCompletedAt: settings.onboardingCompletedAt,
                createdAt: settings.createdAt,
                updatedAt: settings.updatedAt,
            })
            .from(settings)
            .where(eq(settings.userId, userId))
            .limit(1),

            // Subscription with plan limits
            db
            .select({
                id: subscriptions.id,
                status: subscriptions.status,
                planId: subscriptions.planId,
                planName: plans.name,
                planSlug: plans.slug,
                currentPeriodStart: subscriptions.currentPeriodStart,
                currentPeriodEnd: subscriptions.currentPeriodEnd,
                paymentMethod: subscriptions.paymentMethod,
                trialEndsAt: subscriptions.trialEndsAt,
                maxAiRepliesPerMonth: plans.maxAiRepliesPerMonth,
                maxPages: plans.maxPages,
            })
            .from(subscriptions)
            .leftJoin(plans, eq(subscriptions.planId, plans.id))
            .where(eq(subscriptions.userId, userId))
            .limit(1),

            // Pages with identifying info + reply state, so support can answer
            // "why isn't this customer getting replies?" at a glance.
            db
            .select({
                id: pages.id,
                name: pages.name,
                // Feeds resolvePipelineWorkspaceId only (destructured out of the
                // payload below) — the pipeline keys settings on page.workspaceId.
                workspaceId: pages.workspaceId,
                facebookPageId: pages.facebookPageId,
                instagramUsername: pages.instagramUsername,
                instagramAccountId: pages.instagramAccountId,
                whatsappPhoneNumberId: pages.whatsappPhoneNumberId,
                whatsappDisplayPhoneNumber: pages.whatsappDisplayPhoneNumber,
                whatsappAutoReplyEnabled: pages.whatsappAutoReplyEnabled,
                whatsappCoexistence: pages.whatsappCoexistence,
                whatsappDisconnectReason: pages.whatsappDisconnectReason,
                autoReplyEnabled: pages.autoReplyEnabled,
                autoReplyDisabledReason: pages.autoReplyDisabledReason,
                // "Is this card's PRIMARY credential valid?" — one of THREE twins:
                // serializePage in controllers/pages.ts and the isPageDisconnected
                // predicate in services/pages.ts express the same rule. Change one,
                // change all three. Keying this on the Facebook token alone
                // reported every healthy WhatsApp-only card (facebook_page_id NULL,
                // access_token NULL by definition) as disconnected, which sent
                // support hunting a fault that was never there.
                disconnected: sql<boolean>`CASE WHEN ${pages.facebookPageId} IS NOT NULL
                        THEN (${pages.accessToken} IS NULL OR ${pages.accessToken} = '')
                        ELSE ((${pages.whatsappAccessToken} IS NULL OR ${pages.whatsappAccessToken} = '')
                          AND (${pages.instagramAccessToken} IS NULL OR ${pages.instagramAccessToken} = ''))
                    END`,
                disconnectReason: pages.disconnectReason,
                // Merchant soft-hid this disconnected page: it is gone from THEIR
                // channels screen but still fully present here, so support never
                // reads an archived page as "missing".
                archivedAt: pages.archivedAt,
                // KB summary lives under `kb` in the payload; select the raw
                // inputs here (length only — never ship the KB text itself).
                // The per-page PIN. Support needs it because the effective mode
                // is page-then-workspace: 3 of the 4 info-pinned prod pages sit
                // under a 'sales' workspace default (2026-08-20), so a console
                // showing only the workspace value tells support "sales" for a
                // page running INFO-DESK — and the ticket that brings them here
                // is «توقف عن أخذ أرقام الزبائن». Before D-087 the allowlist was
                // the fallback answer ("only two workspaces can have it"); GA
                // removed that, so this is now the only answer.
                replyMode: pages.replyMode,
                // The per-page PERSONA pin (D-084) — same inheritance trap as
                // replyMode above, and worse in one way: a page pin suppresses
                // the workspace persona ENTIRELY (resolveBrandVoiceNotes returns
                // within the override, no workspace fallback), so the persona the
                // Settings tab prints can be text no customer of this page ever
                // sees. Shipped as the raw jsonb because the workspace persona is
                // already shown in full there and «الردود بتحكي بلهجة غلط» is
                // unanswerable without reading the text that actually applies.
                brandVoiceNotesMulti: pages.brandVoiceNotesMulti,
                // Drives the RAG-vs-full-KB branch in resolveKnowledge (a store
                // OR merchant catalog_items sends the page down the retrieval
                // path), which is what makes a stale chunk set matter.
                ecommerceStoreId: pages.ecommerceStoreId,
                kbLength: sql<number>`length(coalesce(${pages.knowledgeBase}, ''))`,
                kbActiveVersion: pages.kbActiveVersion,
                kbUpdatedAt: pages.kbUpdatedAt,
                // The structured profile, counted in TS rather than SQL so the
                // console uses the PROMPT's own definition of "this profile holds
                // facts" (countBusinessInfoFacts) instead of a second one.
                //
                // A raw key count — which this was, until the self-review — is
                // that wrong second definition: the modal live page carries
                // exactly `name`, `category`, `language_hint` and
                // `website`/`about` (24 of 92 on prod, 2026-08-20), every one of
                // them page metadata that answers no customer question and
                // contributes no BUSINESS_INFO line. Counting them reports "4
                // fields of Business Info" for a page holding none, which is the
                // OVER-claiming direction of the very defect this PR fixes.
                // Never read as content on the client — only the derived count
                // ships (see the `kb` payload below).
                businessProfile: pages.businessProfile,
            })
            .from(pages)
            .where(eq(pages.userId, userId)),

            // Current period usage
            db
            .select({
                aiRepliesCount: usage.aiRepliesCount,
                periodStart: usage.periodStart,
                periodEnd: usage.periodEnd,
            })
            .from(usage)
            .where(
                and(
                    eq(usage.userId, userId),
                    lte(usage.periodStart, now),
                    gte(usage.periodEnd, now),
                ),
            )
            .limit(1),

            // Workspace memberships joined to each workspace + its owner.
            db
            .select({
                workspaceId: workspaces.id,
                workspaceName: workspaces.name,
                role: workspaceMembers.role,
                ownerId: workspaces.ownerId,
                ownerName: users.name,
                ownerEmail: users.email,
            })
            .from(workspaceMembers)
            .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
            .innerJoin(users, eq(workspaces.ownerId, users.id))
            .where(eq(workspaceMembers.userId, userId))
            .orderBy(workspaces.createdAt),
        ]);
        const settingsRow = settingsRows[0];
        // aiModel stays legacy-derived on purpose: the admin override below
        // writes the legacy table, and aiModelResolver reads it back — legacy
        // is authoritative for this one field (see WORKSPACE_OVERLAY_FIELDS).
        const aiModel: string | null = settingsRow?.aiModel ?? null;
        const subscription = subscriptionRows[0];
        const currentUsage = currentUsageRows[0];

        // Lead stats — capture leads from pages owned directly by user OR by any
        // workspace this user belongs to (covers shared workspaces).
        let leadStats = {
            total: 0,
            today: 0,
            last7d: 0,
            last30d: 0,
            byStatus: { new: 0, contacted: 0, converted: 0 },
        };

        const workspaceIds = membershipRows.map(r => r.workspaceId);
        // KB health is summarised for the pages the console displays (owned
        // directly by this user).
        const displayPageIds = userPages.map(p => p.id);

        // Member count per workspace (single grouped query, no N+1), the
        // owned-pages lookup, and the per-page KB summaries all run concurrently.
        // Chunk counts pin to each page's ACTIVE kb version (a null active
        // version matches no rows → kb reads as empty, same as adminKbService).
        //
        // ⚠️ A zero here does NOT mean "this page has no Business Info", and
        // reading it that way is the defect this batch was widened to fix
        // (2026-08-20). Since Business Info became STRUCTURED, three writers bump
        // kbActiveVersion WITHOUT re-ingesting chunks — updatePage's
        // business_profile branch, and invalidatePageCaches from
        // services/catalog.ts + services/factCollections.ts. The active version
        // then runs ahead of the newest chunk set and this join matches nothing,
        // while knowledge_base still holds every character the merchant typed.
        // Measured on prod the day this was fixed: 49 of 92 live pages, e.g.
        // «Shahin Resort» at active v54 vs newest chunks v51, 10,494 KB chars and
        // 10 filled business_profile fields — all reported as EMPTY.
        // So chunks are now one signal among four, and `newestChunkVersion` below
        // exists to tell "never ingested" apart from "ingested, then outrun".
        const [
            countRows, ownedPageIdsRows, kbChunkRows, kbGapRows,
            kbNewestChunkRows, catalogCountRows, factCountRows,
        ] = await Promise.all([
            workspaceIds.length > 0
                ? db
                    .select({
                        workspaceId: workspaceMembers.workspaceId,
                        count: sql<number>`count(*)::int`,
                    })
                    .from(workspaceMembers)
                    .where(inArray(workspaceMembers.workspaceId, workspaceIds))
                    .groupBy(workspaceMembers.workspaceId)
                : Promise.resolve([]),
            db
                .select({ id: pages.id })
                .from(pages)
                .where(
                    workspaceIds.length > 0
                        ? sql`${pages.userId} = ${userId} OR ${pages.workspaceId} IN (${sql.join(workspaceIds.map(w => sql`${w}`), sql`, `)})`
                        : eq(pages.userId, userId),
                ),
            displayPageIds.length > 0
                ? db
                    .select({
                        pageId: kbChunks.pageId,
                        type: kbChunks.type,
                        count: sql<number>`count(*)::int`,
                    })
                    .from(kbChunks)
                    .innerJoin(pages, and(
                        eq(pages.id, kbChunks.pageId),
                        eq(kbChunks.kbVersion, pages.kbActiveVersion),
                    ))
                    .where(inArray(kbChunks.pageId, displayPageIds))
                    .groupBy(kbChunks.pageId, kbChunks.type)
                : Promise.resolve([]),
            displayPageIds.length > 0
                ? db
                    .select({
                        pageId: kbGaps.pageId,
                        count: sql<number>`count(*)::int`,
                    })
                    .from(kbGaps)
                    .where(and(inArray(kbGaps.pageId, displayPageIds), eq(kbGaps.resolved, false)))
                    .groupBy(kbGaps.pageId)
                : Promise.resolve([]),
            // Newest chunk version REGARDLESS of the active pointer. Compared
            // against kbActiveVersion this separates the two zero-chunk causes,
            // which need opposite actions: no rows at all = never ingested (KB
            // text was never saved, or ingestion failed), versus a version behind
            // the pointer = ingested fine, then a structured-info write moved the
            // pointer past it (the 49-page class; harmless for the full-KB path,
            // a silent retrieval miss on the RAG path).
            displayPageIds.length > 0
                ? db
                    .select({
                        pageId: kbChunks.pageId,
                        maxVersion: sql<number>`max(${kbChunks.kbVersion})::int`,
                    })
                    .from(kbChunks)
                    .where(inArray(kbChunks.pageId, displayPageIds))
                    .groupBy(kbChunks.pageId)
                : Promise.resolve([]),
            // Merchant-authored catalog items — the <product_catalog> block, which
            // carries explicit AUTHORITY over <business_knowledge> in the prompt.
            // A page whose whole Business Info is a price list lives here and
            // nowhere else, so omitting it is how a fully-configured page reads
            // as empty.
            displayPageIds.length > 0
                ? db
                    .select({
                        pageId: catalogItems.pageId,
                        count: sql<number>`count(*)::int`,
                    })
                    .from(catalogItems)
                    .where(inArray(catalogItems.pageId, displayPageIds))
                    .groupBy(catalogItems.pageId)
                : Promise.resolve([]),
            // Fact collections + their rows (G1) — outlet directories, delivery
            // zones, branch lists. Counted per page via the collection's page_id;
            // rows are counted in the same pass so support sees an EMPTY
            // collection (a shell that renders no facts) as distinct from a
            // populated one.
            displayPageIds.length > 0
                ? db
                    .select({
                        pageId: factCollections.pageId,
                        collections: sql<number>`count(DISTINCT ${factCollections.id})::int`,
                        rows: sql<number>`count(${factRows.id})::int`,
                    })
                    .from(factCollections)
                    .leftJoin(factRows, eq(factRows.collectionId, factCollections.id))
                    .where(inArray(factCollections.pageId, displayPageIds))
                    .groupBy(factCollections.pageId)
                : Promise.resolve([]),
        ]);
        const memberCounts = new Map<string, number>();
        for (const r of countRows) {
            memberCounts.set(r.workspaceId, r.count);
        }

        // Fold chunk rows into per-page { total, byType } and gaps into a count map.
        const chunksByPage = new Map<string, { total: number; byType: Record<string, number> }>();
        for (const r of kbChunkRows) {
            const entry = chunksByPage.get(r.pageId) ?? { total: 0, byType: {} };
            entry.byType[r.type] = (entry.byType[r.type] ?? 0) + r.count;
            entry.total += r.count;
            chunksByPage.set(r.pageId, entry);
        }
        const gapsByPage = new Map<string, number>();
        for (const r of kbGapRows) {
            gapsByPage.set(r.pageId, r.count);
        }
        const newestChunkByPage = new Map<string, number>();
        for (const r of kbNewestChunkRows) {
            newestChunkByPage.set(r.pageId, r.maxVersion);
        }
        const catalogByPage = new Map<string, number>();
        for (const r of catalogCountRows) {
            catalogByPage.set(r.pageId, r.count);
        }
        const factsByPage = new Map<string, { collections: number; rows: number }>();
        for (const r of factCountRows) {
            factsByPage.set(r.pageId, { collections: r.collections, rows: r.rows });
        }

        // Nest the KB summary under `kb`, keeping the length-only inputs off the
        // top-level page object.
        const pagesPayload = userPages.map(p => {
            const {
                kbLength, kbActiveVersion, kbUpdatedAt, businessProfile,
                ecommerceStoreId, workspaceId: _workspaceId, ...rest
            } = p;
            const c = chunksByPage.get(p.id);
            const facts = factsByPage.get(p.id);
            const newestChunkVersion = newestChunkByPage.get(p.id) ?? null;
            const chunksTotal = c?.total ?? 0;
            const catalogItemCount = catalogByPage.get(p.id) ?? 0;
            const factRowCount = facts?.rows ?? 0;
            // `unwrapBusinessProfile` handles the double-encoded-jsonb case this
            // column family has precedent for, and splits the merchant half from
            // the FB suggestions — only the merchant half is Business Info.
            const profile = unwrapBusinessProfile(businessProfile as StoredBusinessProfile);
            const businessProfileFacts = countBusinessInfoFacts(profile.merchant, profile.merchantProvenance);
            return {
                ...rest,
                kb: {
                    kbLength: kbLength ?? 0,
                    kbActiveVersion,
                    kbUpdatedAt,
                    chunksTotal,
                    chunksByType: c?.byType ?? {},
                    unresolvedGaps: gapsByPage.get(p.id) ?? 0,
                    // The structured stores, so "empty" can be decided from every
                    // source the prompt actually reads instead of from chunks alone.
                    businessProfileFields: businessProfileFacts,
                    catalogItems: catalogItemCount,
                    factCollections: facts?.collections ?? 0,
                    factRows: factRowCount,
                    newestChunkVersion,
                    // Ingested once, then outrun by a pointer bump. Deliberately
                    // NOT "has no chunks": a page that never ingested has nothing
                    // stale, it has nothing at all.
                    chunksStale: chunksTotal === 0
                        && newestChunkVersion !== null
                        && kbActiveVersion !== null
                        && newestChunkVersion < kbActiveVersion,
                    // Whether a stale chunk set actually costs this page anything.
                    // resolveKnowledge only retrieves for pages with a store OR
                    // merchant catalog items; every other page is handed the full
                    // KB text and never reads a chunk (D-050). On the retrieval
                    // path an empty result still falls back to the full KB, so the
                    // cost is a wasted embedding round-trip per reply, not silence.
                    onRetrievalPath: !!ecommerceStoreId || catalogItemCount > 0,
                    // The one honest answer to "does the AI have anything to
                    // answer from?" — false only when EVERY store is empty.
                    // Derived by the same function the health flags use, so the
                    // console's badge and its banner cannot contradict each other.
                    hasAnyContent: hasBusinessInfoContent({
                        kbLength: kbLength ?? 0,
                        businessProfileFields: businessProfileFacts,
                        catalogItems: catalogItemCount,
                        factRows: factRowCount,
                    }),
                },
            };
        });

        // isOwner is derived from the workspace's owner_id FK (authoritative).
        const workspacesPayload = membershipRows.map(r => ({
            id: r.workspaceId,
            name: r.workspaceName,
            role: r.role as 'owner' | 'admin' | 'member',
            ownerId: r.ownerId,
            ownerName: r.ownerName,
            ownerEmail: r.ownerEmail,
            isOwner: r.ownerId === userId,
            memberCount: memberCounts.get(r.workspaceId) ?? 1,
        }));

        const ownedPageIds = ownedPageIdsRows.map(r => r.id);

        // Post Replies actually SENT (replyMethod = 'post_reply'), across FB comments,
        // IG comments and DMs — the same definition the dashboard uses (services/pages.ts).
        // NOT the count of configured trigger rules, and scoped to owned pages
        // (direct + workspace) so workspace-owned pages are not silently zeroed.
        // Runs together with the lead stats aggregation — all four depend only
        // on ownedPageIds.
        let postRepliesCount = 0;
        if (ownedPageIds.length > 0) {
            const startOfToday = new Date(now);
            startOfToday.setHours(0, 0, 0, 0);
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            const [fbPR, igPR, dmPR, leadAggRows] = await Promise.all([
                db.select({ count: sql<number>`count(*)::int` })
                    .from(comments)
                    .innerJoin(posts, eq(comments.postId, posts.id))
                    .where(and(
                        inArray(posts.pageId, ownedPageIds),
                        eq(comments.replied, true),
                        eq(comments.replyMethod, 'post_reply'),
                    )),
                db.select({ count: sql<number>`count(*)::int` })
                    .from(instagramComments)
                    .innerJoin(instagramMedia, eq(instagramComments.mediaId, instagramMedia.id))
                    .where(and(
                        inArray(instagramMedia.pageId, ownedPageIds),
                        eq(instagramComments.replied, true),
                        eq(instagramComments.replyMethod, 'post_reply'),
                    )),
                db.select({ count: sql<number>`count(*)::int` })
                    .from(messages)
                    .where(and(
                        inArray(messages.pageId, ownedPageIds),
                        eq(messages.direction, 'incoming'),
                        eq(messages.replied, true),
                        eq(messages.replyMethod, 'post_reply'),
                    )),
                db
                    .select({
                        total: sql<number>`count(*)::int`,
                        today: sql<number>`count(*) filter (where ${leads.createdAt} >= ${startOfToday})::int`,
                        last7d: sql<number>`count(*) filter (where ${leads.createdAt} >= ${sevenDaysAgo})::int`,
                        last30d: sql<number>`count(*) filter (where ${leads.createdAt} >= ${thirtyDaysAgo})::int`,
                        statusNew: sql<number>`count(*) filter (where ${leads.status} = 'new')::int`,
                        statusContacted: sql<number>`count(*) filter (where ${leads.status} = 'contacted')::int`,
                        statusConverted: sql<number>`count(*) filter (where ${leads.status} = 'converted')::int`,
                    })
                    .from(leads)
                    .where(inArray(leads.pageId, ownedPageIds)),
            ]);
            postRepliesCount = (fbPR[0]?.count || 0) + (igPR[0]?.count || 0) + (dmPR[0]?.count || 0);

            const agg = leadAggRows[0];
            leadStats = {
                total: agg?.total || 0,
                today: agg?.today || 0,
                last7d: agg?.last7d || 0,
                last30d: agg?.last30d || 0,
                byStatus: {
                    new: agg?.statusNew || 0,
                    contacted: agg?.statusContacted || 0,
                    converted: agg?.statusConverted || 0,
                },
            };
        }

        // Owns no pages but belongs to someone else's workspace. The workspace
        // overlay below still resolves that workspace's pipeline fields (the
        // values actually driving its replies), but the legacy-only fields
        // (notifications, lead alerts, timestamps) are this member's own row —
        // the info flag points support at the owner for those.
        const isTeamMemberOnly = userPages.length === 0 && workspacesPayload.some(w => !w.isOwner);
        const usageLimit = subscription?.maxAiRepliesPerMonth || null;

        // The reply pipeline reads pipeline fields from the workspace JSONB
        // (D-026), not the legacy row selected above — and a new signup seeds
        // auto-reply OFF into the JSONB only, so the raw legacy row claims the
        // toggles are ON while the pipeline drops every message. Overlay the
        // workspace store so the console (values, non-default markers, health
        // flags) reports what the pipeline actually obeys. The workspace is
        // resolved from the displayed pages' own workspaceId (what the pipeline
        // keys on), falling back to memberships — see resolvePipelineWorkspaceId.
        // Fails open to the legacy row — a workspace-store hiccup must never
        // 500 the support console — but the payload then says so via
        // `settings.source`, because a silent fallback re-creates exactly the
        // misleading state this overlay exists to kill.
        let effectiveSettings: SupportSettings | null = settingsRow ?? null;
        let settingsSource: 'effective' | 'legacy-fallback' = 'legacy-fallback';
        const pipelineWorkspaceId = resolvePipelineWorkspaceId(
            userPages.map(p => p.workspaceId),
            membershipRows,
            userId,
        );
        if (settingsRow && pipelineWorkspaceId) {
            try {
                const wsSettings = await workspaceSettingsService.getSettings(pipelineWorkspaceId);
                effectiveSettings = overlayPipelineSettings(settingsRow, wsSettings as unknown as Record<string, unknown>);
                settingsSource = 'effective';
            } catch (error) {
                captureError(error, 'admin getUserDetail workspace-settings overlay failed', {
                    tags: { context: 'admin', action: 'workspace-settings-overlay' },
                    extra: { userId, workspaceId: pipelineWorkspaceId },
                });
            }
        } else if (settingsRow) {
            // A settings row with no resolvable workspace is itself an anomaly
            // (signup always creates one) — surface it instead of silently
            // showing legacy values as if they were the pipeline truth.
            captureError(
                new Error('settings row present but no resolvable workspace'),
                'admin getUserDetail: no pipeline workspace to overlay',
                {
                    tags: { context: 'admin', action: 'workspace-settings-overlay' },
                    extra: { userId },
                },
            );
        }

        // The mode each page will actually RUN with: its own pin, else the
        // workspace default from the overlay above — resolved through the same
        // `resolveEffectiveReplyMode` the reply pipeline calls, never a second
        // expression of the rule. `replyMode` travels alongside it so support can
        // tell a deliberate PIN from an inherited default: a page reading info
        // because it inherited is fixed on the workspace, a pinned one is not.
        const workspaceReplyMode = (effectiveSettings as { replyMode?: string } | null)?.replyMode;
        const pagesWithReplyMode = pagesPayload.map(p => ({
            ...p,
            replyModeEffective: resolveEffectiveReplyMode(p.replyMode, workspaceReplyMode),
        }));

        // THE gate verdict, from the same predicate enforceAutoReplyGate blocks on.
        // The console must never form its own opinion of "is this account replying?"
        // — that is how it showed 🟢 active through a manual expiry that had frozen
        // every reply, and why the fleet-wide past_due suspension survived a month.
        const entitlement = subscription
            ? subscriptionsService.checkSubscriptionStatus({
                status: (subscription.status ?? 'active') as SubscriptionStatus,
                paymentMethod: subscription.paymentMethod,
                currentPeriodEnd: subscription.currentPeriodEnd,
                trialEndsAt: subscription.trialEndsAt,
            })
            : null;
        const entitlementEndsAt = subscription ? resolveEntitlementEnd(subscription) : null;

        const health = computeHealthFlags({
            now,
            lastSeenAt: user.lastSeenAt,
            settings: effectiveSettings,
            subscription: subscription
                ? {
                    status: subscription.status,
                    trialEndsAt: subscription.trialEndsAt,
                    autoReplyAllowed: entitlement?.allowed ?? true,
                }
                : null,
            pages: pagesWithReplyMode.map(p => ({
                id: p.id,
                name: p.name,
                disconnected: p.disconnected,
                autoReplyEnabled: p.autoReplyEnabled,
                autoReplyDisabledReason: p.autoReplyDisabledReason,
                replyMode: p.replyMode,
                replyModeEffective: p.replyModeEffective,
                // A page pin makes the workspace persona unreachable for this
                // page, so the persona flags must be scoped by it.
                brandVoiceNotesMulti: p.brandVoiceNotesMulti,
                kb: p.kb,
            })),
            usage: {
                aiRepliesCount: currentUsage?.aiRepliesCount || 0,
                limit: usageLimit,
                // Top-up balance decides whether the cap is a wall or just a
                // billing boundary — see the usage block in computeHealthFlags.
                topupBalance: user.topupBalance ?? 0,
            },
            isTeamMemberOnly,
        });

        return {
            ...user,
            aiModel,
            settings: effectiveSettings
                ? {
                    values: effectiveSettings,
                    nonDefaultKeys: computeNonDefaultKeys(effectiveSettings),
                    // 'legacy-fallback' = the overlay didn't run; the values are
                    // the raw legacy row and may not match the pipeline. The
                    // console renders a warning off this — never drop it silently.
                    source: settingsSource,
                }
                : null,
            subscription: subscription
                ? {
                    ...subscription,
                    // Support reads THIS, not `status`. `entitlementEndsAt` is the
                    // snapped boundary the gate enforces — for a manual plan it is up
                    // to ~24h before `currentPeriodEnd`, which is the raw instant the
                    // console used to print as the coverage end.
                    autoReply: { allowed: entitlement?.allowed ?? true, code: entitlement?.code },
                    entitlementEndsAt,
                }
                : null,
            pages: pagesWithReplyMode,
            usage: currentUsage ? {
                aiRepliesCount: currentUsage.aiRepliesCount || 0,
                postRepliesCount,
                periodStart: currentUsage.periodStart,
                periodEnd: currentUsage.periodEnd,
                limit: usageLimit,
            } : {
                aiRepliesCount: 0,
                postRepliesCount,
                periodStart: null,
                periodEnd: null,
                limit: usageLimit,
            },
            leads: leadStats,
            workspaces: workspacesPayload,
            health,
        };
    }

    /**
     * Set or clear a user's per-workspace AI model override. Reads the previous
     * value, upserts settings, and writes the audit log atomically in one
     * transaction (so a concurrent admin click can't observe a stale `from`, and
     * a failed audit insert rolls back the change). Throws NotFoundError (404) if
     * the target user is missing. Returns the previous model so the caller can do
     * cache invalidation + structured logging outside the transaction.
     */
    async setAiModel(userId: string, model: string | null, adminUserId: string | undefined): Promise<{ previousModel: string | null }> {
        const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
        if (!target) {
            throw new NotFoundError('User not found');
        }

        let previousModel: string | null = null;
        await db.transaction(async (tx) => {
            const [existing] = await tx
                .select({ aiModel: settings.aiModel })
                .from(settings)
                .where(eq(settings.userId, userId))
                .limit(1);
            previousModel = existing?.aiModel ?? null;

            await tx
                .insert(settings)
                .values({ userId, aiModel: model })
                .onConflictDoUpdate({ target: settings.userId, set: { aiModel: model } });

            await tx.insert(adminAuditLogs).values({
                adminUserId,
                targetUserId: userId,
                action: 'ai_model_changed',
                previousValue: { aiModel: previousModel },
                newValue: { aiModel: model },
            });
        });

        return { previousModel };
    }

    /**
     * Send an admin-composed support/account-notice email to a single merchant.
     * Reuses the shared email transport (Resend + email_sends audit + rate
     * limiting); records the admin action in adminAuditLogs for accountability.
     * Throws NotFoundError (404) if the user is missing, ValidationError (400)
     * if they have no email on file, ExternalServiceError (502) if delivery
     * fails.
     */
    async sendMerchantEmail(
        userId: string,
        input: {
            subject: string;
            body: string;
            cc?: string[];
            bcc?: string[];
            attachments?: EmailAttachment[];
            idempotencyKey?: string;
        },
        adminUserId: string | undefined,
    ): Promise<{ emailSendId?: string }> {
        const [target] = await db
            .select({ id: users.id, email: users.email, name: users.name })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        if (!target) {
            throw new NotFoundError('User not found');
        }
        if (!target.email) {
            throw new ValidationError('This merchant has no email address on file');
        }

        const { subject, html } = accountNoticeEmailTemplate({
            name: target.name,
            subject: input.subject,
            body: input.body,
        });

        // One decode per attachment serves three needs: the sha256 + byte size
        // for the audit row (so a later-presented copy — the merchant's or the
        // CC'd rep's — is verifiable against our record), and the MIME type
        // from the verified magic bytes (so Resend never infers a content type
        // from an admin-chosen filename). Validation already pinned the magic
        // bytes to the extension; a null sniff here is therefore impossible,
        // but degrade to an omitted contentType rather than throw.
        const attachmentRecords = (input.attachments ?? []).map((a) => {
            const bytes = Buffer.from(a.content, 'base64');
            const ext = a.filename.split('.').pop()?.toLowerCase() ?? '';
            return {
                attachment: {
                    ...a,
                    contentType: sniffAttachmentMime(ext, Uint8Array.from(bytes.subarray(0, 16))) ?? undefined,
                },
                audit: {
                    filename: a.filename,
                    size: bytes.length,
                    sha256: createHash('sha256').update(bytes).digest('hex'),
                },
            };
        });

        const result = await emailService.send({
            to: target.email,
            subject,
            html,
            type: 'account_notice',
            userId,
            cc: input.cc,
            bcc: input.bcc,
            attachments: attachmentRecords.length ? attachmentRecords.map((r) => r.attachment) : undefined,
            idempotencyKey: input.idempotencyKey,
        });

        if (!result.success) {
            throw new ExternalServiceError('Email', result.error || 'Failed to send email');
        }

        // Accountability: who emailed whom, and about what. email_sends already
        // stores the rendered body; this records the acting admin. Audit failure
        // must never turn a delivered email into an error.
        try {
            await db.insert(adminAuditLogs).values({
                adminUserId,
                targetUserId: userId,
                action: 'merchant_email_sent',
                // Store subject AND body: email_sends.html_body is blanked after
                // 30 days, so this is the durable record of "what did we tell them?"
                // for any later support dispute (audit rows are exempt).
                //
                // Recipients and per-attachment {filename, size, sha256} are
                // recorded too — "who else saw this?" and "are these the bytes
                // we sent?" are exactly what a dispute asks, and email_sends
                // has no cc/bcc columns. The hash makes any later-presented
                // copy verifiable without storing the bytes themselves.
                // emailSendId joins this row to its email_sends row.
                newValue: {
                    subject: input.subject,
                    body: input.body,
                    emailSendId: result.emailSendId,
                    ...(input.cc?.length ? { cc: input.cc } : {}),
                    ...(input.bcc?.length ? { bcc: input.bcc } : {}),
                    ...(attachmentRecords.length
                        ? { attachments: attachmentRecords.map((r) => r.audit) }
                        : {}),
                },
            });
        } catch (err) {
            captureError(err, 'Failed to write admin audit log for merchant email', {
                tags: { service: 'admin-users', action: 'merchant_email_sent' },
            });
        }

        return { emailSendId: result.emailSendId };
    }
}

export const adminUsersService = new AdminUsersService();
