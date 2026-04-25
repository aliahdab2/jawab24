import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { db } from '../db';
import { users, subscriptions, plans, adminAuditLogs, pages, usage, kbChunks, kbGaps, waitlistEmails, waitlistEmailSends, leadDigestSends, emailSends, posts, instagramMedia } from '../db/schema';
import { eq, ilike, desc, and, gte, lte, sql, isNotNull, isNull, inArray } from 'drizzle-orm';
import { auth } from '../utils/swagger';
import { getIngestionService } from '../services/pages';
import { replyGenerator } from '../services/reply/generator';
import { buildPlaygroundContext } from '../services/reply/playgroundContext';
import { config } from '../config';
import { emailService } from '../services/email';
import { waitlistEmailTemplate } from '../utils/emailTemplates';
import { generateUnsubscribeToken } from './waitlist';
import { runDailyLeadDigest } from '../services/leadDigest';

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
                        .orderBy(desc(users.createdAt))
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
        };
        adminProtected.post<{ Body: PlaygroundRequestBody }>('/ai/playground', {
            schema: { tags: ['Admin'], summary: 'Test AI reply generation with full metadata', security: auth },
        }, async (request: FastifyRequest<{ Body: PlaygroundRequestBody }>, reply: FastifyReply) => {
            const { pageId, question, channel, postMessage, messageTags, ourFacebookPageId, conversationHistory, replyStyle, brandVoiceNotes, customerContext, model } = request.body;
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
                    conversationHistory, replyStyle, brandVoiceNotes, customerContext, model,
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

                    return reply.send({
                        success: true,
                        data: entries,
                        features: features.map(f => f.feature),
                        emailCount,
                        phoneOnlyCount: total - emailCount,
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
         * POST /admin/waitlist/send-email — Send an email to waitlist subscribers.
         *
         * Recipient resolution order:
         *   1. `emailIds` non-empty  → only those waitlist rows (still filtered to email NOT NULL + NOT unsubscribed)
         *   2. `feature` set         → all waitlist emails for that feature
         *   3. Neither               → all waitlist emails
         *   Merged with validated `extraEmails`, lowercased + deduped.
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
                const { subject, body, feature, emailIds, extraEmails } = parsed.data;

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

                    const waitlistConditions = [
                        isNotNull(waitlistEmails.email),
                        isNull(waitlistEmails.unsubscribedAt),
                    ];

                    if (hasExplicitSelection) {
                        waitlistConditions.push(inArray(waitlistEmails.id, emailIds));
                    } else if (feature) {
                        waitlistConditions.push(eq(waitlistEmails.feature, feature));
                    }

                    const recipients = await db
                        .select({ email: waitlistEmails.email })
                        .from(waitlistEmails)
                        .where(and(...waitlistConditions));

                    const waitlistEmailsList = recipients
                        .map(r => r.email)
                        .filter((e): e is string => Boolean(e))
                        .map(e => e.toLowerCase());

                    // Merge waitlist-derived + extras, dedupe
                    const uniqueEmails = [...new Set([...waitlistEmailsList, ...extraEmailsClean])];

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
                            fromExtra: 0,
                        });
                    }

                    const frontendUrl = config.frontendUrl || 'https://jawab24.com';

                    let successCount = 0;
                    let failureCount = 0;

                    for (const email of uniqueEmails) {
                        const token = generateUnsubscribeToken(email);
                        const unsubscribeUrl = `${frontendUrl}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
                        const html = waitlistEmailTemplate({ subject, body, unsubscribeUrl });
                        const result = await emailService.send({ to: email, subject, html, type: 'waitlist' });
                        if (result.success) {
                            successCount++;
                        } else {
                            failureCount++;
                            request.log.warn({ email, error: result.error }, 'Failed to send waitlist email');
                        }
                    }

                    // Audit: store `feature` only when it was the effective filter
                    await db.insert(waitlistEmailSends).values({
                        subject,
                        body,
                        recipientCount: uniqueEmails.length,
                        successCount,
                        failureCount,
                        feature: hasExplicitSelection ? null : (feature ?? null),
                        sentBy: adminUserId,
                    });

                    return reply.send({
                        success: true,
                        sent: successCount,
                        failed: failureCount,
                        total: uniqueEmails.length,
                        fromWaitlist: waitlistEmailsList.length,
                        fromExtra: extraEmailsClean.length,
                    });
                } catch (error) {
                    request.log.error(error, 'Failed to send waitlist emails');
                    return reply.status(500).send({ success: false, error: 'Failed to send emails' });
                }
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
