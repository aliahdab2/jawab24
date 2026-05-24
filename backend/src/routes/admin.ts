import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { db } from '../db';
import { users, subscriptions, plans, adminAuditLogs, pages, usage, kbChunks, kbGaps, waitlistEmails, waitlistEmailSends, emailUnsubscribes, leadDigestSends, emailSends, posts, instagramMedia, leads, workspaceMembers } from '../db/schema';
import { eq, ilike, desc, and, gte, lte, sql, isNotNull, isNull, inArray } from 'drizzle-orm';
import { auth } from '../utils/swagger';
import { getIngestionService } from '../services/pages';
import { replyGenerator } from '../services/reply/generator';
import { buildPlaygroundContext } from '../services/reply/playgroundContext';
import type { PlaygroundSource } from '../types/aiPipeline';
import { config } from '../config';
import { emailService } from '../services/email';
import { waitlistEmailTemplate } from '../utils/emailTemplates';
import { WAITLIST_TEMPLATES } from '../utils/waitlistTemplates';
import { resolveRecipientLanguages } from '../utils/recipientLanguage';
import { generateUnsubscribeToken } from './waitlist';
import { runDailyLeadDigest } from '../services/leadDigest';
import { subscriptionsService } from '../services/subscriptions';
import { topupService, type TopupPack, type TopupSource, TopupUserNotFoundError, UnknownTopupPackError, DuplicateTopupError } from '../services/topup';
import { analyticsService, type AdminUserAiCostPeriod } from '../services/analytics';

const AI_COST_PERIODS: readonly AdminUserAiCostPeriod[] = ['7d', '30d', '90d', 'this_month', 'last_month'];

// Request body types
interface ManualUpgradeBody {
    planId: string;
    periodMonths: 1 | 3 | 6 | 12;
    paymentMethod: 'manual' | 'bank_transfer' | 'syrian_bank';
    paymentReference?: string;
    note?: string;
}

interface SearchUsersQuery {
    email?: string;
}

interface ListAllUsersQuery {
    page?: string;
    limit?: string;
    status?: string;
    plan?: string;
    search?: string;
}

/**
 * Admin Routes - Protected endpoints for manual subscription management
 * All routes require authentication + admin privileges
 */
export default async function adminRoutes(fastify: FastifyInstance) {
    // Apply authentication + admin check to all routes
    fastify.register(async (adminProtected) => {
        adminProtected.addHook('preHandler', authenticate);
        adminProtected.addHook('preHandler', requireAdmin);

        /**
         * GET /admin/users/all - List all users with pagination and filters
         * Query: ?page=1&limit=20&status=active&plan=pro&search=email
         */
        adminProtected.get<{ Querystring: ListAllUsersQuery }>(
            '/users/all',
            { schema: { tags: ['Admin'], summary: 'List all users with pagination and filters', security: auth } },
            async (request: FastifyRequest<{ Querystring: ListAllUsersQuery }>, reply: FastifyReply) => {
                const { 
                    page = '1', 
                    limit = '20', 
                    status, 
                    plan: planSlug, 
                    search 
                } = request.query;

                const pageNum = Math.max(1, parseInt(page, 10) || 1);
                const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
                const offset = (pageNum - 1) * limitNum;

                try {
                    // Build base query with subscriptions join
                    // We'll filter in memory for simplicity with the current schema
                    const baseQuery = db
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
                        // Active customers first, then trialing, then everything else by recency.
                        // Lower CASE value = higher priority.
                        .orderBy(
                            sql`CASE ${subscriptions.status}
                                WHEN 'active' THEN 0
                                WHEN 'trialing' THEN 1
                                WHEN 'past_due' THEN 2
                                WHEN 'paused' THEN 3
                                WHEN 'canceled' THEN 4
                                ELSE 5
                            END`,
                            desc(users.createdAt),
                        )
                        .limit(5000); // Safety cap — filters/pagination applied in-memory below

                    // Get all users first (we'll filter and paginate)
                    let allUsers = await baseQuery;

                    // Apply filters
                    if (search && search.trim().length > 0) {
                        const searchLower = search.trim().toLowerCase();
                        allUsers = allUsers.filter(u =>
                            u.email?.toLowerCase().includes(searchLower) ||
                            u.name?.toLowerCase().includes(searchLower) ||
                            u.phone?.toLowerCase().includes(searchLower)
                        );
                    }

                    if (status) {
                        allUsers = allUsers.filter(u => u.subscriptionStatus === status);
                    }

                    if (planSlug) {
                        allUsers = allUsers.filter(u => u.planSlug === planSlug);
                    }

                    // Get total count after filters
                    const totalCount = allUsers.length;

                    // Apply pagination
                    const paginatedUsers = allUsers.slice(offset, offset + limitNum);

                    // Transform to response format
                    const responseData = paginatedUsers.map(u => ({
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

                    return reply.send({
                        success: true,
                        data: responseData,
                        pagination: {
                            page: pageNum,
                            limit: limitNum,
                            total: totalCount,
                            totalPages: Math.ceil(totalCount / limitNum),
                        },
                    });
                } catch (error) {
                    request.log.error(error, 'Admin list all users failed');
                    return reply.status(500).send({
                        success: false,
                        error: 'Failed to list users',
                    });
                }
            }
        );

        /**
         * GET /admin/users - Search users by email
         * Query: ?email=user@example.com
         */
        adminProtected.get<{ Querystring: SearchUsersQuery }>(
            '/users',
            { schema: { tags: ['Admin'], summary: 'Search users by email', security: auth } },
            async (request: FastifyRequest<{ Querystring: SearchUsersQuery }>, reply: FastifyReply) => {
                const { email } = request.query;

                if (!email || email.trim().length < 3) {
                    return reply.status(400).send({
                        success: false,
                        error: 'Email query required (min 3 characters)',
                    });
                }

                try {
                    // Search users by email (case-insensitive partial match)
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

                    // For each user, get their current subscription
                    const usersWithSubscriptions = await Promise.all(
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

                            return {
                                ...user,
                                subscription: subscription || null,
                            };
                        })
                    );

                    return reply.send({
                        success: true,
                        data: usersWithSubscriptions,
                        count: usersWithSubscriptions.length,
                    });
                } catch (error) {
                    request.log.error(error, 'Admin user search failed');
                    return reply.status(500).send({
                        success: false,
                        error: 'Failed to search users',
                    });
                }
            }
        );

        /**
         * GET /admin/users/:userId - Get single user details with pages and usage
         */
        adminProtected.get<{ Params: { userId: string } }>(
            '/users/:userId',
            { schema: { tags: ['Admin'], summary: 'Get single user details with pages and usage', security: auth, params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] } } },
            async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
                const { userId } = request.params;

                try {
                    const [user] = await db
                        .select({
                            id: users.id,
                            email: users.email,
                            name: users.name,
                            phone: users.phone,
                            facebookId: users.facebookId,
                            createdAt: users.createdAt,
                        })
                        .from(users)
                        .where(eq(users.id, userId))
                        .limit(1);

                    if (!user) {
                        return reply.status(404).send({
                            success: false,
                            error: 'User not found',
                        });
                    }

                    // Get subscription with plan limits
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

                    // Get pages with identifying info
                    const userPages = await db
                        .select({
                            id: pages.id,
                            name: pages.name,
                            facebookPageId: pages.facebookPageId,
                            instagramUsername: pages.instagramUsername,
                            instagramAccountId: pages.instagramAccountId,
                        })
                        .from(pages)
                        .where(eq(pages.userId, userId));

                    // Get current period usage
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
                                gte(usage.periodEnd, now)
                            )
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
                    const workspaceIdsRows = await db
                        .select({ workspaceId: workspaceMembers.workspaceId })
                        .from(workspaceMembers)
                        .where(eq(workspaceMembers.userId, userId));
                    const workspaceIds = workspaceIdsRows.map(r => r.workspaceId);

                    const ownedPageIdsRows = await db
                        .select({ id: pages.id })
                        .from(pages)
                        .where(
                            workspaceIds.length > 0
                                ? sql`${pages.userId} = ${userId} OR ${pages.workspaceId} IN (${sql.join(workspaceIds.map(w => sql`${w}`), sql`, `)})`
                                : eq(pages.userId, userId)
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

                    return reply.send({
                        success: true,
                        data: {
                            ...user,
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
                        },
                    });
                } catch (error) {
                    request.log.error(error, 'Admin get user failed');
                    return reply.status(500).send({
                        success: false,
                        error: 'Failed to get user',
                    });
                }
            }
        );

        /**
         * GET /admin/users/:userId/ai-cost?period=7d|30d|90d|this_month|last_month
         * AI usage cost broken down by Facebook/Instagram page for a single user.
         * Default period: 30d. Sorted by cost desc; pages with no activity are excluded.
         */
        adminProtected.get<{ Params: { userId: string }; Querystring: { period?: string } }>(
            '/users/:userId/ai-cost',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'AI cost by page for a single user, scoped to a preset time period',
                    security: auth,
                    params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] },
                    querystring: {
                        type: 'object',
                        properties: { period: { type: 'string', enum: [...AI_COST_PERIODS] } },
                    },
                },
            },
            async (
                request: FastifyRequest<{ Params: { userId: string }; Querystring: { period?: string } }>,
                reply: FastifyReply,
            ) => {
                const { userId } = request.params;
                const periodParam = request.query.period;
                const period: AdminUserAiCostPeriod = (periodParam && (AI_COST_PERIODS as readonly string[]).includes(periodParam))
                    ? periodParam as AdminUserAiCostPeriod
                    : '30d';

                try {
                    const report = await analyticsService.getUserAiCostByPage(userId, period);
                    return reply.send({ success: true, data: report });
                } catch (error) {
                    request.log.error(error, 'Admin get user AI cost failed');
                    return reply.status(500).send({ success: false, error: 'Failed to get AI cost' });
                }
            },
        );

        /**
         * POST /admin/users/:userId/upgrade - Manual subscription upgrade
         * Body: { planId, periodMonths, paymentMethod, paymentReference?, note? }
         */
        adminProtected.post<{ Params: { userId: string }; Body: ManualUpgradeBody }>(
            '/users/:userId/upgrade',
            { schema: { tags: ['Admin'], summary: 'Manual subscription upgrade for a user', security: auth, params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] } } },
            async (
                request: FastifyRequest<{ Params: { userId: string }; Body: ManualUpgradeBody }>,
                reply: FastifyReply
            ) => {
                const { userId } = request.params;
                const { planId, periodMonths, paymentMethod, paymentReference, note } = request.body;
                const adminUserId = (request as AuthenticatedRequest).user?.userId;

                // Validate required fields
                if (!planId || !periodMonths || !paymentMethod) {
                    return reply.status(400).send({
                        success: false,
                        error: 'planId, periodMonths, and paymentMethod are required',
                    });
                }

                // Validate periodMonths
                if (![1, 3, 6, 12].includes(periodMonths)) {
                    return reply.status(400).send({
                        success: false,
                        error: 'periodMonths must be 1, 3, 6, or 12',
                    });
                }

                try {
                    // Verify user exists
                    const [user] = await db
                        .select({ id: users.id, email: users.email })
                        .from(users)
                        .where(eq(users.id, userId))
                        .limit(1);

                    if (!user) {
                        return reply.status(404).send({
                            success: false,
                            error: 'User not found',
                        });
                    }

                    // Verify plan exists
                    const [plan] = await db
                        .select({ id: plans.id, name: plans.name, slug: plans.slug })
                        .from(plans)
                        .where(eq(plans.id, planId))
                        .limit(1);

                    if (!plan) {
                        return reply.status(404).send({
                            success: false,
                            error: 'Plan not found',
                        });
                    }

                    // Get existing subscription for audit log
                    const [existingSubscription] = await db
                        .select()
                        .from(subscriptions)
                        .where(eq(subscriptions.userId, userId))
                        .limit(1);

                    // Calculate period dates
                    const now = new Date();
                    const periodEnd = new Date(now);
                    periodEnd.setMonth(periodEnd.getMonth() + periodMonths);

                    // Create or update subscription
                    let newSubscription;
                    if (existingSubscription) {
                        // Update existing subscription
                        [newSubscription] = await db
                            .update(subscriptions)
                            .set({
                                planId,
                                status: 'active',
                                paymentMethod,
                                currentPeriodStart: now,
                                currentPeriodEnd: periodEnd,
                                trialEndsAt: null, // Clear any trial
                                canceledAt: null,
                                cancelReason: null,
                                cancelAtPeriodEnd: false,
                                updatedAt: now,
                            })
                            .where(eq(subscriptions.id, existingSubscription.id))
                            .returning();
                    } else {
                        // Create new subscription
                        [newSubscription] = await db
                            .insert(subscriptions)
                            .values({
                                userId,
                                planId,
                                status: 'active',
                                paymentMethod,
                                currentPeriodStart: now,
                                currentPeriodEnd: periodEnd,
                            })
                            .returning();
                    }

                    // Reset quota for the new billing period so the customer
                    // immediately gets their fresh allowance after renewal.
                    await subscriptionsService.initializeUsagePeriod(userId, now, periodEnd);

                    // Create audit log
                    await db.insert(adminAuditLogs).values({
                        adminUserId,
                        targetUserId: userId,
                        action: 'manual_upgrade',
                        previousValue: existingSubscription
                            ? {
                                  planId: existingSubscription.planId,
                                  status: existingSubscription.status,
                                  periodEnd: existingSubscription.currentPeriodEnd,
                                  paymentMethod: existingSubscription.paymentMethod,
                              }
                            : null,
                        newValue: {
                            planId,
                            planName: plan.name,
                            status: 'active',
                            periodMonths,
                            periodEnd: periodEnd.toISOString(),
                            paymentMethod,
                        },
                        paymentReference,
                        note,
                    });

                    request.log.info(
                        {
                            adminUserId,
                            targetUserId: userId,
                            planId,
                            periodMonths,
                            paymentMethod,
                            paymentReference,
                        },
                        'Manual subscription upgrade completed'
                    );

                    return reply.send({
                        success: true,
                        message: `User upgraded to ${plan.name} for ${periodMonths} month(s)`,
                        data: {
                            subscription: newSubscription,
                            plan,
                            periodEnd: periodEnd.toISOString(),
                        },
                    });
                } catch (error) {
                    request.log.error(error, 'Admin manual upgrade failed');
                    return reply.status(500).send({
                        success: false,
                        error: 'Failed to upgrade user',
                    });
                }
            }
        );

        /**
         * GET /admin/plans - List all plans (for admin dropdown)
         */
        adminProtected.get('/plans', { schema: { tags: ['Admin'], summary: 'List all plans for admin dropdown', security: auth } }, async (request: FastifyRequest, reply: FastifyReply) => {
            try {
                const allPlans = await db
                    .select({
                        id: plans.id,
                        name: plans.name,
                        slug: plans.slug,
                        price: plans.price,
                        isActive: plans.isActive,
                    })
                    .from(plans)
                    .orderBy(plans.sortOrder);

                return reply.send({
                    success: true,
                    data: allPlans,
                });
            } catch (error) {
                request.log.error(error, 'Admin get plans failed');
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to get plans',
                });
            }
        });

        /**
         * GET /admin/audit-logs - View recent audit logs
         */
        adminProtected.get('/audit-logs', { schema: { tags: ['Admin'], summary: 'View recent audit logs', security: auth } }, async (request: FastifyRequest, reply: FastifyReply) => {
            try {
                const logs = await db
                    .select({
                        id: adminAuditLogs.id,
                        action: adminAuditLogs.action,
                        previousValue: adminAuditLogs.previousValue,
                        newValue: adminAuditLogs.newValue,
                        paymentReference: adminAuditLogs.paymentReference,
                        note: adminAuditLogs.note,
                        createdAt: adminAuditLogs.createdAt,
                        adminEmail: users.email,
                    })
                    .from(adminAuditLogs)
                    .leftJoin(users, eq(adminAuditLogs.adminUserId, users.id))
                    .orderBy(adminAuditLogs.createdAt)
                    .limit(100);

                return reply.send({
                    success: true,
                    data: logs,
                });
            } catch (error) {
                request.log.error(error, 'Admin get audit logs failed');
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to get audit logs',
                });
            }
        });

        // ============================================
        // AI Playground — Admin-only reply testing
        // ============================================

        /**
         * GET /admin/pages - List all pages (for playground dropdown)
         */
        adminProtected.get('/pages', {
            schema: { tags: ['Admin'], summary: 'List all pages for playground', security: auth },
        }, async (_request: FastifyRequest, reply: FastifyReply) => {
            try {
                const allPages = await db
                    .select({
                        id: pages.id,
                        name: pages.name,
                        kbVersion: pages.kbVersion,
                        kbActiveVersion: pages.kbActiveVersion,
                        userId: pages.userId,
                        userEmail: users.email,
                    })
                    .from(pages)
                    .leftJoin(users, eq(pages.userId, users.id))
                    .orderBy(pages.name);

                return reply.send({ success: true, data: allPages });
            } catch (error) {
                _request.log.error(error, 'Admin list pages failed');
                return reply.status(500).send({ success: false, error: 'Failed to list pages' });
            }
        });

        /**
         * GET /admin/kb/status/:pageId - KB status for a page
         */
        adminProtected.get<{ Params: { pageId: string } }>('/kb/status/:pageId', {
            schema: { tags: ['Admin'], summary: 'Get KB status for a page', security: auth },
        }, async (request: FastifyRequest<{ Params: { pageId: string } }>, reply: FastifyReply) => {
            const { pageId } = request.params;

            try {
                const [page] = await db
                    .select({
                        id: pages.id,
                        name: pages.name,
                        knowledgeBase: pages.knowledgeBase,
                        kbVersion: pages.kbVersion,
                        kbActiveVersion: pages.kbActiveVersion,
                        kbUpdatedAt: pages.kbUpdatedAt,
                    })
                    .from(pages)
                    .where(eq(pages.id, pageId))
                    .limit(1);

                if (!page) {
                    return reply.status(404).send({ success: false, error: 'Page not found' });
                }

                // Count chunks for the active version
                const [chunkCount] = await db
                    .select({ count: sql<number>`count(*)::int` })
                    .from(kbChunks)
                    .where(
                        and(
                            eq(kbChunks.pageId, pageId),
                            page.kbActiveVersion !== null
                                ? eq(kbChunks.kbVersion, page.kbActiveVersion)
                                : sql`false`
                        )
                    );

                // Count unresolved gaps
                const [gapCount] = await db
                    .select({ count: sql<number>`count(*)::int` })
                    .from(kbGaps)
                    .where(and(eq(kbGaps.pageId, pageId), eq(kbGaps.resolved, false)));

                return reply.send({
                    success: true,
                    data: {
                        pageId: page.id,
                        pageName: page.name,
                        kbText: page.knowledgeBase || '',
                        kbLength: page.knowledgeBase?.length || 0,
                        kbVersion: page.kbVersion,
                        kbActiveVersion: page.kbActiveVersion,
                        kbUpdatedAt: page.kbUpdatedAt,
                        chunksCount: chunkCount?.count || 0,
                        gapsCount: gapCount?.count || 0,
                    },
                });
            } catch (error) {
                request.log.error(error, 'Admin KB status failed');
                return reply.status(500).send({ success: false, error: 'Failed to get KB status' });
            }
        });

        /**
         * GET /admin/kb/gaps/:pageId - List KB gaps for a page
         */
        adminProtected.get<{ Params: { pageId: string } }>('/kb/gaps/:pageId', {
            schema: { tags: ['Admin'], summary: 'List KB gaps for a page', security: auth },
        }, async (request: FastifyRequest<{ Params: { pageId: string } }>, reply: FastifyReply) => {
            const { pageId } = request.params;

            try {
                const gaps = await db
                    .select({
                        id: kbGaps.id,
                        queryText: kbGaps.queryText,
                        detectedIntent: kbGaps.detectedIntent,
                        occurrenceCount: kbGaps.occurrenceCount,
                        firstSeenAt: kbGaps.firstSeenAt,
                        lastSeenAt: kbGaps.lastSeenAt,
                        resolved: kbGaps.resolved,
                    })
                    .from(kbGaps)
                    .where(eq(kbGaps.pageId, pageId))
                    .orderBy(desc(kbGaps.occurrenceCount));

                return reply.send({ success: true, data: gaps });
            } catch (error) {
                request.log.error(error, 'Admin KB gaps failed');
                return reply.status(500).send({ success: false, error: 'Failed to get KB gaps' });
            }
        });

        /**
         * PATCH /admin/pages/:pageId/kb - Update KB text and trigger re-ingestion
         */
        adminProtected.patch<{ Params: { pageId: string }; Body: { knowledgeBase: string } }>('/pages/:pageId/kb', {
            schema: { tags: ['Admin'], summary: 'Update KB text for a page and trigger re-ingestion', security: auth },
        }, async (request: FastifyRequest<{ Params: { pageId: string }; Body: { knowledgeBase: string } }>, reply: FastifyReply) => {
            const { pageId } = request.params;
            const { knowledgeBase } = request.body;

            if (typeof knowledgeBase !== 'string') {
                return reply.status(400).send({ success: false, error: 'knowledgeBase (string) is required' });
            }

            try {
                const [page] = await db
                    .select({ id: pages.id, kbVersion: pages.kbVersion })
                    .from(pages)
                    .where(eq(pages.id, pageId))
                    .limit(1);

                if (!page) {
                    return reply.status(404).send({ success: false, error: 'Page not found' });
                }

                const newVersion = (page.kbVersion ?? 0) + 1;
                const [updated] = await db
                    .update(pages)
                    .set({
                        knowledgeBase,
                        kbVersion: newVersion,
                        kbUpdatedAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .where(eq(pages.id, pageId))
                    .returning();

                // Fire-and-forget: trigger KB ingestion
                if (knowledgeBase.trim() && updated?.kbVersion) {
                    const ingestion = getIngestionService();
                    if (ingestion) {
                        ingestion.ingestKnowledgeBase(pageId, knowledgeBase, updated.kbVersion)
                            .catch(err => request.log.error(err, 'Admin KB ingestion failed'));
                    }
                }

                return reply.send({
                    success: true,
                    data: { pageId: updated.id, kbVersion: updated.kbVersion, kbLength: knowledgeBase.length },
                });
            } catch (error) {
                request.log.error(error, 'Admin KB update failed');
                return reply.status(500).send({ success: false, error: 'Failed to update KB' });
            }
        });

        /**
         * POST /admin/kb/re-ingest - Re-ingest KB for all pages (or a specific page)
         * Triggers chunking + embedding with the latest chunker logic.
         * Use after deploying chunker improvements so existing KBs benefit immediately.
         */
        adminProtected.post<{ Body: { pageId?: string } }>('/kb/re-ingest', {
            schema: { tags: ['Admin'], summary: 'Re-ingest KB chunks for all (or one) page', security: auth },
        }, async (request: FastifyRequest<{ Body: { pageId?: string } }>, reply: FastifyReply) => {
            const ingestion = getIngestionService();
            if (!ingestion) {
                return reply.status(503).send({ success: false, error: 'Ingestion service unavailable (no OpenAI key)' });
            }

            try {
                const { pageId } = request.body || {};

                // Fetch pages with KB content
                const condition = pageId
                    ? and(eq(pages.id, pageId), isNotNull(pages.knowledgeBase))
                    : isNotNull(pages.knowledgeBase);

                const pagesWithKB = await db
                    .select({ id: pages.id, name: pages.name, knowledgeBase: pages.knowledgeBase, kbVersion: pages.kbVersion })
                    .from(pages)
                    .where(condition);

                if (pagesWithKB.length === 0) {
                    return reply.send({ success: true, data: { reIngested: 0, message: 'No pages with KB content found' } });
                }

                const results: { pageId: string; name: string | null; status: string; newVersion: number }[] = [];

                for (const p of pagesWithKB) {
                    try {
                        const newVersion = (p.kbVersion ?? 0) + 1;

                        // Bump version
                        await db.update(pages).set({
                            kbVersion: newVersion,
                            kbUpdatedAt: new Date(),
                            updatedAt: new Date(),
                        }).where(eq(pages.id, p.id));

                        // Run ingestion (await to ensure it completes before moving to next page)
                        await ingestion.ingestKnowledgeBase(p.id, p.knowledgeBase ?? '', newVersion);

                        results.push({ pageId: p.id, name: p.name, status: 'ok', newVersion });
                        request.log.info({ pageId: p.id, newVersion }, 'KB re-ingested');
                    } catch (err) {
                        request.log.error(err, `KB re-ingestion failed for page ${p.id}`);
                        results.push({ pageId: p.id, name: p.name, status: 'error', newVersion: p.kbVersion ?? 0 });
                    }
                }

                return reply.send({
                    success: true,
                    data: { reIngested: results.filter(r => r.status === 'ok').length, total: pagesWithKB.length, results },
                });
            } catch (error) {
                request.log.error(error, 'KB re-ingestion failed');
                return reply.status(500).send({ success: false, error: 'Failed to re-ingest KB' });
            }
        });

        /**
         * POST /admin/ai/playground - Test AI reply with full metadata
         * Body: { pageId, question, channel, [postMessage, messageTags, ourFacebookPageId, conversationHistory, replyStyle, brandVoiceNotes, customerContext, model] }
         */
        type PlaygroundRequestBody = {
            pageId: string;
            question: string;
            channel: 'comment' | 'dm';
            postMessage?: string;
            messageTags?: import('../utils/commentText').FacebookMessageTag[];
            ourFacebookPageId?: string;
            conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
            replyStyle?: string;
            brandVoiceNotes?: string;
            customerContext?: string;
            model?: string;
            /** 'eval' from playground-eval.ts batch script; defaults to 'playground' for the admin UI. */
            source?: PlaygroundSource;
        };
        adminProtected.post<{ Body: PlaygroundRequestBody }>('/ai/playground', {
            schema: { tags: ['Admin'], summary: 'Test AI reply generation with full metadata', security: auth },
        }, async (request: FastifyRequest<{ Body: PlaygroundRequestBody }>, reply: FastifyReply) => {
            const { pageId, question, channel, postMessage, messageTags, ourFacebookPageId, conversationHistory, replyStyle, brandVoiceNotes, customerContext, model, source } = request.body;
            const startTime = Date.now();

            if (!pageId || !question?.trim()) {
                return reply.status(400).send({ success: false, error: 'pageId and question are required' });
            }

            try {
                // 1. Fetch page data
                const [page] = await db
                    .select({
                        id: pages.id,
                        name: pages.name,
                        userId: pages.userId,
                        workspaceId: pages.workspaceId,
                        knowledgeBase: pages.knowledgeBase,
                        kbActiveVersion: pages.kbActiveVersion,
                        ecommerceStoreId: pages.ecommerceStoreId,
                    })
                    .from(pages)
                    .where(eq(pages.id, pageId))
                    .limit(1);

                if (!page) {
                    return reply.status(404).send({ success: false, error: 'Page not found' });
                }

                // 1b–3. Build playground context (shared helper)
                const { playgroundInput, commentReplyMode, nudgeText } = await buildPlaygroundContext({
                    page, question, channel, postMessage, messageTags, ourFacebookPageId,
                    conversationHistory, replyStyle, brandVoiceNotes, customerContext, model, source,
                });

                // 4. Delegate to replyGenerator — single source of truth for the pipeline
                replyGenerator.setLogger(request.log);
                const result = await replyGenerator.generateForPlayground(playgroundInput);

                return reply.send({
                    success: true,
                    data: {
                        ...result,
                        latencyMs: Date.now() - startTime,
                        commentReplyMode: channel === 'comment' ? commentReplyMode : null,
                        nudgeText: channel === 'comment' ? nudgeText : null,
                    },
                });
            } catch (error) {
                request.log.error(error, 'Admin AI playground failed');
                return reply.status(500).send({ success: false, error: 'Failed to generate AI reply' });
            }
        });

        /**
         * GET /admin/waitlist - List all waitlist signups with pagination and filters
         * Query: ?page=1&limit=20&feature=early_access&search=email
         */
        adminProtected.get<{ Querystring: { page?: string; limit?: string; feature?: string; search?: string } }>(
            '/waitlist',
            { schema: { tags: ['Admin'], summary: 'List waitlist signups', security: auth } },
            async (request, reply) => {
                const {
                    page = '1',
                    limit = '20',
                    feature,
                    search,
                } = request.query;

                const pageNum = Math.max(1, parseInt(page, 10) || 1);
                const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
                const offset = (pageNum - 1) * limitNum;

                try {
                    const conditions = [];
                    if (feature) {
                        conditions.push(eq(waitlistEmails.feature, feature));
                    }
                    if (search) {
                        conditions.push(ilike(waitlistEmails.email, `%${search}%`));
                    }

                    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

                    const [entries, countResult] = await Promise.all([
                        db.select()
                            .from(waitlistEmails)
                            .where(whereClause)
                            .orderBy(desc(waitlistEmails.createdAt))
                            .limit(limitNum)
                            .offset(offset),
                        db.select({ count: sql<number>`count(*)::int` })
                            .from(waitlistEmails)
                            .where(whereClause),
                    ]);

                    const total = countResult[0]?.count ?? 0;

                    // Get distinct features for filter dropdown
                    const features = await db
                        .selectDistinct({ feature: waitlistEmails.feature })
                        .from(waitlistEmails)
                        .orderBy(waitlistEmails.feature);

                    // Count email vs phone-only subscribers (for send-email UI), excluding unsubscribed
                    const emailCountResult = await db
                        .select({ count: sql<number>`count(distinct email)::int` })
                        .from(waitlistEmails)
                        .where(and(
                            ...(whereClause ? [whereClause] : []),
                            isNotNull(waitlistEmails.email),
                            isNull(waitlistEmails.unsubscribedAt),
                        ));
                    const emailCount = emailCountResult[0]?.count ?? 0;

                    // Count registered users with email — for the audience selector. Filter
                    // is global (not affected by the waitlist search/feature filter), since
                    // the users source is independent of those filters in send-email.
                    const userEmailCountResult = await db
                        .select({ count: sql<number>`count(distinct lower(email))::int` })
                        .from(users)
                        .where(and(
                            isNotNull(users.email),
                            sql`lower(${users.email}) NOT IN (SELECT email FROM email_unsubscribes)`,
                        ));
                    const userEmailCount = userEmailCountResult[0]?.count ?? 0;

                    return reply.send({
                        success: true,
                        data: entries,
                        features: features.map(f => f.feature),
                        emailCount,
                        phoneOnlyCount: total - emailCount,
                        userEmailCount,
                        pagination: {
                            page: pageNum,
                            limit: limitNum,
                            total,
                            totalPages: Math.ceil(total / limitNum),
                        },
                    });
                } catch (error) {
                    request.log.error(error, 'Failed to list waitlist entries');
                    return reply.status(500).send({ success: false, error: 'Failed to load waitlist' });
                }
            }
        );

        /**
         * POST /admin/waitlist/send-email — Send an email to subscribers.
         *
         * Audience selection (`audience`, default 'waitlist'):
         *   - 'waitlist' → waitlist_emails table only
         *   - 'users'    → users table (registered accounts with non-null email)
         *   - 'both'     → union of waitlist + users
         *   - 'extras'   → only the addresses provided in `extraEmails` (no broadcast)
         *
         * Within the waitlist source, recipient resolution order:
         *   1. `emailIds` non-empty  → only those waitlist rows
         *   2. `feature` set         → all waitlist emails for that feature
         *   3. Neither               → all waitlist emails
         *
         *   Note: `emailIds` and `feature` only narrow the waitlist source. When
         *   audience is 'users' or 'both' they don't apply to the users source —
         *   the users source is always "all users with email", filtered only by
         *   the global suppression list.
         *
         * Globally suppressed emails (in `email_unsubscribes`) are excluded from
         * every audience. Final list is merged with validated `extraEmails`,
         * lowercased + deduped.
         *
         * Safety caps:
         *   - emailIds:     max 5000 per request
         *   - extraEmails:  max 500 per request
         *   - total unique: max 10000 per request
         */
        const SendEmailSchema = z.object({
            subject: z.string().trim().min(1, 'Subject is required').max(500),
            body: z.string().trim().min(1, 'Body is required').max(100_000),
            feature: z.string().trim().min(1).max(50).optional(),
            emailIds: z.array(z.string().uuid()).max(5000).optional(),
            extraEmails: z.array(z.string().email().max(255)).max(500).optional(),
            audience: z.enum(['waitlist', 'users', 'both', 'extras']).optional().default('waitlist'),
            // Optional: render a full-HTML template (e.g. waitlist-launch) instead of
            // wrapping `body` in the generic shell. When set, each recipient receives
            // the AR or EN htmlBody variant matching their resolved language
            // (KB → dashboardLanguage → 'ar'). `subject` is still admin-controlled,
            // `body` is kept as a fallback for recipients whose variant is missing.
            templateId: z.string().trim().min(1).max(100).optional(),
        });

        adminProtected.post(
            '/waitlist/send-email',
            { schema: { tags: ['Admin'], summary: 'Send email to waitlist subscribers', security: auth } },
            async (request, reply) => {
                const parsed = SendEmailSchema.safeParse(request.body);
                if (!parsed.success) {
                    return reply.status(400).send({
                        success: false,
                        error: parsed.error.errors[0]?.message ?? 'Invalid request',
                    });
                }
                const { subject, body, feature, emailIds, extraEmails, audience, templateId } = parsed.data;

                // Resolve template once if templateId provided and points to a custom-HTML template.
                // `useCustomHtml` gates per-recipient language switching; missing/plain-only template = no-op.
                const customHtmlTemplate = templateId
                    ? WAITLIST_TEMPLATES.find(t => t.id === templateId)
                    : undefined;
                const useCustomHtml = Boolean(
                    customHtmlTemplate?.htmlBodyAr || customHtmlTemplate?.htmlBodyEn
                );
                if (templateId && !customHtmlTemplate) {
                    return reply.status(400).send({
                        success: false,
                        error: `Unknown templateId: ${templateId}`,
                    });
                }

                const adminUserId = (request as AuthenticatedRequest).user?.userId;
                if (!adminUserId) {
                    return reply.status(401).send({ success: false, error: 'Unauthorized' });
                }

                // Normalize extras: lowercase + dedupe (zod already validated email shape + length)
                const extraEmailsClean = Array.from(new Set(
                    (extraEmails ?? []).map(e => e.toLowerCase().trim()).filter(e => e.length > 0)
                ));

                try {
                    const hasExplicitSelection = Array.isArray(emailIds) && emailIds.length > 0;
                    const includeWaitlist = audience === 'waitlist' || audience === 'both';
                    const includeUsers = audience === 'users' || audience === 'both';

                    let waitlistEmailsList: string[] = [];
                    if (includeWaitlist) {
                        const waitlistConditions = [
                            isNotNull(waitlistEmails.email),
                            isNull(waitlistEmails.unsubscribedAt),
                        ];
                        if (hasExplicitSelection) {
                            waitlistConditions.push(inArray(waitlistEmails.id, emailIds));
                        } else if (feature) {
                            waitlistConditions.push(eq(waitlistEmails.feature, feature));
                        }
                        const waitlistRows = await db
                            .select({ email: waitlistEmails.email })
                            .from(waitlistEmails)
                            .where(and(...waitlistConditions));
                        waitlistEmailsList = waitlistRows
                            .map(r => r.email)
                            .filter((e): e is string => Boolean(e))
                            .map(e => e.toLowerCase());
                    }

                    let usersEmailsList: string[] = [];
                    if (includeUsers) {
                        const userRows = await db
                            .select({ email: users.email })
                            .from(users)
                            .where(isNotNull(users.email));
                        usersEmailsList = userRows
                            .map(r => r.email)
                            .filter((e): e is string => Boolean(e))
                            .map(e => e.toLowerCase());
                    }

                    // Apply global suppression list — single query, then in-memory filter
                    const suppressed = await db
                        .select({ email: emailUnsubscribes.email })
                        .from(emailUnsubscribes);
                    const suppressedSet = new Set(suppressed.map(r => r.email));

                    const filterSuppressed = (list: string[]) => list.filter(e => !suppressedSet.has(e));
                    const waitlistFiltered = filterSuppressed(waitlistEmailsList);
                    const usersFiltered = filterSuppressed(usersEmailsList);
                    const extrasFiltered = filterSuppressed(extraEmailsClean);

                    // Merge all sources, dedupe
                    const uniqueEmails = [...new Set([
                        ...waitlistFiltered,
                        ...usersFiltered,
                        ...extrasFiltered,
                    ])];

                    if (uniqueEmails.length > 10_000) {
                        return reply.status(400).send({
                            success: false,
                            error: 'Too many recipients (max 10000 per send)',
                        });
                    }

                    if (uniqueEmails.length === 0) {
                        return reply.send({
                            success: true,
                            sent: 0,
                            failed: 0,
                            total: 0,
                            fromWaitlist: 0,
                            fromUsers: 0,
                            fromExtra: 0,
                        });
                    }

                    const frontendUrl = config.frontendUrl || 'https://jawab24.com';

                    // Per-recipient language only matters when using a custom-HTML template
                    // (where we need to pick AR vs EN variant). Skipped otherwise to avoid
                    // an unnecessary join across users + settings + kbChunks.
                    const recipientLang = useCustomHtml
                        ? await resolveRecipientLanguages(uniqueEmails)
                        : null;

                    let successCount = 0;
                    let failureCount = 0;

                    for (const email of uniqueEmails) {
                        const token = generateUnsubscribeToken(email);
                        const unsubscribeUrl = `${frontendUrl}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;

                        // For custom-HTML templates: pick AR/EN variant by recipient language,
                        // fall back to the other variant if only one exists. If neither exists,
                        // fall through to the generic plain-body wrapper (defensive).
                        let customHtml: string | undefined;
                        if (useCustomHtml && customHtmlTemplate) {
                            const lang = recipientLang?.get(email) ?? 'ar';
                            customHtml =
                                (lang === 'en'
                                    ? customHtmlTemplate.htmlBodyEn ?? customHtmlTemplate.htmlBodyAr
                                    : customHtmlTemplate.htmlBodyAr ?? customHtmlTemplate.htmlBodyEn);
                        }

                        const html = waitlistEmailTemplate({ subject, body, unsubscribeUrl, customHtml });
                        const result = await emailService.send({ to: email, subject, html, type: 'waitlist' });
                        if (result.success) {
                            successCount++;
                        } else {
                            failureCount++;
                            request.log.warn({ email, error: result.error }, 'Failed to send waitlist email');
                        }
                    }

                    // Audit: store `feature` only when it was the effective waitlist filter
                    await db.insert(waitlistEmailSends).values({
                        subject,
                        body,
                        recipientCount: uniqueEmails.length,
                        successCount,
                        failureCount,
                        feature: hasExplicitSelection || !includeWaitlist ? null : (feature ?? null),
                        sentBy: adminUserId,
                    });

                    return reply.send({
                        success: true,
                        sent: successCount,
                        failed: failureCount,
                        total: uniqueEmails.length,
                        fromWaitlist: waitlistFiltered.length,
                        fromUsers: usersFiltered.length,
                        fromExtra: extrasFiltered.length,
                    });
                } catch (error) {
                    request.log.error(error, 'Failed to send waitlist emails');
                    return reply.status(500).send({ success: false, error: 'Failed to send emails' });
                }
            }
        );

        /**
         * GET /admin/waitlist/templates — Read-only list of reusable email templates.
         * Source: backend/src/utils/waitlistTemplates.ts (code-as-data).
         */
        adminProtected.get(
            '/waitlist/templates',
            { schema: { tags: ['Admin'], summary: 'List reusable waitlist email templates', security: auth } },
            async (_request, reply) => {
                return reply.send({ success: true, templates: WAITLIST_TEMPLATES });
            }
        );

        /**
         * POST /admin/lead-digest/run - Manually trigger the daily lead digest job
         * Useful for testing without waiting 24h. Same stamping logic applies,
         * so running this repeatedly will not re-email already-stamped leads.
         */
        /**
         * GET /admin/lead-digest/history - List recent lead digest sends/skips
         * Query: ?page=1&limit=50&status=sent|failed|skipped_*
         */
        adminProtected.get<{ Querystring: { page?: string; limit?: string; status?: string } }>(
            '/lead-digest/history',
            {
                schema: {
                    description: 'Paginated history of lead digest sends/skips',
                    tags: ['Admin'],
                    security: auth,
                },
            },
            async (request, reply) => {
                const pageNum = Math.max(1, parseInt(request.query.page ?? '1', 10) || 1);
                const limit = Math.min(200, Math.max(1, parseInt(request.query.limit ?? '50', 10) || 50));
                const offset = (pageNum - 1) * limit;
                const statusFilter = request.query.status?.trim();

                const where = statusFilter ? eq(leadDigestSends.status, statusFilter) : undefined;
                const rows = await db
                    .select({
                        id: leadDigestSends.id,
                        workspaceId: leadDigestSends.workspaceId,
                        userId: leadDigestSends.userId,
                        userEmail: users.email,
                        status: leadDigestSends.status,
                        leadCount: leadDigestSends.leadCount,
                        lang: leadDigestSends.lang,
                        resendEmailId: leadDigestSends.resendEmailId,
                        errorMessage: leadDigestSends.errorMessage,
                        emailSendId: leadDigestSends.emailSendId,
                        createdAt: leadDigestSends.createdAt,
                    })
                    .from(leadDigestSends)
                    .leftJoin(users, eq(users.id, leadDigestSends.userId))
                    .where(where)
                    .orderBy(desc(leadDigestSends.createdAt))
                    .limit(limit)
                    .offset(offset);

                return reply.send({ page: pageNum, limit, rows });
            }
        );

        /**
         * GET /admin/emails/:id - Fetch a single outbound email (subject + body)
         * by its email_sends row id. Generic across all email types — not just
         * lead digest. Separate endpoint so list responses stay lean.
         */
        adminProtected.get<{ Params: { id: string } }>(
            '/emails/:id',
            {
                schema: {
                    description: 'Fetch the rendered subject + html body for a single outbound email',
                    tags: ['Admin'],
                    security: auth,
                },
            },
            async (request, reply) => {
                const [row] = await db
                    .select({
                        id: emailSends.id,
                        type: emailSends.type,
                        toEmail: emailSends.toEmail,
                        subject: emailSends.subject,
                        htmlBody: emailSends.htmlBody,
                        status: emailSends.status,
                        errorMessage: emailSends.errorMessage,
                        createdAt: emailSends.createdAt,
                    })
                    .from(emailSends)
                    .where(eq(emailSends.id, request.params.id))
                    .limit(1);

                if (!row) return reply.status(404).send({ error: 'Not found' });
                return reply.send(row);
            }
        );

        /**
         * POST /admin/topup - Manually credit a top-up pack to a user.
         * Used for non-Stripe purchases (bank transfer, USDT, WhatsApp, cash).
         * Audit-logged in admin_audit_logs.action='manual_topup'.
         *
         * Body: { userId, pack: '5k'|'10k', source: 'manual'|'admin', externalRef?, note? }
         * - externalRef: bank transaction ID, USDT TXID, WhatsApp ref, etc.
         * - note: admin's reason for the credit (free-form).
         */
        adminProtected.post<{
            Body: {
                userId: string;
                pack: TopupPack;
                source?: Exclude<TopupSource, 'stripe'>;
                externalRef?: string;
                note?: string;
            };
        }>(
            '/topup',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Manually credit a top-up pack to a user',
                    security: auth,
                    body: {
                        type: 'object',
                        required: ['userId', 'pack'],
                        properties: {
                            userId: { type: 'string', format: 'uuid' },
                            pack: { type: 'string', enum: ['5k', '10k'] },
                            source: { type: 'string', enum: ['manual', 'admin'], default: 'manual' },
                            externalRef: { type: 'string', maxLength: 255 },
                            note: { type: 'string', maxLength: 1000 },
                        },
                    },
                },
            },
            async (request, reply) => {
                const { userId, pack, source = 'manual', externalRef, note } = request.body;
                const adminUserId = (request as AuthenticatedRequest).user?.userId;

                try {
                    const result = await topupService.creditTopup({
                        userId,
                        pack,
                        source,
                        externalRef,
                    });

                    await db.insert(adminAuditLogs).values({
                        adminUserId,
                        targetUserId: userId,
                        action: 'manual_topup',
                        previousValue: null,
                        newValue: {
                            pack,
                            repliesAdded: result.repliesAdded,
                            source,
                            newBalance: result.newBalance,
                            purchaseId: result.purchaseId,
                        },
                        paymentReference: externalRef ?? null,
                        note: note ?? null,
                    });

                    return reply.send({
                        success: true,
                        purchase: {
                            id: result.purchaseId,
                            pack,
                            repliesAdded: result.repliesAdded,
                        },
                        newBalance: result.newBalance,
                    });
                } catch (err) {
                    if (err instanceof TopupUserNotFoundError) {
                        return reply.status(404).send({ success: false, error: 'User not found' });
                    }
                    if (err instanceof UnknownTopupPackError) {
                        return reply.status(400).send({ success: false, error: err.message });
                    }
                    if (err instanceof DuplicateTopupError) {
                        // Shouldn't fire for manual/admin (no PaymentIntent id), but defensive.
                        return reply.status(409).send({ success: false, error: 'Duplicate purchase' });
                    }
                    request.log.error(err, 'manual_topup failed');
                    return reply.status(500).send({ success: false, error: 'Top-up credit failed' });
                }
            }
        );

        adminProtected.post('/lead-digest/run', {
            schema: {
                description: 'Manually run the daily lead digest job',
                tags: ['Admin'],
                security: auth,
                response: {
                    200: {
                        type: 'object',
                        properties: {
                            processed: { type: 'number' },
                            sent: { type: 'number' },
                            skipped: { type: 'number' },
                            errors: { type: 'number' },
                        },
                    },
                },
            },
        }, async (request: FastifyRequest, reply: FastifyReply) => {
            try {
                const result = await runDailyLeadDigest();
                return reply.send(result);
            } catch (error) {
                request.log.error(error, 'Manual lead digest trigger failed');
                return reply.status(500).send({ success: false, error: 'Lead digest run failed' });
            }
        });

    });
}
