import { db } from '../../db';
import {
    users, subscriptions, plans, pages, usage, posts, instagramMedia,
    leads, workspaces, workspaceMembers, settings, adminAuditLogs,
} from '../../db/schema';
import { eq, ilike, desc, and, gte, lte, sql, isNotNull, inArray, or, type SQL } from 'drizzle-orm';
import { NotFoundError } from '../../utils/errors';

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
    facebookId: string | null;
    createdAt: Date | null;
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
                })
                .from(users)
                .leftJoin(subscriptions, eq(users.id, subscriptions.userId))
                .leftJoin(plans, eq(subscriptions.planId, plans.id))
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
            facebookId: u.facebookId,
            createdAt: u.createdAt,
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
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (!user) return null;

        // Per-workspace AI model override (null = follows DEFAULT_AI_MODEL).
        const [settingsRow] = await db
            .select({ aiModel: settings.aiModel })
            .from(settings)
            .where(eq(settings.userId, userId))
            .limit(1);
        const aiModel: string | null = settingsRow?.aiModel ?? null;

        // Subscription with plan limits
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
                trialEndsAt: subscriptions.trialEndsAt,
                maxAiRepliesPerMonth: plans.maxAiRepliesPerMonth,
                maxPages: plans.maxPages,
            })
            .from(subscriptions)
            .leftJoin(plans, eq(subscriptions.planId, plans.id))
            .where(eq(subscriptions.userId, userId))
            .limit(1);

        // Pages with identifying info + reply state, so support can answer
        // "why isn't this customer getting replies?" at a glance.
        const userPages = await db
            .select({
                id: pages.id,
                name: pages.name,
                facebookPageId: pages.facebookPageId,
                instagramUsername: pages.instagramUsername,
                instagramAccountId: pages.instagramAccountId,
                autoReplyEnabled: pages.autoReplyEnabled,
                autoReplyDisabledReason: pages.autoReplyDisabledReason,
                disconnected: sql<boolean>`(${pages.accessToken} IS NULL OR ${pages.accessToken} = '')`,
            })
            .from(pages)
            .where(eq(pages.userId, userId));

        // Current period usage
        const now = new Date();
        const [currentUsage] = await db
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
            .limit(1);

        // Count configured Post Replies (per-post keyword triggers) across user's pages
        const pageIds = userPages.map(p => p.id);
        let postRepliesCount = 0;
        if (pageIds.length > 0) {
            const [fbCount] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(posts)
                .where(and(inArray(posts.pageId, pageIds), isNotNull(posts.triggerReply)));
            const [igCount] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(instagramMedia)
                .where(and(inArray(instagramMedia.pageId, pageIds), isNotNull(instagramMedia.triggerReply)));
            postRepliesCount = (fbCount?.count || 0) + (igCount?.count || 0);
        }

        // Lead stats — capture leads from pages owned directly by user OR by any
        // workspace this user belongs to (covers shared workspaces).
        let leadStats = {
            total: 0,
            today: 0,
            last7d: 0,
            last30d: 0,
            byStatus: { new: 0, contacted: 0, converted: 0 },
        };

        // Workspace memberships joined to each workspace + its owner.
        const membershipRows = await db
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
            .orderBy(workspaces.createdAt);
        const workspaceIds = membershipRows.map(r => r.workspaceId);

        // Member count per workspace — single grouped query, no N+1.
        const memberCounts = new Map<string, number>();
        if (workspaceIds.length > 0) {
            const countRows = await db
                .select({
                    workspaceId: workspaceMembers.workspaceId,
                    count: sql<number>`count(*)::int`,
                })
                .from(workspaceMembers)
                .where(inArray(workspaceMembers.workspaceId, workspaceIds))
                .groupBy(workspaceMembers.workspaceId);
            for (const r of countRows) {
                memberCounts.set(r.workspaceId, r.count);
            }
        }

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

        const ownedPageIdsRows = await db
            .select({ id: pages.id })
            .from(pages)
            .where(
                workspaceIds.length > 0
                    ? sql`${pages.userId} = ${userId} OR ${pages.workspaceId} IN (${sql.join(workspaceIds.map(w => sql`${w}`), sql`, `)})`
                    : eq(pages.userId, userId),
            );
        const ownedPageIds = ownedPageIdsRows.map(r => r.id);

        if (ownedPageIds.length > 0) {
            const startOfToday = new Date(now);
            startOfToday.setHours(0, 0, 0, 0);
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            const [agg] = await db
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
                .where(inArray(leads.pageId, ownedPageIds));

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

        return {
            ...user,
            aiModel,
            subscription: subscription || null,
            pages: userPages,
            usage: currentUsage ? {
                aiRepliesCount: currentUsage.aiRepliesCount || 0,
                postRepliesCount,
                periodStart: currentUsage.periodStart,
                periodEnd: currentUsage.periodEnd,
                limit: subscription?.maxAiRepliesPerMonth || null,
            } : {
                aiRepliesCount: 0,
                postRepliesCount,
                periodStart: null,
                periodEnd: null,
                limit: subscription?.maxAiRepliesPerMonth || null,
            },
            leads: leadStats,
            workspaces: workspacesPayload,
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
}

export const adminUsersService = new AdminUsersService();
